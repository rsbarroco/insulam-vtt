# Insulam fork development

## Branch and upstream

The initial development branch is `insulam/foundation`. Changes are reviewed in
a **draft PR to this fork**, not a PR to CozyVTT. Keep upstream history and its
license/notices. Do not push to the original author's repository.

```sh
git clone https://github.com/rsbarroco/insulam-vtt.git
cd insulam-vtt
git remote add upstream https://github.com/CheekyChinchilla/CozyVTT.git
git fetch upstream
```

For updates, make a separate review branch, inspect upstream changes, merge
there and run checks before integrating. Do not reset the fork onto upstream or
overwrite local work. Preserve upstream compatibility identifiers such as
`.cozyvtt` archives and storage keys unless a future migration explicitly
handles them.

## Local-only setup

Follow [DEVELOPMENT.md](DEVELOPMENT.md), using a disposable local PostgreSQL
instance. Upstream requires **Node 26+**, npm 11+, and PostgreSQL 14+ (or its
Docker development stack). Do not point tests/migrations at a real account or
production database. Dependency lifecycle scripts must be reviewed before
execution; a first inspection install can use `npm ci --ignore-scripts`.

Primary checks:

```sh
cd frontend
npm run typecheck
npm run lint
npm run test:run
npm run build
cd ../backend
npm run build
npm run lint
npm test -- --runInBand
cd ..
python3 scripts/spec-coverage.py
python3 scripts/websocket-events.py --check
python3 -m unittest discover -s scripts/tests
```

The backend test suite requires a disposable database with `test` in its name;
read the upstream test setup before running it. Full release validation also
includes Docker image/nginx and browser smoke tests from the upstream CI.
A contract-only/unit check is not a substitute for those gates.

## Branding and public source

- `frontend/src/config/brand.ts`: public name, development mark, links.
- `backend/src/config/brand.ts`: defaults for new settings rows and fallback
  emails. Existing saved names/settings are preserved; no schema migration.
- `frontend/public/insulam-mark.svg`: original placeholder monogram, not a final
  commissioned Insulam brand asset. Upstream artwork is retained with notices
  but is no longer used as the primary default mark.
- Source and CozyVTT credit links appear on public/authenticated routes and the
  default render-error screen. The error screen links to this fork, not upstream;
  its issue tracker is not enabled yet, so no working issue-submission flow is promised.
- Upstream system/theme names, package names, database defaults, archive format,
  MFA issuer and some secondary copy intentionally remain unchanged in this
  first incremental branding pass.

### Release source link: Docker and manual builds

`VITE_SOURCE_CODE_URL` is **public build-time metadata**, not a runtime setting.
Set it to the public commit containing the complete source that matches the
release being built, including local modifications and build instructions.
Publish that source first; a private commit, an unrelated commit or a moving
branch is not a matching source offer. Never put API keys, credentials, signed
download URLs or user data in `VITE_*`; these values reach the browser bundle.

For **production Docker builds**, set the variable in the root `.env` or the
build process environment. Compose passes it through `frontend.build.args`
to `frontend/Dockerfile.prod`, which supplies it to Vite in the builder stage.
The nginx runtime does not read it. For a clean checkout of the already
published release commit, from the repository root:

```sh
# Review/publish the complete source first; do not build uncommitted changes.
test -z "$(git status --porcelain)" || exit 1
export VITE_SOURCE_CODE_URL="https://github.com/rsbarroco/insulam-vtt/tree/$(git rev-parse HEAD)"
: "${VITE_SOURCE_CODE_URL:?Set the public matching release source URL}"
docker compose build frontend
```

Verify that this exact public commit can be opened without signing in before
publishing the image. Rebuild on every release/source URL change; restarting a
container or setting an nginx runtime environment variable cannot update the
compiled footer. Starting/replacing the running service is a separate deployment
step, not part of this build example.

For a **manual frontend build**, from `frontend/`:

```sh
VITE_SOURCE_CODE_URL=https://github.com/rsbarroco/insulam-vtt/tree/RELEASE_COMMIT npm run build
```

Replace `RELEASE_COMMIT` with the full actual published commit SHA. Only
credential-free HTTPS source URLs are accepted by the existing UI sanitizer.
If absent, empty or invalid, the UI links to the public fork repository. Docker
uses the same repository fallback, **not an exact-release guarantee**: an
operator must supply and verify the matching commit URL for publication.
The sanitizer cannot prove source completeness or that a URL is public; it
also cannot make credentials safe to place in build arguments.

Before publishing, check the actual built page's **Source code (AGPL-3.0)**
footer without signing in. CI builds the production Docker image with an
explicit commit URL and asserts the rendered link on desktop and phone.
For a locally running candidate image built with the variable above, the same
check can be run using the normal disposable smoke-test instance:

```sh
cd frontend
E2E_SOURCE_CODE_URL="$VITE_SOURCE_CODE_URL" npm run test:e2e -- --grep 'configured source commit'
```

The smoke-test setup creates its test administrator on a fresh instance; never
point it at production. See `frontend/e2e/instance.ts` for test-only settings.
This wiring change does not by itself authorize deployment or enable the
CharacterMaker connection.

See [NOTICE.md](../NOTICE.md) for provenance/source-release obligations and
[INSULAM_INTEGRATION.md](INSULAM_INTEGRATION.md) for the remaining integration.
