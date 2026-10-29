# File-secret deployment behind an existing container proxy

This optional Linux deployment uses the unmodified application Dockerfiles and
the upstream nginx routing rules. It publishes **no host ports**. Only nginx
joins an existing proxy network; database, backend and frontend share a separate
project network. A network named `internal` is not an egress firewall.
This directory installs no users, credentials, scheduled jobs or firewall rules.
Treat `compose.yaml` as a reviewed alternative to the root Compose file, not an
override for it. Never run either Compose file against another application's data.

## Release and private settings

Publish the complete release first, including these installation/runtime scripts.
From a clean checkout, obtain `git rev-parse HEAD`; set `VITE_SOURCE_CODE_URL` to
the public URL of that exact full commit. Build the frontend again whenever the
release changes, even for deployment-only changes. Keep the public source link
visible on setup/sign-in pages and verify it in the final browser build.

Copy `settings.example.env` outside the checkout and replace every `CHANGE_ME`.
Use distinct release image tags, a unique Compose project and an operator-owned
private data directory. Create that directory with mode `0700` before Docker
creates its `uploads`, `backups` and `logs` children. Preserve it through updates.
Use an absolute path for every directory. Settings contain no passwords/tokens.
Do not publish a filled settings file, host inventory, real proxy addresses,
credentials or user data. No authenticated SMTP secret is wired by this profile;
add a reviewed file-secret adapter before enabling authenticated SMTP.

Using operator-chosen absolute paths in `$SETTINGS` and `$COMPOSE`:

```sh
docker compose --env-file "$SETTINGS" -f "$COMPOSE" config --quiet
docker compose --env-file "$SETTINGS" -f "$COMPOSE" build backend frontend
```

The host needs Docker Compose v2+, Python 3.10+, and storage for the database,
uploads and backups. Build success/configuration validation do not validate an
installation, backup restoration or its public proxy.

## Existing, authorized secret files

Only after the operator authorizes credential provisioning, prepare these files
in the chosen secret directory (`0700`, root-owned; files `0400`, root-owned):

| File | Format | Purpose |
| --- | --- | --- |
| `database_password` | 32–128 lowercase hexadecimal characters | Dedicated database password |
| `session_secret` | Exactly 64 lowercase hexadecimal characters | Persistent session signing secret |
| `setup_token` | Exactly 64 lowercase hexadecimal characters | Initial administrator setup |

Each file may have one final LF, with no other whitespace or bytes. The loader
refuses missing, malformed or undersized files without printing contents. It
generates nothing. PostgreSQL receives `POSTGRES_PASSWORD_FILE`; the backend
adapter reads the files and exports values only to its process environment before
the existing entrypoint drops privileges. This keeps values out of Docker's
configured `Env`, but **not** out of process memory/environment or a privileged
administrator's reach. Do not print `/proc/*/environ`, full inspection output or
debug traces. A new `docker exec` process does not inherit PID 1's exported values.

Changing the password file alone does not rotate an initialized database's
password. Follow a separate reviewed rotation procedure that updates both sides.
Never share these files with another service.

### Setup token lifecycle and private handoff

Provide the token privately through the operator's existing authenticated access,
never a chat, screenshot, command log, URL/query string or repository. The owner
enters it and chooses their administrator credentials in the setup wizard.
Do not create a provisional administrator. Until this is complete, keep the
installation private or behind an already authorized access boundary.

The configured token suppresses random-token logging. The backend validates it
before account creation; a database transaction and registration advisory lock
ensure only one first administrator wins. Verify `/api/setup/status` reports
`setupCompleted: true` before sharing the public address. Test refusal with a
wrong token on a disposable instance, not by racing the real owner's setup.

**Retain the restricted token file after setup.** It has no ability to create
another administrator once setup is complete, but this profile still requires it
on every start. Deleting just the file breaks restarts. Retiring the file needs a
separate coordinated change to the loader and Compose mounts. For a genuinely new
database, obtain fresh provisioning authorization; never assume an old token is
an appropriate new bootstrap credential.

## Proxy and browser checks

Set `VTT_TRUSTED_PROXIES` to the exact address(es) of the upstream proxy as seen
by nginx, not all private networks. The upstream proxy must independently trust
only its legitimate edge/CDN and overwrite forwarded headers from its validated
client identity. For Caddy with a correctly configured `client_ip` source, the
new site's reverse-proxy portion can use:

```caddyfile
reverse_proxy vtt-proxy:80 {
    header_up X-Forwarded-For {client_ip}
    header_up X-Forwarded-Proto {scheme}
}
```

