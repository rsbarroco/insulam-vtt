#!/usr/bin/env python3
"""Build the monsters from the System Reference Document 5.2.1.

The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0 (see
SRD_ATTRIBUTION.md). This reads the stat blocks of its "Monsters A–Z" and
"Animals" sections from the published PDF and writes each one in the shape
the creature library stores. Nothing is added to what the document says.

    python3 scripts/srd-monsters.py SRD_CC_v5.2.1.pdf

Needs `pdftotext` (poppler). The PDF is at https://www.dndbeyond.com/srd and
is not kept in this repository.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/src/rules/dnd/data/srd-5.2.1-monsters.json"

PAGE = (594, 783)
FIRST_PAGE, LAST_PAGE = 258, 364
FURNITURE = re.compile(r"^(System Reference Document 5\.2\.1|\d{1,3})$")
SIZES = "Tiny|Small|Medium|Large|Huge|Gargantuan"
# "Large Aberration, Lawful Evil", "Medium or Small Humanoid, Neutral", "Medium Swarm of Tiny Beasts, Unaligned".
KIND = re.compile(rf"^((?:{SIZES})(?: or (?:{SIZES}))?) ([A-Z][A-Za-z ]+(?: \([^)]*\))?), ([A-Z].*)$")
# The document has a few slips in these rows ("Con22", a save printed without its sign), which are read through.
ABILITY = re.compile(r"(Str|Dex|Con|Int|Wis|Cha) ?(\d+) ([+−-]?\d+) ([+−-]?\d+)")
# One ability to a line, or two or three where the columns of the table sit close.
ABILITY_LINE = re.compile(rf"^(?:{ABILITY.pattern}\s*){{1,3}}$")
FIELDS = ["Skills", "Vulnerabilities", "Resistances", "Immunities", "Gear", "Senses", "Languages", "CR"]
SECTIONS = {"Traits": "traits", "Actions": "actions", "Bonus Actions": "bonusActions", "Reactions": "reactions", "Legendary Actions": "legendaryActions"}
ENDS_SENTENCE = re.compile(r"[.!?:”)]$")
# An entry's name is in title case and may end in brackets: "Fire Breath (Recharge 5–6)".
WORD = r"(?:[A-Z0-9][A-Za-z0-9’'\-/]*|of|the|with|and|in|to|a|or|from|at|on|for)"
ENTRY = re.compile(rf"^([A-Z][A-Za-z’'\-]*(?: {WORD}){{0,6}}(?: \([^)]*\))?)\. (\S.*)$")
ENTRY_OPEN = re.compile(rf"^([A-Z][A-Za-z’'\-]*(?: {WORD}){{0,6}} \([^)]*)$")
HEADING = re.compile(rf"^[A-Z][A-Za-z’'\-]*(?: {WORD}){{0,4}}$")
CONDITIONS = {
    "Blinded", "Charmed", "Deafened", "Exhaustion", "Frightened", "Grappled", "Incapacitated", "Invisible", "Paralyzed",
    "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
}
SKILL_KEYS = {
    "Acrobatics": "acrobatics", "Animal Handling": "animalHandling", "Arcana": "arcana", "Athletics": "athletics",
    "Deception": "deception", "History": "history", "Insight": "insight", "Intimidation": "intimidation",
    "Investigation": "investigation", "Medicine": "medicine", "Nature": "nature", "Perception": "perception",
    "Performance": "performance", "Persuasion": "persuasion", "Religion": "religion", "Sleight of Hand": "sleightOfHand",
    "Stealth": "stealth", "Survival": "survival",
}
CELLS = {"Tiny": 1, "Small": 1, "Medium": 1, "Large": 2, "Huge": 3, "Gargantuan": 4}


def columns(pdf):
    lines = []
    for page in range(FIRST_PAGE, LAST_PAGE + 1):
        for x in (0, PAGE[0] // 2):
            crop = ["-x", str(x), "-y", "0", "-W", str(PAGE[0] // 2), "-H", str(PAGE[1])]
            command = ["pdftotext", "-f", str(page), "-l", str(page), *crop, pdf, "-"]
            out = subprocess.run(command, check=True, capture_output=True, text=True).stdout
            # A soft hyphen at the end of a line joins the two halves of a word; anywhere else it is dropped.
            out = re.sub(r"­\n\s*", "", out).replace("­", "")
            lines += [line.strip() for line in out.splitlines()]
    return [line for line in lines if line and not FURNITURE.match(line)]


def number(text):
    return int(text.replace("−", "-").replace("+", ""))


def join(lines):
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def entries(lines):
    """Split a section into its named entries. Text before the first name is the section's own."""
    intro, out = [], []
    pending = None
    for line in lines:
        if pending is not None:
            # A name whose brackets ran onto the next line: "Fire Breath (Recharge" / "5–6). Dexterity…".
            line = pending + " " + line
            pending = None
        found = ENTRY.match(line)
        previous = out[-1]["lines"][-1] if out and out[-1]["lines"] else (intro[-1] if intro else "")
        starts = not previous or ENDS_SENTENCE.search(previous)
        # "DC 17 (a creature makes this save only once per turn). Failure: …" carries on a saving throw; it names nothing.
        if found and starts and not found.group(1).startswith("DC "):
            out.append({"name": found.group(1), "lines": [found.group(2)]})
        elif ENTRY_OPEN.match(line) and starts and len(line) < 60:
            pending = line
        elif out:
            out[-1]["lines"].append(line)
        else:
            intro.append(line)
    return join(intro), [{"name": entry["name"], "description": join(entry["lines"])} for entry in out]


