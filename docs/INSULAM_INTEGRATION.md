# CharacterMaker connection — development snapshot milestone

## What is implemented, and what is not

The VTT has an **opt-in, owner-consented read-only snapshot preview** on My
Characters. It opens a configured CharacterMaker origin in a popup, waits for
explicit consent there, and displays a minimal projection in memory.

This is **not SSO, live synchronization, saved character import, playable token
integration or a production deployment**. It does not write either database,
share a character with a campaign, or replace the CharacterMaker rules engine.
The paired authenticated producer belongs in CharacterMaker's separate source
repository; this public fork contains only the independent transport contract,
receiver and preview. Its code, art and private data are not copied here.

The feature is disabled by default. Neither the VTT nor CharacterMaker's
production settings have been changed by this development work.

## Responsibilities

| CharacterMaker remains authoritative for | VTT remains authoritative for |
| --- | --- |
| Character sheets, rules/calculation engine, accounts, ownership/permissions, mesas | Maps, tokens, lighting/fog, chat, visual session state |
| Calculation of current/max HP, defense and initiative | Rendering explicitly consented values without reproducing rules |

Do not share databases, session cookies or permanent credentials. Do not forward
raw sheets or use an existing bearer share link as an integration credential.

## v1 flow and wire protocol

1. An operator explicitly configures `INSULAM_CHARACTER_MAKER_ORIGIN` in the VTT
   backend. It is a **non-secret exact origin**, not an arbitrary URL. Unset or
   invalid values disable the panel. Production requires HTTPS; development
   permits only explicitly spelled loopback HTTP hosts.
2. CharacterMaker independently configures `INSULAM_VTT_ALLOWED_ORIGINS` as an
   exact origin allowlist, empty by default. No wildcard/subdomain matching.
3. A signed-in VTT user clicks **Open CharacterMaker**. A 256-bit browser-random
   nonce and the VTT's origin are sent to the fixed `/vtt/connect` route. No
   password, cookie, access token or character ID is placed in this URL.
4. CharacterMaker uses its own first-party session, lists only the account's
   **owned** characters, and displays the destination/fields for consent. The
   producer must recheck the active session and ownership at final export;
   existing admin, narrator or shared read access is not an export grant.
5. On explicit consent it sends a **JSON string** with `postMessage(serialized,
   exactVttOrigin)`. No `*` target. The source does not immediately auto-close,
   which could race receipt; the receiver closes its own popup after accepting.

```json
{
  "type": "insulam.character.projection",
  "version": 1,
  "state": "64-lowercase-hex-characters-from-the-request",
  "character": {
    "schemaVersion": 1,
    "readOnly": true,
    "characterId": "opaque-id",
    "displayName": "Example adventurer"
  }
}
```

The illustrative state above is a placeholder, not a valid nonce. The receiver
checks the actual message's exact origin, opened window identity, current nonce,
five-minute expiry and version. It requires a JSON **string**, caps it at
16 KiB UTF-8 **before parsing**, then validates and copies only allowed fields.
Binary/Map/Blob object messages are not accepted. Wrong-origin/window or stale
nonce messages cannot import a character. No response payload is logged.

Optional projection fields are normalized source timestamp and already-computed
HP, defense and initiative. See `frontend/src/integrations/insulam/README.md`.
Omitted metrics are not zero. No portrait, owner/email, notes, raw sheet JSON,
rule tables, share links, arbitrary HTML or account credentials are allowed.

## Lifecycle and privacy

- Popup blocked/closed, sign-in interrupted, expired request and invalid payload
  have recoverable feedback. Cancel/unmount/account or origin change aborts the
  pending request; repeated clicks do not create multiple requests.
- Only one read-only preview is retained in component memory. It disappears on
  removal/navigation/sign-out, and is cleared before a new request.
- No persistence, auto-fetch, campaign broadcast or token creation. Every refresh
  requires a new consent flow and server-side permission check.
- Source changes and revocation **do not update an already received snapshot**.
  This is a copy, not a revocable live authorization/session. Never reuse it as
  permission to fetch more data or redistribute it to other players.
- The popup's source origin is trusted code: it needs `opener` for messaging.
  No player-supplied origin or redirect is accepted. A source deployment's opener
  isolation policies must be tested rather than silently weakened.

## Development verification

Backend tests cover opt-in/configuration and origin rejection. Frontend tests
cover payload minimization, byte limits, origin/window/nonce checks, expiry,
blocked/closed popups, cancellation, repeated clicks, stale results and memory
cleanup. The Playwright suite also has a **synthetic two-origin consent fixture**;
it tests browser messaging, not CharacterMaker's real backend or account engine.
The separate producer must test unauthenticated/nonowner/ownership-changed cases.

Example local origins: VTT `http://localhost:3000`, CharacterMaker
`http://localhost:3001`. They must match actual ports/origins on both sides.
Do not enable this against the public CharacterMaker URL until its paired route
has been reviewed and deployed under separate authorization.

## Remaining milestones

- Run the paired services end-to-end with disposable accounts/data and verify
  ownership changes, login interruptions, CSP/opener behavior and revocation.
- Design explicit campaign/player sharing before any persistence or token binding.
- For future writes/live sync, use authenticated commands to CharacterMaker with
  authorization, concurrency, idempotency and audit; never duplicate its engine.
- Review combined-work/licensing implications, publish matching Corresponding
  Source, and complete operational security/backup review before launch.

Prefer separate origins linked from Insulam, not an iframe: upstream deliberately
blocks framing and expects API/socket/assets at its own origin. No DNS, proxy,
CSP, production credential or deployment changes are part of this milestone.
A network boundary is not a blanket legal conclusion about AGPL obligations.
