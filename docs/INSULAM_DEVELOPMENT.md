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

For a **manual frontend build**, set `VITE_SOURCE_CODE_URL` to the public matching
source release/commit, for example:

```sh
VITE_SOURCE_CODE_URL=https://github.com/rsbarroco/insulam-vtt/tree/RELEASE_COMMIT npm run build
```

Replace `RELEASE_COMMIT` with the actual published commit; this is not a secret.
Only credential-free HTTPS source URLs are accepted. If absent/invalid, the UI
links to the fork repository. Never put API keys or user data in `VITE_*`.
The inherited Docker build does not yet forward this variable: before any
Docker production release, add a reviewed source-version build argument or set
the source URL in the matching release source, then verify the resulting link.
This branch is development groundwork, not authorization to launch a service.

See [NOTICE.md](../NOTICE.md) for provenance/source-release obligations and
[INSULAM_INTEGRATION.md](INSULAM_INTEGRATION.md) for the remaining integration.
