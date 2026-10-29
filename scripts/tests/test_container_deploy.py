"""Deployment tool tests: synthetic files and a recording Docker double only."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
OPS = ROOT / 'ops' / 'deploy'
spec = importlib.util.spec_from_file_location('recovery', OPS / 'recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


class SecretTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.values = {'database_password': b'a' * 32, 'session_secret': b'b' * 64, 'setup_token': b'c' * 64}
        self.reset()
        self.shell = str(Path('C:/Program Files/Git/bin/bash.exe')) if os.name == 'nt' else shutil.which('sh')
        if not self.shell:
            self.skipTest('POSIX shell required')

    def reset(self):
        for name, value in self.values.items():
            (self.directory / name).write_bytes(value)

    def execute(self, **extra):
        env = dict(os.environ, VTT_SECRETS_DIR=self.directory.as_posix(), **extra)
        result = subprocess.run([self.shell, '-c', '. "$1"; test -n "$DATABASE_URL"; test -n "$SESSION_SECRET"; test -n "$SETUP_TOKEN"',
                                 'test', (OPS / 'load-secrets.sh').as_posix()], env=env, capture_output=True)
        # Errors and successful runs must never contain fixture values.
        for value in self.values.values():
            self.assertNotIn(value, result.stdout + result.stderr)
        self.assertEqual(result.stdout, b'')
        return result.returncode

    def test_valid_files_with_optional_single_final_lf(self):
        self.assertEqual(self.execute(), 0)
        for name, value in self.values.items():
            (self.directory / name).write_bytes(value + b'\n')
        self.assertEqual(self.execute(), 0)

    def test_each_missing_or_malformed_file_refuses_start(self):
        for name, value in self.values.items():
            for invalid in (b'', b' ' * len(value), value[:-1], value + b'0' * 129,
                            value.upper(), value[:8] + b'\n' + value[8:], value + b'\n\n',
                            value + b'\r\n', value[:-1] + b'\x00', b'/' + value[1:]):
                with self.subTest(name=name, invalid=repr(invalid[:5])):
                    self.reset()
                    (self.directory / name).write_bytes(invalid)
                    self.assertNotEqual(self.execute(), 0)
            self.reset()
            (self.directory / name).unlink()
            self.assertNotEqual(self.execute(), 0)

    def test_database_url_identifiers_cannot_inject_url_parts(self):
        for invalid in ('', '1name', 'user@host', 'a/b', 'a b', 'a' * 64):
            # Empty explicitly follows the documented default, not injection.
            if invalid:
                self.assertNotEqual(self.execute(DATABASE_USER=invalid), 0)
                self.assertNotEqual(self.execute(DATABASE_NAME=invalid), 0)


class FakeStack:
    def __init__(self, directory):
        self.compose_file = directory / 'compose.yaml'
        self.compose_file.write_text('services: {}\n')
        self.env_file = directory / 'settings.env'
        self.env_file.write_text('VTT_BACKEND_IMAGE=old\nCORS_ORIGIN=https://example.invalid\n')
        self.calls = []
        self.active = True
        self.empty = True
        self.migrations = 'migration\tchecksum'
        self.fail_dump = False
        self.fail_restore = False

    def images(self):
        return {service: 'sha256:' + 'a' * 64 for service in recovery.SERVICES}

    def configuration(self):
        settings = dict(line.split('=', 1) for line in self.env_file.read_text().splitlines() if '=' in line)
        settings.update(getattr(self, 'environment_overrides', {}))
        backend = settings.pop('VTT_BACKEND_IMAGE', 'backend')
        frontend = settings.pop('VTT_FRONTEND_IMAGE', 'frontend')
        source = settings.pop('VITE_SOURCE_CODE_URL', 'source')
        return {'services': {'backend': {'image': backend, 'environment': settings},
                             'frontend': {'image': frontend, 'build': {'args': {'VITE_SOURCE_CODE_URL': source}}}}}

    def running(self):
        return self.active

    def validate_data(self, data, existing=False):
        pass

    def runtime_files(self):
        return {'fixture': getattr(self, 'runtime_hash', 'unchanged')}

    def schema(self):
        return {'history': self.migrations, 'schema': self.migrations}

    def sql(self, query):
        self.calls.append(('sql', query))
        return ('0' if self.empty else '1') if query == recovery.EMPTY_DB else self.migrations

    def run(self, *args, output=None, input=None, overrides=()):
        self.calls.append(args)
        if args == ('stop', 'backend'):
            self.active = False
        if args == ('start', 'backend'):
            self.active = True
        if output:
            output.write(b'synthetic dump, no credentials or user data')
            if self.fail_dump:
                raise RuntimeError('simulated dump failure')
        if input:
            if self.fail_restore:
                raise RuntimeError('simulated transaction failure')
            if input.read() != b'synthetic dump, no credentials or user data':
                raise RuntimeError('unexpected input')
        if overrides:
            self.override = json.loads(Path(overrides[0]).read_text())
        return ''


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / 'data'
        (self.data / 'uploads' / 'nested').mkdir(parents=True)
        (self.data / 'uploads' / 'nested' / 'fixture.txt').write_text('synthetic asset')
        self.backups = self.root / 'snapshots'
        self.stack = FakeStack(self.root)

    def snapshot(self):
        return recovery.backup(self.stack, self.data, self.backups, 14)

    def test_consistent_backup_restore_leaves_backend_stopped(self):
        snapshot = self.snapshot()
        self.assertEqual(self.stack.calls[0], ('stop', 'backend'))
        self.assertEqual(self.stack.calls[-1], ('start', 'backend'))
        self.assertTrue(any('--exclude-table-data=public.session' in str(call) for call in self.stack.calls))
        self.stack.calls.clear()
        self.stack.active = False
        target = self.root / 'restored'
        target.mkdir()
        recovery.restore(self.stack, snapshot, target)
        self.assertEqual((target / 'uploads/nested/fixture.txt').read_text(), 'synthetic asset')
        self.assertTrue(any('--single-transaction' in str(call) for call in self.stack.calls))
        self.assertNotIn(('start', 'backend'), self.stack.calls)

    def test_dump_failure_restarts_only_previously_running_backend(self):
        self.stack.fail_dump = True
        with self.assertRaises(RuntimeError):
            self.snapshot()
        self.assertEqual(self.stack.calls[-1], ('start', 'backend'))
        self.assertFalse(any(recovery.SNAPSHOT_NAME.fullmatch(p.name) for p in self.backups.iterdir()))
        self.stack.calls.clear()
        self.stack.active = False
        with self.assertRaises(RuntimeError):
            self.snapshot()
        self.assertNotIn(('start', 'backend'), self.stack.calls)

    def test_retention_preserves_new_snapshot_and_unrelated_files(self):
        self.snapshot()
        unrelated = self.backups / 'unrelated'
        unrelated.mkdir()
        newest = recovery.backup(self.stack, self.data, self.backups, 1)
        self.assertTrue(newest.exists())
        self.assertTrue(unrelated.exists())
        self.assertEqual(sum(bool(recovery.SNAPSHOT_NAME.fullmatch(p.name)) for p in self.backups.iterdir()), 1)

    def test_checksum_corruption_refuses_before_database_access(self):
        snapshot = self.snapshot()
        (snapshot / 'database.dump').write_bytes(b'corrupted')
        self.stack.calls.clear()
        with self.assertRaises(ValueError):
            recovery.restore(self.stack, snapshot, self.data)
        self.assertEqual(self.stack.calls, [])

    def test_restore_refuses_live_or_nonempty_target(self):
        snapshot = self.snapshot()
        for active, empty in ((True, True), (False, False)):
            self.stack.active, self.stack.empty = active, empty
            with self.assertRaises(ValueError):
                recovery.restore(self.stack, snapshot, self.data)
        self.stack.active, self.stack.empty = False, True
        with self.assertRaises(ValueError):
            recovery.restore(self.stack, snapshot, self.data)

    def test_restore_failure_never_starts_app_or_overwrites_uploads(self):
        snapshot = self.snapshot()
        self.stack.active = False
        self.stack.fail_restore = True
        self.stack.calls.clear()
        target = self.root / 'fresh'
        target.mkdir()
        with self.assertRaises(RuntimeError):
            recovery.restore(self.stack, snapshot, target)
        self.assertFalse((target / 'uploads').exists())
        self.assertNotIn(('start', 'backend'), self.stack.calls)

    def test_traversal_and_links_are_rejected(self):
        for name, kind in (('../escape', tarfile.REGTYPE), ('/uploads/escape', tarfile.REGTYPE),
                           ('uploads/../../escape', tarfile.REGTYPE), ('uploads/link', tarfile.SYMTYPE),
                           ('uploads/device', tarfile.CHRTYPE), ('uploads\\escape', tarfile.REGTYPE)):
            with self.subTest(name=name):
                archive = self.root / 'bad.tar.gz'
                with tarfile.open(archive, 'w:gz') as output:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    output.addfile(member, io.BytesIO())
                with self.assertRaises(ValueError):
                    recovery.extract_uploads(archive, self.root / 'extract')
        self.assertFalse((self.root / 'escape').exists())

    def test_rollback_refuses_schema_or_config_changes(self):
        snapshot = self.snapshot()
        self.stack.migrations = 'new schema'
        with self.assertRaises(ValueError):
            recovery.rollback(self.stack, snapshot)
        self.stack.migrations = 'migration\tchecksum'
        self.stack.env_file.write_text('CORS_ORIGIN=https://changed.invalid\n')
        with self.assertRaises(ValueError):
            recovery.rollback(self.stack, snapshot)

    def test_rollback_refuses_changed_bind_mounted_runtime(self):
        snapshot = self.snapshot()
        self.stack.runtime_hash = 'modified loader or nginx'
        with self.assertRaises(ValueError):
            recovery.rollback(self.stack, snapshot)

    def test_rollback_refuses_process_environment_override(self):
        snapshot = self.snapshot()
        self.stack.environment_overrides = {'CORS_ORIGIN': 'https://override.invalid'}
        with self.assertRaises(ValueError):
            recovery.rollback(self.stack, snapshot)

    def test_walk_error_does_not_publish_snapshot(self):
        def broken_walk(*args, **kwargs):
            kwargs['onerror'](PermissionError('synthetic unreadable directory'))
            return iter(())
        with patch.object(recovery.os, 'walk', side_effect=broken_walk):
            with self.assertRaises(PermissionError):
                self.snapshot()
        self.assertEqual(self.stack.calls[-1], ('start', 'backend'))
        self.assertFalse(any(recovery.SNAPSHOT_NAME.fullmatch(p.name) for p in self.backups.iterdir()))

    def test_hardlinks_are_stored_as_regular_content(self):
        try:
            os.link(self.data / 'uploads/nested/fixture.txt', self.data / 'uploads/hardlink.txt')
        except OSError:
            self.skipTest('Hardlinks unavailable')
        snapshot = self.snapshot()
        with tarfile.open(snapshot / 'uploads.tar.gz') as archive:
            self.assertTrue(all(member.isdir() or member.isfile() for member in archive))
        self.stack.active = False
        target = self.root / 'hardlink-restore'
        target.mkdir()
        recovery.restore(self.stack, snapshot, target)
        self.assertEqual((target / 'uploads/hardlink.txt').read_text(), 'synthetic asset')

    def test_rollback_uses_immutable_images_without_build_or_pull(self):
        snapshot = self.snapshot()
        self.stack.env_file.write_text('VTT_BACKEND_IMAGE=new\nCORS_ORIGIN=https://example.invalid\n')
        with patch.object(recovery.subprocess, 'run') as command:
            recovery.rollback(self.stack, snapshot)
            self.assertEqual(command.call_count, 3)
        self.assertIn('--no-build', self.stack.calls[-1])
        self.assertIn('never', self.stack.calls[-1])
        self.assertEqual(self.stack.override['services']['backend']['image'], 'sha256:' + 'a' * 64)

    def test_real_stack_refuses_unstable_container_states(self):
        stack = recovery.Stack(self.stack.compose_file, self.stack.env_file)
        with patch.object(stack, 'run', return_value='container'), patch.object(recovery.subprocess, 'run') as process:
            for state in ({'Status': 'restarting', 'Restarting': True},
                          {'Status': 'paused', 'Paused': True}, {'Status': 'dead', 'Dead': True}):
                process.return_value.stdout = json.dumps(state)
                with self.assertRaises(ValueError):
                    stack.running()
            process.return_value.stdout = json.dumps({'Status': 'exited', 'Running': False})
            self.assertFalse(stack.running())

    def test_actual_upload_mount_must_match_configured_directory(self):
        stack = recovery.Stack(self.stack.compose_file, self.stack.env_file)
        config = {'services': {'backend': {'volumes': [{'type': 'bind', 'target': '/app/uploads',
                                                       'source': str(self.data / 'uploads')}]}}}
        with patch.object(stack, 'run', side_effect=[json.dumps(config), 'container']), patch.object(recovery.subprocess, 'run') as process:
            process.return_value.stdout = json.dumps([{'Type': 'bind', 'Destination': '/app/uploads',
                                                       'Source': str(self.root / 'different/uploads')}])
            with self.assertRaises(ValueError):
                stack.validate_data(self.data, existing=True)

    def test_schema_fingerprint_includes_history_and_ddl_not_random_marker(self):
        stack = recovery.Stack(self.stack.compose_file, self.stack.env_file)
        with patch.object(stack, 'sql', side_effect=['0', 'history', '0', 'history', '0', 'changed history']), \
                patch.object(stack, 'run', side_effect=['-- comment\n\\restrict abc\nCREATE TABLE a();\n\\unrestrict abc',
                                                     '\\restrict xyz\nCREATE TABLE a();\n\\unrestrict xyz',
                                                     'CREATE TABLE a();']):
            first, second, third = stack.schema(), stack.schema(), stack.schema()
            self.assertEqual(first, second)
            self.assertNotEqual(first, third)
        with patch.object(stack, 'sql', return_value='1'):
            with self.assertRaises(ValueError):
                stack.schema()


if __name__ == '__main__':
    unittest.main()
