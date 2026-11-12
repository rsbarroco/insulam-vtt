#!/usr/bin/env python3
"""Build the spell catalogue from the System Reference Document 5.2.1.

The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0 (see
SRD_ATTRIBUTION.md). This reads the text of its "Spell Descriptions" section
and writes each spell as data. Nothing is added to what the document says.

    pdftotext SRD_CC_v5.2.1.pdf srd.txt
    python3 scripts/srd-spells.py srd.txt

The PDF is at https://www.dndbeyond.com/srd and is not kept in this repository.
"""

import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/src/rules/dnd/data/srd-5.2.1-spells.json"

SCHOOLS = "Abjuration|Conjuration|Divination|Enchantment|Evocation|Illusion|Necromancy|Transmutation"
HEADER = re.compile(rf"^(?:Level (\d) ({SCHOOLS})|({SCHOOLS}) Cantrip) \(([^)]*)\)?$")
FIELDS = ("Casting Time", "Range", "Components", "Component", "Duration")
FIELD = re.compile(rf"^({'|'.join(FIELDS)}): ?(.*)$")
# What the page carries that is not the text: the running title and page numbers.
FURNITURE = re.compile(r"^(System Reference Document 5\.2\.1|\d{1,3})$")
LEAD = re.compile(r"^[A-Z][A-Za-z’'\-]*(?: [A-Za-z’'\-/]+){0,5}\. \S")
ENDS_SENTENCE = re.compile(r"[.!?:”)]$")


def section(lines):
    """The lines between "Spell Descriptions" and the chapter after it."""
    starts = [i for i, line in enumerate(lines) if line == "Spell Descriptions"]
    start = next(i for i in starts if lines[i + 1 : i + 4].count("Acid Arrow"))
    end = next(i for i in range(start, len(lines)) if lines[i] == "Rules Glossary")
    return lines[start + 1 : end]


def paragraphs(body):
    """Join wrapped lines. A new paragraph starts after a short closing line, or at a run-in heading."""
    out = []
    for line in body:
        previous = out[-1] if out else None
        last = previous.rsplit("\n", 1)[-1] if previous else ""
        new = (
            previous is None
            or (LEAD.match(line) and ENDS_SENTENCE.search(previous))
            or (ENDS_SENTENCE.search(previous) and len(last) < 38)
        )
        if new:
            out.append(line)
        else:
            out[-1] = previous + "\n" + line
    return [re.sub(r"\s*\n\s*", " ", p).strip() for p in out]


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("’", "")).strip("-")


def parse(lines):
    lines = [line.strip() for line in lines]
    lines = [line for line in lines if line and not FURNITURE.match(line)]
    # A class list too long for its line wraps onto the next.
    merged = []
    for line in lines:
        if merged and re.match(rf"^(Level \d ({SCHOOLS})|({SCHOOLS}) Cantrip) \([^)]*$", merged[-1]):
            merged[-1] += " " + line
        else:
            merged.append(line)
    lines = merged

    heads = [i for i, line in enumerate(lines) if HEADER.match(line)]
    spells = []
    for n, at in enumerate(heads):
        name = lines[at - 1]
        stop = heads[n + 1] - 1 if n + 1 < len(heads) else len(lines)
        level, school, cantrip_school, classes = HEADER.match(lines[at]).groups()
        block = lines[at + 1 : stop]

        fields = {}
        current = None
        rest = 0
        for i, line in enumerate(block):
            found = FIELD.match(line)
            if found:
                current = "Components" if found.group(1) == "Component" else found.group(1)
                fields[current] = found.group(2)
                rest = i + 1
            elif current and current != "Duration" and len(fields) < 4:
                fields[current] += " " + line  # a field that wrapped
                rest = i + 1
            else:
                break
        missing = [f for f in ("Casting Time", "Range", "Components", "Duration") if f not in fields]
        if missing:
            raise SystemExit(f"{name}: no {', '.join(missing)}")

        text = paragraphs(block[rest:])
        higher = None
        description = []
        for paragraph in text:
            lead = re.match(r"^(Using a Higher-Level Spell Slot|Cantrip Upgrade)\. (.*)$", paragraph)
            if lead:
                higher = lead.group(2)
            else:
                description.append(paragraph)

        casting = fields["Casting Time"]
        components = fields["Components"]
        material = re.search(r"M \((.*)\)$", components)
        duration = fields["Duration"]
        spells.append(
            {
                "id": slug(name),
                "name": name,
                "level": int(level) if level else 0,
                "school": school or cantrip_school,
                "classes": [c.strip() for c in classes.split(",") if c.strip()],
                "castingTime": casting,
                "ritual": "Ritual" in casting,
                "range": fields["Range"],
                "components": [c for c in ("V", "S", "M") if re.search(rf"\b{c}\b", components.split("(")[0])],
                "material": material.group(1) if material else None,
                "duration": duration,
                "concentration": duration.startswith("Concentration"),
                "description": description,
                "higherLevels": higher,
            }
        )
    return spells


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    text = Path(sys.argv[1]).read_text(encoding="utf-8")
    # A soft hyphen at the end of a line joins the two halves of a word; anywhere else it is dropped.
    lines = re.sub(r"\u00ad\n\s*", "", text).replace("\u00ad", "").splitlines()
    spells = parse(section([line.strip() for line in lines]))
    document = {
        "source": "System Reference Document 5.2.1",
        "license": "CC-BY-4.0",
        "attribution": "This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.",
        "spells": spells,
    }
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(spells)} spells to {OUT}")


if __name__ == "__main__":
    main()
