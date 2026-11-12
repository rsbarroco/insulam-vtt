#!/usr/bin/env python3
"""Build the backgrounds, species and feats from the System Reference Document 5.2.1.

The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0 (see
SRD_ATTRIBUTION.md). This reads its "Character Origins" and "Feats" sections
from the published PDF and writes them as data. Nothing is added to what the
document says.

    python3 scripts/srd-origins.py SRD_CC_v5.2.1.pdf

Needs `pdftotext` (poppler). The PDF is at https://www.dndbeyond.com/srd and
is not kept in this repository.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/src/rules/dnd/data/srd-5.2.1-origins.json"

PAGE = (594, 783)
# The pages of the two sections, and for the two pages with a table across
# both columns, the band of the page the columns are read from.
PAGES = {83: None, 84: None, 85: (185, 783), 86: (0, 615), 87: None, 88: None, 89: None}
FURNITURE = re.compile(r"^(System Reference Document 5\.2\.1|\d{1,3})$")
ENDS_SENTENCE = re.compile(r"[.!?:”)]$")
# A run-in heading is in title case ("Draconic Flight", "Cloud’s Jaunt (Cloud Giant)"), which a sentence is not.
WORD = r"(?:[A-Z0-9(][A-Za-z0-9’'\-/()]*|of|the|with|and|in|to|a)"
LEAD = re.compile(rf"^([A-Z][A-Za-z’'\-]*(?: {WORD}){{0,6}})\. (\S.*)$")
# Traits that are the options of the trait before them, by name.
OPTION = re.compile(r"^(Forest Gnome|Rock Gnome|.* \((?:Cloud|Fire|Frost|Hill|Stone|Storm) Giant\))$")
ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]


def pdftotext(pdf, page, *args):
    command = ["pdftotext", "-f", str(page), "-l", str(page), *args, pdf, "-"]
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout


def columns(pdf):
    """Every line of the two sections, a column at a time, without the page furniture."""
    lines = []
    for page, band in PAGES.items():
        top, bottom = band or (0, PAGE[1])
        for x in (0, PAGE[0] // 2):
            crop = ["-x", str(x), "-y", str(top), "-W", str(PAGE[0] // 2), "-H", str(bottom - top)]
            lines += [line.strip() for line in pdftotext(pdf, page, *crop).splitlines()]
    return [line for line in lines if line and not FURNITURE.match(line)]


def between(lines, start, end):
    first = lines.index(start) + 1
    return lines[first : lines.index(end, first)]


def join(lines):
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("’", "")).strip("-")


def named_parts(lines):
    """Split running text into its run-in headings ("Darkvision. You have…")."""
    intro, parts = [], []
    for line in lines:
        lead = LEAD.match(line)
        previous = parts[-1]["text"] if parts else (intro[-1] if intro else "")
        if lead and (not previous or ENDS_SENTENCE.search(previous)):
            parts.append({"name": lead.group(1), "text": lead.group(2)})
        elif parts:
            parts[-1]["text"] += " " + line
        else:
            intro.append(line)
    for part in parts:
        part["text"] = join([part["text"]])
    return join(intro), parts


def backgrounds(lines):
    body = between(lines, "Background Descriptions", "Character Species")
    out = []
    starts = [i - 1 for i, line in enumerate(body) if line.startswith("Ability Scores:")]
    for n, at in enumerate(starts):
        block = body[at + 1 : starts[n + 1] if n + 1 < len(starts) else len(body)]
        fields, current = {}, None
        for line in block:
            found = re.match(r"^(Ability Scores|Feat|Skill Proficiencies|Tool Proficiency|Equipment): (.*)$", line)
            if found:
                current = found.group(1)
                fields[current] = found.group(2)
            elif current:
                fields[current] += " " + line
        out.append(
            {
                "id": slug(body[at]),
                "name": body[at],
                "abilityScores": [a for a in ABILITIES if a in fields["Ability Scores"]],
                "feat": re.sub(r" \(see “Feats”\)$", "", fields["Feat"]),
                "skillProficiencies": [s.strip() for s in fields["Skill Proficiencies"].split(" and ")],
                "toolProficiency": fields["Tool Proficiency"],
                "equipment": fields["Equipment"],
            }
        )
    return out


def wide_table(pdf, page, title, row_names):
    """A table that spans both columns: a name, its level 1 text, and the spells of levels 3 and 5."""
    text = pdftotext(pdf, page, "-layout").replace("​", "")
    lines = text[text.index(title) :].splitlines()[2:]
    rows = []
    for line in lines:
        if not line.strip():
            if rows:
                break
            continue
        cells = [cell for cell in re.split(r"\s{2,}", line.strip()) if cell]
        if cells[0] in row_names:
            rows.append({"name": cells[0], "level1": cells[1], "level3": cells[2], "level5": cells[3]})
        elif rows:
            rows[-1]["level1"] += " " + cells[0]
    return rows


def species(lines, pdf):
    body = between(lines, "Species Descriptions", "Feats")
    starts = [i - 1 for i, line in enumerate(body) if line.startswith("Creature Type:")]
    out = []
    for n, at in enumerate(starts):
        block = body[at + 1 : starts[n + 1] if n + 1 < len(starts) else len(body)]
        name = body[at]
        fields, current, rest = {}, None, 0
        for i, line in enumerate(block):
            found = re.match(r"^(Creature Type|Size|Speed): (.*)$", line)
            if found:
                current = found.group(1)
                fields[current] = found.group(2)
            elif line.startswith("As a"):
                rest = i + 1
                break
            elif current:
                fields[current] += " " + line
        text = block[rest:]
        tables = {}
        if name == "Dragonborn":
            first = text.index("Draconic Ancestors")
            last = next(i for i in range(first, len(text)) if text[i].startswith("Breath Weapon."))
            cells = [cell for cell in text[first + 1 : last] if cell not in ("Dragon Damage Type", "Dragon", "Damage Type")]
            # The table reads across two pairs of columns; a cell is a dragon or its damage type.
            flat = " ".join(cells).split()
            tables["Draconic Ancestors"] = sorted(
                ({"dragon": flat[i], "damageType": flat[i + 1]} for i in range(0, len(flat), 2)), key=lambda row: row["dragon"]
            )
            text = text[:first] + text[last:]
        if name == "Elf":
            tables["Elven Lineages"] = wide_table(pdf, 85, "Elven Lineages", ("Drow", "High Elf", "Wood Elf"))
        if name == "Tiefling":
            tables["Fiendish Legacies"] = wide_table(pdf, 86, "Fiendish Legacies", ("Abyssal", "Chthonic", "Infernal"))
            text = [line for line in text if line != "Fiendish Legacies"]
        _, parts = named_parts(text)
        traits = []
        for part in parts:
            if OPTION.match(part["name"]) and traits:
                traits[-1].setdefault("options", []).append(part)
            else:
                traits.append(part)
        entry = {
            "id": slug(name),
            "name": name,
            "creatureType": fields["Creature Type"],
            "size": fields["Size"],
            "speedFeet": int(re.match(r"(\d+) feet", fields["Speed"]).group(1)),
            "traits": traits,
        }
        if tables:
            entry["tables"] = tables
        out.append(entry)
    return out


def feats(lines):
    body = between(lines, "Origin Feats", "Equipment")
    kind = re.compile(r"^(Origin|General|Fighting Style|Epic Boon) Feat(?: \(Prerequisite: (.*?)\)?)?$")
    body = [line for line in body if not re.match(r"^(General|Fighting Style|Epic Boon) Feats$", line)]
    starts = [i - 1 for i, line in enumerate(body) if kind.match(line)]
    out = []
    for n, at in enumerate(starts):
        block = body[at + 1 : starts[n + 1] if n + 1 < len(starts) else len(body)]
        head = block[0]
        rest = 1
        while not head.endswith(")") and "(" in head:
            head += " " + block[rest]
            rest += 1
        category, prerequisite = kind.match(head).groups()
        intro, parts = named_parts(block[rest:])
        repeatable = next((part["text"] for part in parts if part["name"] == "Repeatable"), None)
        out.append(
            {
                "id": slug(body[at]),
                "name": body[at],
                "category": category,
                "prerequisite": prerequisite,
                "description": intro,
                "benefits": [part for part in parts if part["name"] != "Repeatable"],
                "repeatable": repeatable,
            }
        )
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    pdf = sys.argv[1]
    lines = columns(pdf)
    document = {
        "source": "System Reference Document 5.2.1",
        "license": "CC-BY-4.0",
        "backgrounds": backgrounds(lines),
        "species": species(lines, pdf),
        "feats": feats(lines),
    }
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(document['backgrounds'])} backgrounds, {len(document['species'])} species and {len(document['feats'])} feats to {OUT}")


if __name__ == "__main__":
    main()
