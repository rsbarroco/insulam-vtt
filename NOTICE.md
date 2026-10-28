# Insulam VTT — provenance and notices

Insulam VTT is a modified fork of **CozyVTT**, by CheekyChinchilla and the
CozyVTT contributors: <https://github.com/CheekyChinchilla/CozyVTT>.

The initial fork is based on upstream commit
`b7c6d8e05fe55ec85b47cb9b398fa1a585cea3bf`, version
1.5.4. Fork work began on 2026-10-28. Original copyright, authorship, license
and third-party attribution are preserved. Insulam branding does not imply
ownership of upstream authors' contributions or their endorsement.

## License and corresponding source

This program remains **AGPL-3.0-only**. See [LICENSE](LICENSE) for the actual
terms. The fork's modifications to this program are under that same license.
See also [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md),
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt),
[SRD_ATTRIBUTION.md](SRD_ATTRIBUTION.md) and [SRD_LICENSE.txt](SRD_LICENSE.txt).
Those notices and individual font/dependency licenses are not replaced by the
Insulam name.

The application offers a public **Source code (AGPL-3.0)** link, including on
sign-in/setup screens. Before exposing a modified service, publish the complete
Corresponding Source for the version actually running, including necessary
build/install scripts and modifications, and point that link at the matching
release or commit. A link to unchanged upstream source is not sufficient for a
modified running version. Do not publish credentials, user records or private
character sheets as part of a source release.

Default source repository: <https://github.com/rsbarroco/insulam-vtt>.
Deployment review must verify public access without a login and source/version
correspondence; a visible link alone is not a complete compliance check.

## Initial modifications

- Insulam VTT defaults on primary entry/setup/dashboard screens, document
  metadata and email headings; a simple new SVG development mark.
- Public fork-source and upstream-credit links; fork project link for errors.
- Independent, proposed read-only CharacterMaker transport contract and tests.
- Integration/development documentation. No copied CharacterMaker engine,
  proprietary source, artwork, accounts, secrets or production data.

Existing custom instance names are not overwritten. Original archive extensions,
database schema defaults, migrations, storage keys and package identifiers are
kept for compatibility; this is not a complete UI translation or redesign.

Running separate services is an architectural boundary, not a blanket legal
conclusion about combined works. Review the intended final integration and
source-release obligations before launch. Nothing here grants rights to
third-party game content or trademarks beyond their own terms.