def parse_block(name, lines):
    size, kind, alignment = KIND.match(lines[0]).groups()
    block = {"creatureType": f"{size} {kind}", "alignment": alignment, "gameSystem": "DND_5E"}
    abilities, saves = {}, {}
    fields, current = {}, None
    waiting = []
    at = 1
    while at < len(lines) and lines[at] not in SECTIONS:
        line = lines[at]
        at += 1
        if ABILITY_LINE.match(line):
            for ability in ABILITY.finditer(line):
                key = ability.group(1).lower()
                abilities[key] = int(ability.group(2))
                # A save printed without a sign is the modifier with its sign dropped, not a proficiency.
                signed = ability.group(4)[0] in "+−-"
                if signed and number(ability.group(4)) != number(ability.group(3)):
                    saves[key] = number(ability.group(4))
            current = None
            continue
        # An ability row the page split in two: "Str 5" on one line, its "−3 −3" a few lines on.
        half = re.fullmatch(r"(Str|Dex|Con|Int|Wis|Cha) ?(\d+)", line)
        rest = re.fullmatch(r"([+−-]\d+) ([+−-]\d+)", line)
        if half:
            waiting.append(half)
            current = None
            continue
        if rest and waiting:
            first = waiting.pop(0)
            key = first.group(1).lower()
            abilities[key] = int(first.group(2))
            if number(rest.group(2)) != number(rest.group(1)):
                saves[key] = number(rest.group(2))
            continue
        if re.fullmatch(r"(MOD SAVE\s*)+", line):
            current = None
            continue
        head = re.match(r"^(AC|Initiative|HP|Speed) (.*)$", line)
        if head and head.group(1) not in fields:
            current = head.group(1)
            fields[current] = head.group(2)
            continue
        field = next((f for f in FIELDS if line.startswith(f + " ")), None)
        if field and field not in fields:
            current = field
            fields[current] = line[len(field) + 1 :]
        elif current:
            fields[current] += " " + line
        else:
            raise SystemExit(f"{name}: cannot place the line {line!r}")

    missing = [f for f in ("AC", "HP", "Speed", "CR") if f not in fields] + ([] if len(abilities) == 6 else ["abilities"])
    if missing:
        raise SystemExit(f"{name}: no {', '.join(missing)}")

    hp = re.match(r"^(\d+)(?: \((.*)\))?$", fields["HP"])
    # "10 (XP 5,900, or 7,200 in lair; PB +4)", "3 (700 XP; PB +2)", "0 (XP 0 or 10; PB +2)".
    cr = re.match(r"^([\d/]+) \((?:XP )?([\d,]+)(?: XP)?(?:,? or [\d,]+(?: in lair)?)?; PB \+(\d)\)$", fields["CR"])
    if not hp or not cr:
        raise SystemExit(f"{name}: cannot read HP {fields['HP']!r} or CR {fields['CR']!r}")
    block["ac"] = int(re.match(r"\d+", fields["AC"]).group(0))
    block["hpMax"] = int(hp.group(1))
    if hp.group(2):
        block["hitDice"] = hp.group(2).replace(" ", "").replace("−", "-")
    block["speed"] = fields["Speed"]
    block["abilities"] = abilities
    if saves:
        block["savingThrows"] = saves
    if "Skills" in fields:
        skills = {}
        for part in fields["Skills"].split(","):
            found = re.match(r"^(.*) ([+−-]\d+)$", part.strip())
            skills[SKILL_KEYS[found.group(1)]] = number(found.group(2))
        block["skills"] = skills
    if "Vulnerabilities" in fields:
        block["damageVulnerabilities"] = fields["Vulnerabilities"]
    if "Resistances" in fields:
        block["damageResistances"] = fields["Resistances"]
    if "Immunities" in fields:
        # Damage types, then conditions after a semicolon; a list of conditions alone has no semicolon.
        parts = [part.strip() for part in fields["Immunities"].split(";")]
        is_conditions = lambda text: all(item.strip() in CONDITIONS for item in text.split(","))
        damage = [part for part in parts if not is_conditions(part)]
        conditions = [part for part in parts if is_conditions(part)]
        if damage:
            block["damageImmunities"] = "; ".join(damage)
        if conditions:
            block["conditionImmunities"] = ", ".join(conditions)
    if "Senses" in fields:
        block["senses"] = fields["Senses"]
    if "Languages" in fields:
        block["languages"] = fields["Languages"]
    block["challengeRating"] = cr.group(1)
    block["xp"] = int(cr.group(2).replace(",", ""))

    notes = [f"Initiative {fields['Initiative']}"] if "Initiative" in fields else []
    if "Gear" in fields:
        notes.append(f"Gear: {fields['Gear']}")
    section_starts = [i for i in range(at, len(lines)) if lines[i] in SECTIONS]
    for n, start in enumerate(section_starts):
        stop = section_starts[n + 1] if n + 1 < len(section_starts) else len(lines)
        intro, found = entries(lines[start + 1 : stop])
        if found:
            block[SECTIONS[lines[start]]] = found
        if intro:
            notes.append(f"{lines[start]}: {intro}")
    if notes:
        block["notes"] = "\n".join(notes)

    cells = CELLS[size.split(" or ")[0]]
    return {
        "name": name,
        "challengeRating": block["challengeRating"],
        "creatureType": block["creatureType"],
        "alignment": alignment,
        "size": {"width": cells, "height": cells},
        "statBlock": block,
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    lines = columns(sys.argv[1])
    starts = [i for i in range(1, len(lines) - 1) if KIND.match(lines[i]) and lines[i + 1].startswith("AC ")]
    monsters = []
    for n, at in enumerate(starts):
        # A stat block runs to the name of the next, less the heading above that name where it has one.
        stop = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
        body = lines[at:stop]
        # A family of creatures has a heading of its own above its first stat block ("Animated Objects").
        while body and len(body[-1]) < 40 and HEADING.match(body[-1]):
            body = body[:-1]
        monsters.append(parse_block(lines[at - 1], body))
    document = {"source": "System Reference Document 5.2.1", "license": "CC-BY-4.0", "monsters": monsters}
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(monsters)} monsters to {OUT}")


if __name__ == "__main__":
    main()
