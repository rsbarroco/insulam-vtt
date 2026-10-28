# CharacterMaker integration — staged design

## Status: contract only, not connected

The initial fork does **not** call CharacterMaker, import real characters,
share sessions, synchronize HP, modify either database, or replace the existing
character engine. The independent TypeScript contract under
`frontend/src/integrations/insulam/` is a proposed boundary, not a claim that
an endpoint already exists.

CharacterMaker: <https://charactermaker.insulamrpg.com/>.

## Responsibilities

| CharacterMaker remains authoritative for | VTT remains authoritative for |
| --- | --- |
| Character sheets, rules/calculation engine, accounts, sheet permissions, mesas | Maps, token placement, lighting/fog, tabletop chat, visual session state |
| Calculation of HP limits, defense and initiative | Display of expressly authorized computed values, without reproducing rules |

Do not mount CharacterMaker's database in the VTT, copy its engine here, or
forward its full sheet payload. Keep separate databases, sessions and secrets.
The existing CharacterMaker read APIs return complete records; a dedicated
external projection endpoint still needs to be designed and implemented there.

## Proposed v1: explicit, read-only projection

- Versioned, allowlisted DTO: opaque character ID, display name, `readOnly: true`,
  optional normalized source timestamp and optional already-computed HP,
  defense and initiative. See the contract README for the exact fields.
- No raw sheet JSON, account identity/email, private notes, ability/rule tables,
  access tokens, share links, portrait URLs or arbitrary HTML.
- Omitted values mean **not supplied**, not zero. Do not derive hidden values,
  recalculate the rules, or treat an absent value as permission to fetch it.
- CharacterMaker chooses the projection for the current viewer and explicit
  sharing scope. An owner's authorization to view a sheet is not permission to
  broadcast it to every participant in a VTT campaign.
- Current source access includes ownership, explicit sharing, administrative
  access and read-only narrator access for specifically linked sheets in active
  mesas. Mere mesa membership is not enough. Do not weaken those checks.
- Existing read-only share links are bearer capabilities. Never copy them into
  a VTT query string, logs, analytics, local storage or public repository.
- Normalize timestamps at the producer; the existing storage representation
  is not itself the external API contract.

## Next implementation slices

1. **Authenticated projection API (CharacterMaker, separate review).** Resolve
   viewer identity, enforce sheet and mesa authorization on every request, and
   return only a deliberate projection. Tests: owner, explicitly shared user,
   linked narrator, unrelated participant, removed member, revoked share,
   archived mesa, missing character. Response: no-store; log IDs minimally and
   never capability/session tokens. Bound payload size and rate-limit requests.
2. **Account/mesa linking.** Decide a standard server-side authentication flow,
   short-lived audience-bound scopes and revocation. Do not reuse session cookies
   across subdomains, expose permanent service keys in Vite variables, or infer
   identity from matching email alone. Consent must identify data and recipients.
3. **Read-only character panel + token association.** Fetch via an authenticated
   same-origin VTT server endpoint, parse the allowlisted DTO, and show freshness
   and disconnected/revoked states. Do not persist or broadcast private fields.
   Fetches must use a configured allowlisted service origin, not a URL supplied
   by a player (SSRF protection). Image support needs separate permission,
   resource-origin and privacy decisions.
4. **Session interaction, only after design approval.** HP changes or rolls
   affecting characters are commands to CharacterMaker, not local rewrites of
   source sheets. Define authorization, idempotency, concurrency and audit first.

## Deployment boundary

Prefer a separately hosted VTT origin linked from Insulam, rather than an iframe:
upstream deliberately blocks framing and expects API/socket/assets at its own
origin. A subpath or iframe is not supported by this initial fork. No DNS,
proxy, CSP, production service, credential or deployment changes are included.
Do not relax CSP or cookie protections merely to make integration work.

Before launch: review combined-work/licensing implications, publish the matching
Corresponding Source, exercise authorization and revocation end-to-end, validate
production headers, backups, image handling, and data deletion. Keeping a network
boundary does not automatically settle AGPL obligations.
