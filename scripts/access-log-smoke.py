"""Exercise both running Compose Nginx services using only synthetic markers.

Run after `docker compose up`. No real reset token or account is used.
"""
import datetime
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid


def main():
    since = datetime.datetime.now(datetime.timezone.utc).isoformat()
    marker = uuid.uuid4().hex
    path = '/log-probe-' + marker
    query = 'query-secret-' + marker
    referer = 'referer-secret-' + marker
    url = os.environ.get('LOG_TEST_URL', 'http://localhost:8080').rstrip('/')
    request = urllib.request.Request(url + path + '?token=' + query,
                                     headers={'Referer': 'https://example.invalid/' + referer})
    with urllib.request.urlopen(request, timeout=20) as response:
        assert response.status == 200
    # Nginx writes access logs when each request completes.
    time.sleep(1)
    for service in ('nginx', 'frontend'):
        container = subprocess.check_output(
            ['docker', 'compose', 'ps', '-q', service], text=True).strip()
        assert container, 'Missing service: ' + service
        result = subprocess.run(['docker', 'logs', '--since', since, container],
                                capture_output=True, text=True, check=True)
        logs = result.stdout + result.stderr
        assert query not in logs and referer not in logs, 'Sensitive marker in ' + service
        records = []
        for line in logs.splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get('path') == path:
                records.append(entry)
        assert records, 'Original request path missing in ' + service
        assert all(r['method'] == 'GET' and r['status'] == 200 and
                   isinstance(r['request_time'], (int, float)) and
                   'bytes' in r and 'upstream_time' in r for r in records)
        print(service + ': query and Referer absent; path, method, status and timing preserved')


if __name__ == '__main__':
    main()
