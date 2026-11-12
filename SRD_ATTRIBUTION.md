# SRD Attribution

## What this covers

CozyVTT ships no game content. When an administrator seeds the creature library,
the server fetches creature stat blocks from the [Open5e API](https://open5e.com)
into that instance's own database. Those stat blocks come from the **Dungeons &
Dragons 5th Edition System Reference Document 5.1 (SRD 5.1)**, published by
Wizards of the Coast LLC.

This file exists to attribute that content. It covers nothing else — the rest of
CozyVTT is the project's own work, and third-party software is credited in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Licence

SRD 5.1 is released under **two** licences, and a user may choose either:
the Open Game License 1.0a, or the Creative Commons Attribution 4.0
International Licence.

**CozyVTT uses it under CC-BY-4.0.** That choice means a single attribution
notice rather than bundling the full OGL text and maintaining its Section 15
copyright chain. It is also the direction Wizards themselves have taken —
SRD 5.2.1 and everything after it is Creative Commons only.

The required notice is in [SRD_LICENSE.txt](SRD_LICENSE.txt) and reads:

> This work includes material from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC, available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License,
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

The app shows a shorter credit in the creature library, with links to the
SRD 5.1 and to the licence: at the foot of the library whenever it lists an
SRD creature, and under the button that imports them, which only an
administrator is offered, while no SRD creatures are imported.

## The rules of play (SRD 5.2.1)

The tactical mode resolves combat by the 2024 revision of the fifth edition
rules. The code in `backend/src/rules/dnd/` implements rules of play from the
**System Reference Document 5.2.1 (SRD 5.2.1)**: D20 Tests with Advantage and
Disadvantage, attack rolls and cover, saving throws, damage types with
Resistance, Vulnerability and Immunity, Critical Hits, Temporary Hit Points,
the conditions, Concentration and death saving throws. That code is the
project's own, written from that document.

The spell catalogue in `backend/src/rules/dnd/data/srd-5.2.1-spells.json` is
text of the document itself: the 339 spells of its "Spell Descriptions"
section, with each spell's name, level, school, class lists, casting time,
range, components, duration and description as the document gives them.
`scripts/srd-spells.py` builds the file from the published PDF and adds
nothing to it. Line breaks are rejoined and tables inside a description are
flattened into running text; nothing else is changed.

`backend/src/rules/dnd/data/srd-5.2.1-origins.json` is text of the document
too: the 4 backgrounds and 9 species of its "Character Origins" section and
the 17 feats of its "Feats" section, built from the same PDF by
`scripts/srd-origins.py`. Its three tables (Draconic Ancestors, Elven
Lineages, Fiendish Legacies) are kept as rows.

`backend/src/rules/dnd/data/srd-5.2.1-classes.json` is the document's
"Classes" section: for each of the twelve classes its Core Traits table, its
features table, its features by level, its lists of options (Metamagic,
Eldritch Invocations) and its one subclass, built by `scripts/srd-classes.py`.
The class spell lists are not repeated there (each spell of the catalogue
names its classes), and small tables set inside a feature's text are not
kept.

`backend/src/rules/dnd/data/srd-5.2.1-monsters.json` is the 330 stat blocks
of the document's "Monsters A–Z" and "Animals" sections, built by
`scripts/srd-monsters.py` in the shape the creature library stores. A
creature's Initiative, its gear and the number of its legendary actions have
no field there and are kept in its notes.

SRD 5.2.1 is released under the Creative Commons Attribution 4.0 International
Licence only. The required notice is in [SRD_LICENSE.txt](SRD_LICENSE.txt) and
reads:

> This work includes material from the System Reference Document 5.2.1
> ("SRD 5.2.1") by Wizards of the Coast LLC, available at
> https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative
> Commons Attribution 4.0 International License, available at
> https://creativecommons.org/licenses/by/4.0/legalcode.

Nothing from the rulebooks beyond that document is included. The plan for what
follows is in [docs/TACTICAL_MODE.md](docs/TACTICAL_MODE.md).

## Open5e

The data reaches CozyVTT through the [Open5e API](https://open5e.com), which
serves the SRD in a structured form so applications do not each have to parse
the source document. That work is not ours and is worth naming: Open5e is a
community project, and the creature library would be a great deal more effort
without it.

The seeder requests the `wotc-srd` document specifically, so only SRD material
is imported.

## Trademarks

Dungeons & Dragons, D&D, and all related logos are trademarks of Wizards of the
Coast LLC. They are **not** included in CozyVTT, and nothing here implies
endorsement or affiliation. What the SRD makes freely usable is the mechanical
content — ability scores, hit points, actions, traits — and that is all CozyVTT
imports.

## If you add another game system

Attribute it here, in its own section, naming the licence it is published under
(OGL, ORC, Creative Commons, a fan-content policy) and where the content came
from. If a system is not openly licensed, restrict the contribution to sheet
structure and data the user enters themselves.
