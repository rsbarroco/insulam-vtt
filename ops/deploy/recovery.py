#!/usr/bin/env python3
"""AGPL-3.0-only. Explicit, offline-oriented backup/recovery; never schedules itself.

Requires Python 3.10+, Docker Compose v2+, and an existing configured stack.
No infrastructure credentials are generated or printed, and secret files are not
copied. Database dumps DO contain private records and password hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from uuid import uuid4


MIGRATIONS = '''COPY (SELECT id, migration_name, checksum, started_at, finished_at,
rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY id) TO STDOUT'''
PENDING_MIGRATIONS = '''SELECT count(*) FROM "_prisma_migrations"
WHERE finished_at IS NULL AND rolled_back_at IS NULL'''
EMPTY_DB = """SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
AND c.relkind IN ('r','p','S','v','m','f')"""
SERVICES = ('backend', 'frontend', 'nginx')
SNAPSHOT_NAME = re.compile(r'^vtt-\d{8}T\d{6}Z-[0-9a-f]{8}$')


def digest(path):
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else _digest(stream)


def _digest(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(block)
    return result.hexdigest()


class Stack:
    def __init__(self, compose_file, env_file):
        self.compose_file = Path(compose_file).resolve(strict=True)
        self.env_file = Path(env_file).resolve(strict=True)
        self.base = ['docker', 'compose', '--env-file', str(self.env_file), '-f', str(self.compose_file)]

    def run(self, *args, output=None, input=None, overrides=()):
        command = self.base + [part for path in overrides for part in ('-f', str(path))] + list(args)
        # Never echo a failed command's output: logs may contain application data.
        result = subprocess.run(command, stdin=input, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('Docker operation failed; inspect locally without sharing logs.')
        return '' if output else result.stdout.decode().strip()

    def sql(self, query):
        return self.run('exec', '-T', 'database', 'sh', '-c',
                        'exec psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', 'sh', query)

    def configuration(self):
        return json.loads(self.run('config', '--format', 'json'))

    def running(self):
        container = self.run('ps', '-a', '-q', 'backend')
        if not container:
            return False
        if '\n' in container:
            raise ValueError('Multiple backend containers are not supported.')
        result = subprocess.run(['docker', 'inspect', '--format', '{{json .State}}', container],
                                capture_output=True, text=True, check=True)
        state = json.loads(result.stdout)
        if state.get('Paused') or state.get('Restarting') or state.get('Dead'):
            raise ValueError('Backend is not in a stable state; resolve it before recovery.')
        if state.get('Status') == 'running' and state.get('Running'):
            return True
        if state.get('Status') in ('exited', 'created') and not state.get('Running'):
            return False
        raise ValueError('Unrecognized backend state; recovery refused.')

    def schema(self):
        if self.sql(PENDING_MIGRATIONS) != '0':
            raise ValueError('Unfinished migration; recovery snapshot/rollback refused.')
        history = self.sql(MIGRATIONS)
        schema = self.run('exec', '-T', 'database', 'sh', '-c',
                          'exec pg_dump --schema-only --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"')
        # New pg_dump versions randomize the psql restriction marker. Its value
        # and comments do not describe schema; preserve every other statement.
        normalized = '\n'.join(line for line in schema.splitlines()
                               if line.strip() and not line.startswith(('--', '\\restrict ', '\\unrestrict ')))
        return {'history': hashlib.sha256(history.encode()).hexdigest(),
                'schema': hashlib.sha256(normalized.encode()).hexdigest()}

    def validate_data(self, data, existing=False):
        configuration = self.configuration()
        mounts = configuration['services']['backend']['volumes']
        sources = [mount['source'] for mount in mounts
                   if mount.get('target') == '/app/uploads' and mount.get('type') == 'bind']
        if len(sources) != 1 or Path(sources[0]).resolve() != data / 'uploads':
            raise ValueError('Data directory does not match the configured uploads mount.')
        if existing:
            container = self.run('ps', '-a', '-q', 'backend')
            if not container or '\n' in container:
                raise ValueError('Expected one existing backend container.')
            result = subprocess.run(['docker', 'inspect', '--format', '{{json .Mounts}}', container],
                                    capture_output=True, text=True, check=True)
            sources = [mount['Source'] for mount in json.loads(result.stdout)
                       if mount.get('Destination') == '/app/uploads' and mount.get('Type') == 'bind']
            if len(sources) != 1 or Path(sources[0]).resolve() != data / 'uploads':
                raise ValueError('Configured data directory differs from the existing backend mount.')

    def runtime_files(self):
        configuration = self.configuration()
        targets = {'/opt/vtt/load-secrets.sh', '/opt/vtt/secrets-entrypoint.sh',
                   '/etc/nginx/templates/default.conf.template', '/etc/nginx/cozyvtt/locations.conf',
                   '/docker-entrypoint.d/19-cozyvtt-trusted-proxies.envsh', '/etc/nginx/cozyvtt.d'}
        result = {}
        for service in ('backend', 'nginx'):
            for mount in configuration['services'][service]['volumes']:
                if mount.get('type') == 'bind' and mount.get('target') in targets:
                    path = Path(mount['source'])
                    if path.is_dir():
                        content = '\n'.join(file.name + ':' + digest(file) for file in sorted(path.glob('*.conf')))
                        result[mount['target']] = hashlib.sha256(content.encode()).hexdigest()
                    else:
                        result[mount['target']] = digest(path)
        if set(result) != targets:
            raise ValueError('Expected runtime configuration mounts are missing.')
        return result

    def images(self):
        images = {}
        for service in SERVICES:
            container = self.run('ps', '-a', '-q', service)
            if not container or '\n' in container:
                raise RuntimeError('Expected exactly one container for each application service.')
            result = subprocess.run(['docker', 'inspect', '--format', '{{.Image}}', container], capture_output=True, text=True, check=True)
            image = result.stdout.strip()
            if not re.fullmatch(r'sha256:[0-9a-f]{64}', image):
                raise RuntimeError('An immutable application image ID is required.')
            images[service] = image
        return images


def config_identity(stack):
    # Hash, never copy, the EFFECTIVE configuration (including shell overrides).
    # Only release image/source references may differ for an image rollback.
    config = stack.configuration()
    for service in ('backend', 'frontend'):
        config['services'][service].pop('image', None)
    config['services']['frontend'].get('build', {}).get('args', {}).pop('VITE_SOURCE_CODE_URL', None)
    effective = json.dumps(config, sort_keys=True, separators=(',', ':'))
    return {'compose': digest(stack.compose_file), 'settings': hashlib.sha256(effective.encode()).hexdigest(),
            'runtime': stack.runtime_files()}


def verify_snapshot(snapshot):
    snapshot = Path(snapshot).resolve(strict=True)
    manifest = json.loads((snapshot / 'manifest.json').read_text())
    if manifest.get('format') != 1:
        raise ValueError('Unsupported snapshot format.')
    for name in ('database.dump', 'uploads.tar.gz'):
        path = snapshot / name
        if path.is_symlink() or not path.is_file() or digest(path) != manifest['sha256'].get(name):
            raise ValueError('Snapshot checksum mismatch or invalid file.')
    return manifest


def archive_uploads(data, destination):
    uploads = data / 'uploads'
    if uploads.is_symlink() or not uploads.is_dir():
        raise ValueError('Uploads must be a real directory.')
    def walk_error(error):
        raise error
    # A hardlinked regular file is stored by value, never as a tar hardlink.
    with tarfile.open(destination, 'w:gz', dereference=True) as archive:
        for root, dirs, files in os.walk(uploads, followlinks=False, onerror=walk_error):
            for path in [Path(root)] + [Path(root) / name for name in files + dirs]:
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise ValueError('Uploads contain a link or special file; backup refused.')
            archive.add(root, arcname=str(Path(root).relative_to(data)), recursive=False)
            for name in files:
                path = Path(root) / name
                archive.add(path, arcname=str(path.relative_to(data)), recursive=False)


def extract_uploads(archive_path, destination):
    # No tar.extract/all: reject traversal, links, devices and duplicate members.
    seen = set()
    with tarfile.open(archive_path, 'r:gz') as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if (not path.parts or path.parts[0] != 'uploads' or path.is_absolute()
                    or '..' in path.parts or '\\' in member.name or ':' in member.name
                    or str(path) in seen or not (member.isdir() or member.isfile())):
                raise ValueError('Unsafe uploads archive member.')
            seen.add(str(path))
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.extractfile(member) as source, open(target, 'xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o600)
    if not (destination / 'uploads').is_dir():
        raise ValueError('Archive has no uploads directory.')


def backup(stack, data, root, keep):
    data = Path(data).resolve(strict=True)
    stack.validate_data(data, existing=True)
    root = Path(root).resolve()
    if root == data or data in root.parents or root in data.parents:
        raise ValueError('Backup and data directories must not contain one another.')
    if keep < 1:
        raise ValueError('Keep at least one completed snapshot.')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    name = 'vtt-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid4().hex[:8]
    stage = root / ('.incomplete-' + name)
    stage.mkdir(mode=0o700)
    manifest = {'format': 1, 'images': stack.images(), 'config': config_identity(stack)}
    running = stack.running()
    try:
        if running:
            stack.run('stop', 'backend')
        if stack.running():
            raise ValueError('Backend did not stop; backup refused.')
        manifest['schema'] = stack.schema()
        with open(stage / 'database.dump', 'xb') as output:
            stack.run('exec', '-T', 'database', 'sh', '-c',
                      'exec pg_dump -Fc --no-owner --no-privileges --exclude-table-data=public.session -U "$POSTGRES_USER" -d "$POSTGRES_DB"', output=output)
        archive_uploads(data, stage / 'uploads.tar.gz')
        manifest['sha256'] = {name: digest(stage / name) for name in ('database.dump', 'uploads.tar.gz')}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for file in stage.iterdir():
            file.chmod(0o600)
        final = root / name
        stage.rename(final)
    finally:
        if running:
            stack.run('start', 'backend')
    # Only our completed, valid snapshots in this exact directory are eligible.
    completed = []
    for path in root.iterdir():
        if SNAPSHOT_NAME.fullmatch(path.name) and path.is_dir() and not path.is_symlink():
            try:
                verify_snapshot(path)
                completed.append(path)
            except (OSError, ValueError, KeyError):
                continue
    for old in sorted(completed, key=lambda p: (p == final, p.stat().st_mtime_ns, p.name), reverse=True)[keep:]:
        shutil.rmtree(old)
    return final


def restore(stack, snapshot, data):
    snapshot = Path(snapshot).resolve(strict=True)
    verify_snapshot(snapshot)
    data = Path(data).resolve(strict=True)
    stack.validate_data(data)
    uploads = data / 'uploads'
    if stack.running() or stack.sql(EMPTY_DB) != '0':
        raise ValueError('Restore requires a stopped backend and an empty database in a separate project.')
    if uploads.is_symlink() or (uploads.exists() and (not uploads.is_dir() or any(uploads.iterdir()))):
        raise ValueError('Restore requires an empty uploads destination.')
    stage = Path(tempfile.mkdtemp(prefix='.restore-', dir=data))
    # Stage and validate all files BEFORE touching the database. Failure leaves evidence.
    extract_uploads(snapshot / 'uploads.tar.gz', stage)
    with open(snapshot / 'database.dump', 'rb') as source:
        stack.run('exec', '-T', 'database', 'sh', '-c',
                  'exec pg_restore --single-transaction --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"', input=source)
    if uploads.exists():
        uploads.rmdir()  # Previously verified empty; never recursively delete a destination.
    (stage / 'uploads').rename(uploads)
    stage.rmdir()
    # Deliberately leave backend stopped for operator validation and proxy cutover.


def rollback(stack, snapshot):
    manifest = verify_snapshot(snapshot)
    if config_identity(stack) != manifest['config']:
        raise ValueError('Deployment configuration changed; use the reviewed matching configuration first.')
    if stack.schema() != manifest['schema']:
        raise ValueError('Schema changed: restore into a separate project; image-only rollback refused.')
    images = manifest['images']
    if set(images) != set(SERVICES) or any(not re.fullmatch(r'sha256:[0-9a-f]{64}', image) for image in images.values()):
        raise ValueError('Invalid rollback image IDs.')
    # Pulling by a mutable tag or silently rebuilding is never a rollback.
    for image in images.values():
        subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True)
    with tempfile.TemporaryDirectory(prefix='vtt-rollback-') as directory:
        override = Path(directory) / 'images.json'
        override.write_text(json.dumps({'services': {service: {'image': image} for service, image in images.items()}}))
        stack.run('up', '-d', '--no-build', '--pull', 'never', '--no-deps', *SERVICES, overrides=[override])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose-file', required=True)
    parser.add_argument('--env-file', required=True, help='Non-secret operator settings only')
    commands = parser.add_subparsers(dest='operation', required=True)
    command = commands.add_parser('backup')
    command.add_argument('--data-dir', required=True)
    command.add_argument('--backup-root', required=True)
    command.add_argument('--keep', type=int, default=14)
    command.add_argument('--allow-stop', required=True, action='store_true', help='Acknowledge a brief backend interruption')
    command = commands.add_parser('restore')
    command.add_argument('--snapshot', required=True)
    command.add_argument('--data-dir', required=True)
    command.add_argument('--confirm-empty-target', required=True, action='store_true')
    command = commands.add_parser('rollback')
    command.add_argument('--snapshot', required=True)
    command.add_argument('--allow-recreate', required=True, action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    stack = Stack(args.compose_file, args.env_file)
    # Linux host tooling. A shared settings file identifies a recovery boundary.
    # Coordinate deployments separately; this lock serializes this tool's runs.
    import fcntl
    lock = open(stack.env_file.with_name(stack.env_file.name + '.recovery.lock'), 'a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.operation == 'backup':
            backup(stack, args.data_dir, args.backup_root, args.keep)
        elif args.operation == 'restore':
            restore(stack, args.snapshot, args.data_dir)
        else:
            rollback(stack, args.snapshot)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError, tarfile.TarError):
        # Exceptions from subprocess/archives may carry host paths or app data.
        parser.exit(1, 'Recovery operation refused or failed. Keep incomplete files; inspect locally.\n')
    finally:
        lock.close()
    print('Operation completed. Verify health/restore before relying on this result.')


if __name__ == '__main__':
    main()
