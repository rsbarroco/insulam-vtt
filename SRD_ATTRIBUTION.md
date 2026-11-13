# SRD Attribution

## What this covers

CozyVTT includes material from the **System Reference Document 5.2.1
(SRD 5.2.1)**, the 2024 revision of the fifth edition rules, published by
Wizards of the Coast LLC: the creatures of the creature library, and the
spells, classes, species, backgrounds and feats that character creation and
combat use. The sections below say what each file holds.

This file exists to attribute that content. It covers nothing else — the rest of
CozyVTT is the project's own work, and third-party software is credited in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Licence

SRD 5.2.1 is released under the Creative Commons Attribution 4.0
International Licence only. The required notice is in
[SRD_LICENSE.txt](SRD_LICENSE.txt) and is quoted in the next section.

The app shows a shorter credit in the creature library, with links to the
SRD 5.2.1 and to the licence: at the foot of the library whenever it lists an
SRD creature, and under the button that imports them, which only an
administrator is offered, while no SRD creatures are imported.

## The creature library

When an administrator imports the SRD creatures, the server stores the 330
stat blocks of `backend/src/rules/dnd/data/srd-5.2.1-monsters.json` in that
instance's database. Nothing is fetched.

Before this, the library was filled from the [Open5e API](https://open5e.com)
with the 2014 creatures of the SRD 5.1, also under CC-BY-4.0. An instance
that imported those keeps them until an administrator imports again, which
replaces them with the 2024 creatures. Open5e is a community project that
served the creature library well, and is no longer contacted.

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

`backend/src/utils/srdWeapons.ts` (kept identical in `frontend/src/utils/`) holds the document's Weapons table, written by `scripts/srd-weapons.py`, with the definitions of the mastery properties in the document's words.

`backend/src/utils/srdArmor.ts` (kept identical in `frontend/src/utils/`) holds the document's Armor table: each armor's Armor Class, Dexterity limit, Strength requirement, Stealth note, weight and cost.
`backend/src/rules/dnd/smites.ts` applies the document's Divine Smite spell: its Radiant dice by slot level and against a Fiend or Undead.

`backend/src/rules/dnd/data/srd-5.2.1-rules.json` is the text of the
document's "Playing the Game" chapter and of its "Rules Glossary", built by
`scripts/srd-rules.py`: every heading with its paragraphs, tables and
sidebars, in the document's words. The **Rules of play** panel of a campaign
shows it, with this credit at its foot. Bold and italic inside a paragraph
are not kept.

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
