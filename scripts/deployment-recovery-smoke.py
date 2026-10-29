#!/usr/bin/env python3
"""Disposable PostgreSQL restore drill; no host ports, accounts or real secrets.

Only run on a test Docker daemon. Creates unique projects and removes them in
finally. Database authentication is trust ONLY on this isolated test network.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'ops/deploy/recovery.py')
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def project(directory, suffix):
    directory.mkdir()
    data = directory / 'data'
    (data / 'uploads').mkdir(parents=True)
    env = directory / 'settings.env'
    env.write_text('# Synthetic drill; no secrets.\n')
    image = 'postgres:15-alpine'
    sleeper = {'image': image, 'entrypoint': ['sleep', '3600'], 'networks': ['isolated']}
    config = {
        'name': 'vtt-drill-' + suffix,
        'services': {
            'database': {'image': image, 'environment': {'POSTGRES_DB': 'vtt_test', 'POSTGRES_USER': 'postgres',
                                                       'POSTGRES_HOST_AUTH_METHOD': 'trust'},
                         'tmpfs': ['/var/lib/postgresql/data'], 'networks': ['isolated'],
                         'healthcheck': {'test': ['CMD', 'pg_isready', '-U', 'postgres', '-d', 'vtt_test'],
                                         'interval': '1s', 'timeout': '3s', 'retries': 30}},
            'backend': dict(sleeper, volumes=[
                f'{data / "uploads"}:/app/uploads',
                f'{ROOT / "ops/deploy/load-secrets.sh"}:/opt/vtt/load-secrets.sh:ro',
                f'{ROOT / "ops/deploy/secrets-entrypoint.sh"}:/opt/vtt/secrets-entrypoint.sh:ro']),
            'frontend': dict(sleeper),
            'nginx': dict(sleeper, volumes=[
                f'{ROOT / "nginx/nginx.conf"}:/etc/nginx/templates/default.conf.template:ro',
                f'{ROOT / "nginx/locations.conf"}:/etc/nginx/cozyvtt/locations.conf:ro',
                f'{ROOT / "nginx/trusted-proxies.envsh"}:/docker-entrypoint.d/19-cozyvtt-trusted-proxies.envsh:ro',
                f'{ROOT / "nginx/conf.d"}:/etc/nginx/cozyvtt.d:ro'])},
        'networks': {'isolated': {'internal': True}}}
    compose = directory / 'compose.json'
    compose.write_text(json.dumps(config))
    return recovery.Stack(compose, env), data


def main():
    if os.name != 'posix':
        raise SystemExit('This disposable Docker drill requires Linux.')
    os.umask(0o077)
    stacks = []
    with tempfile.TemporaryDirectory(prefix='vtt-recovery-drill-') as temporary:
        directory = Path(temporary)
        try:
            source, data = project(directory / 'source', uuid4().hex[:12])
            stacks.append(source)
            source.run('up', '-d', '--wait', '--wait-timeout', '90')
            source.sql('''CREATE TABLE "_prisma_migrations" (id text, migration_name text, checksum text,
started_at timestamptz, finished_at timestamptz, rolled_back_at timestamptz, applied_steps_count integer);
INSERT INTO "_prisma_migrations" VALUES ('fixture', 'fixture', 'fixture', now(), now(), NULL, 1);
CREATE TABLE recovery_fixture (value text); INSERT INTO recovery_fixture VALUES ('synthetic');
CREATE TABLE session (sid text); INSERT INTO session VALUES ('excluded synthetic session');''')
            (data / 'uploads/fixture.txt').write_text('synthetic asset')
            snapshot = recovery.backup(source, data, directory / 'snapshots', 2)
            assert source.running()
            recovery.rollback(source, snapshot)
            target, restored = project(directory / 'target', uuid4().hex[:12])
            stacks.append(target)
            target.run('up', '-d', '--wait', '--wait-timeout', '90', 'database')
            recovery.restore(target, snapshot, restored)
            assert target.sql('SELECT value FROM recovery_fixture') == 'synthetic'
            assert target.sql('SELECT count(*) FROM session') == '0'
            assert (restored / 'uploads/fixture.txt').read_text() == 'synthetic asset'
            assert not target.running()
            source.sql('ALTER TABLE recovery_fixture ADD COLUMN changed text')
            try:
                recovery.rollback(source, snapshot)
            except ValueError:
                pass
            else:
                raise AssertionError('Changed schema incorrectly allowed image rollback')
            print('Disposable PostgreSQL backup, restore, session exclusion and rollback drill passed.')
        finally:
            for stack in reversed(stacks):
                # Every project here has a generated unique name, no published
                # ports and only disposable tmpfs database state.
                subprocess.run(stack.base + ['down', '--volumes', '--remove-orphans'], check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


if __name__ == '__main__':
    main()