This is not a complete Caddyfile or an instruction to change global trust. Keep
existing TLS, origin authentication, network restrictions and other sites intact.
Back up the existing configuration, validate the full candidate before reload,
and verify health/API JSON, Secure cookies, real client IP and a WebSocket upgrade.
Preserve nginx's frontend CSP and upload/time-out routing. Account for CDN body
and request-time limits separately, particularly for large backup restores.

The CharacterMaker integration uses a popup, not an iframe. Configure both exact
origins only after deploying the paired producer. Check actual HTML/login routes
for opener isolation and exercise consent with disposable owned data. Do not
weaken CSP/COOP globally to make it work. This remains an in-memory read-only
snapshot, with no saved character import or synchronization.

## Consistent backup, restoration and image rollback

`recovery.py` uses the selected Compose project and checks that `--data-dir`
matches its uploads bind mount. It never chooses a project implicitly. A settings
file lock serializes this tool's operations; operators must also coordinate
deployments and other writers. Run it as the account that can read the private
data directory and control this project.

```sh
python3 recovery.py --compose-file "$COMPOSE" --env-file "$SETTINGS" \
  backup --data-dir "$DATA" --backup-root "$BACKUPS" --keep 14 --allow-stop
```

Backup briefly stops only this backend, writes a custom-format database dump
(excluding login sessions), and archives uploads while application writes are
stopped. It records checksums, full migration/schema fingerprints, image IDs and configuration
hashes. It restarts only a backend that was previously running, including after a
backup failure. Completed snapshots are atomically named; incomplete directories
are retained for diagnosis and never counted/pruned. Retention removes only this
tool's completed checksum-valid snapshots. Dumps contain private records and
password hashes: directories are `0700`, files `0600`. Copy snapshots to protected
off-host storage and verify recovery; a successful dump is not a restore test.

There is no scheduler installation here. Approve a maintenance window/cadence
before scheduling, since each consistent backup interrupts this VTT backend.
Do not back up a live PostgreSQL volume as an ordinary file tree. Infrastructure
secret files are deliberately excluded: arrange their separate encrypted backup
and recovery authorization. Preserve the previous images locally and, for a host
loss, export them or record/recover their immutable registry digests separately.

Restore only to a **separate project with a running empty database and a stopped,
not-yet-initialized backend**, new private data directory and separately approved
credentials. Use a different proxy alias and keep it out of public routing:

```sh
python3 recovery.py --compose-file "$RECOVERY_COMPOSE" --env-file "$RECOVERY_SETTINGS" \
  restore --snapshot "$SNAPSHOT" --data-dir "$RECOVERY_DATA" --confirm-empty-target
```

The tool verifies archive checksums before database access, refuses a running
backend/nonempty database/uploads destination, rejects traversal, links and
special archive members, and uses a single database transaction. It never drops
a database, overwrites nonempty uploads or starts the restored application. It
leaves staging files on failure; diagnose rather than delete the original data.
After restoration, start the matching application version privately, check
health, settings, records and uploads, then explicitly approve proxy cutover.

For an application-only rollback with unchanged migrations/configuration:

```sh
python3 recovery.py --compose-file "$COMPOSE" --env-file "$SETTINGS" \
  rollback --snapshot "$SNAPSHOT" --allow-recreate
```

It refuses changed migration/schema/configuration fingerprints or missing old images,
then recreates only backend/frontend/nginx using immutable local image IDs, with
no build, pull or database recreation. Image/source references may differ in the
settings file; other effective settings and the mounted runtime script/nginx hashes
must match the snapshot. Shell environment overrides are included in that check.
After rollback, persist
those old image IDs and the corresponding source URL in the private settings so
a later ordinary `up` cannot accidentally upgrade again. Verify health and the
compiled source link. If migrations/configuration changed, use the separate
restoration procedure instead of downgrading images against an incompatible DB.

## Verification

`python3 -m unittest discover -s scripts/tests -p test_container_deploy.py` tests
synthetic invalid secrets, backup failure/restart, checksums, retention, archive
traversal, empty-target restoration and schema/configuration rollback guards.
These use recording Docker doubles, not production or real credentials. CI also
validates the Compose profile without starting it and runs
`scripts/deployment-recovery-smoke.py`: two disposable isolated Docker projects,
no host ports, synthetic records, a real PostgreSQL dump/restore, excluded sessions
and an incompatible-schema rollback refusal. This drill uses trust authentication
only inside its disposable network, never in the deployment profile. Repeat a
private restore drill with the actual operational configuration before relying on
production recovery.
