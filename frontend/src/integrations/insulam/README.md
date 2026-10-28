# Insulam read-only character boundary (proposed v1)

This is independent integration groundwork, **not a connected CharacterMaker
feature or an existing API**. No source engine, sheet model, private content,
account data, artwork or database code is copied into this module.

`parseCharacterProjection` accepts a decoded JSON value, validates the proposed
versioned boundary and returns a fresh frozen allowlisted object (or `null`).
It performs no fetching, authentication, persistence, token updates or writes.

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exactly `1` |
| `readOnly` | Exactly `true`; a declaration, **not** authorization proof |
| `characterId` | Opaque nonblank text, at most 200 characters; never a URL |
| `displayName` | Nonblank text, at most 120 characters; render as text, not HTML |
| `sourceUpdatedAt` | Optional canonical UTC timestamp (`Date.toISOString()` format); producer must normalize it |
| `hp` | Optional object with finite nonnegative `current` and `max`; no assumptions about game rules |
| `defense`, `initiative` | Optional finite numbers already calculated by the source |

All other fields are discarded, including nested unknown HP fields. Missing
metrics remain absent: do not infer them or recalculate rules in the VTT. The
parser does not check freshness; the future integration must define cache and
revocation behavior. A future HTTP client must cap body size **before** JSON
decoding; this parser is not a transport size limit.

The future producer must authorize every requested character and every field
for the actual viewer. Being allowed to see a sheet does not imply permission
to redistribute it to everyone in a VTT campaign. Existing owner, viewer,
narrator and table permissions must remain authoritative on the source.

Portraits, source URLs, owner details, rule definitions, full sheet JSON,
cookies and account/share tokens are deliberately outside v1. A source link
or image integration needs its own origin and permission contract. No live
endpoint, SSO mapping or synchronization is implemented here.

All fixtures in the adjacent tests are synthetic. The tests cover validation,
data minimization, immutability and malformed input; they do not verify a live
service, access-control enforcement or a game rule engine.
