#!/usr/bin/env python3
"""Build the classes from the System Reference Document 5.2.1.

The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0 (see
SRD_ATTRIBUTION.md). This reads its "Classes" section from the published PDF
and writes each class as data: its core traits, the columns of its features
table, its features by level, its lists of options and its subclass. Nothing
is added to what the document says.

    python3 scripts/srd-classes.py SRD_CC_v5.2.1.pdf

Needs `pdftotext` (poppler). The PDF is at https://www.dndbeyond.com/srd and
is not kept in this repository.
"""

import html
import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/src/rules/dnd/data/srd-5.2.1-classes.json"

PAGE = (594, 783)
FIRST_PAGE, LAST_PAGE = 28, 82
CLASSES = ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"]
FURNITURE = re.compile(r"^(System Reference Document 5\.2\.1|\d{1,3}|Classes)$")
ENDS_SENTENCE = re.compile(r"[.!?:”)]$")
WORD = r"(?:[A-Z0-9(][A-Za-z0-9’'\-/()]*|of|the|with|and|in|to|a|or)"
LEAD = re.compile(rf"^([A-Z][A-Za-z’'\-]*(?: {WORD}){{0,6}})\. (\S.*)$")
FEATURE = re.compile(r"^Level (\d{1,2}): (.+)$")
CORE_LABELS = [
    "Primary Ability", "Hit Point Die", "Saving Throw Proficiencies", "Skill Proficiencies", "Weapon Proficiencies",
    "Tool Proficiencies", "Armor Training", "Starting Equipment",
]
# Sections of a class that are lists of options to choose from, by their heading.
OPTION_LISTS = ["Metamagic Options", "Eldritch Invocation Options"]


def run(page, *args):
    command = ["pdftotext", "-f", str(page), "-l", str(page), *args, PDF, "-"]
    # A soft hyphen is where a word may break, not part of the word.
    # At the end of a line it joins the two halves; anywhere else it is simply dropped.
    out = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    return re.sub(r"\u00ad\n\s*", "", out).replace("\u00ad", "")


def words(page):
    found = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', run(page, "-bbox"))
    return [(float(a), float(b), float(c), float(d), html.unescape(t)) for a, b, c, d, t in found]


def features_table_band(page_words):
    """The band of a page its features table takes: from the title to the row of level 20, or None."""
    level = [w for w in page_words if re.fullmatch(r"\d{1,2}", w[4]) and w[0] < 95]
    one = [w for w in level if w[4] == "1"]
    twenty = [w for w in level if w[4] == "20"]
    if not one or not twenty:
        return None
    first = min(w[1] for w in one)
    titles = [w[1] for w in page_words if w[4] == "Features" and w[0] < 140 and w[1] < first]
    if not titles:
        return None
    return max(titles), first, max(w[3] for w in twenty)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower().replace("’", "")).strip("-")


def join(lines):
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def paragraphs(lines):
    """Join wrapped lines. A new paragraph starts at a run-in heading, a bullet, or after a short closing line."""
    out = []
    for line in lines:
        previous = out[-1] if out else None
        last = previous.rsplit("\n", 1)[-1] if previous else ""
        new = (
            previous is None
            or line.startswith("•")
            or (LEAD.match(line) and ENDS_SENTENCE.search(previous))
            or (ENDS_SENTENCE.search(previous) and len(last) < 38)
        )
        if new:
            out.append(line)
        else:
            out[-1] = previous + "\n" + line
    return [join(p.split("\n")) for p in out]


def table(page, band):
    """The features table: for each level its features, and each further column by its heading."""
    title_y, first_y, last_y = band
    page_words = [w for w in words(page) if title_y + 8 < w[1] and w[3] < last_y + 2]
    body = [w for w in page_words if w[1] >= first_y - 2]
    head = [w for w in page_words if w[1] < first_y - 2]
    rows = {}
    for w in body:
        key = next((y for y in rows if abs(y - w[1]) < 3), w[1])
        rows.setdefault(key, []).append(w)
    lines = [sorted(rows[y]) for y in sorted(rows)]

    def cells(line):
        out = []
        for w in line:
            # A dash is a cell of its own, however near its neighbour.
            if out and w[0] - out[-1][2] < 9 and "—" not in (w[4], out[-1][3]):
                out[-1] = (out[-1][0], out[-1][1], w[2], out[-1][3] + " " + w[4])
            else:
                out.append((w[0], w[1], w[2], w[4]))
        return out

    levels = []
    for line in lines:
        row = cells(line)
        if re.fullmatch(r"\d{1,2}", row[0][3]) and row[0][0] < 95:
            levels.append(row)
        elif levels:
            # A list of features too long for its line wraps under it.
            levels[-1][2] = (*levels[-1][2][:3], levels[-1][2][3] + " " + " ".join(cell[3] for cell in row))
    if [int(row[0][3]) for row in levels] != list(range(1, 21)):
        raise SystemExit(f"page {page}: the features table does not run from level 1 to 20")

    widest = max(levels, key=len)
    centres = [(cell[0] + cell[2]) / 2 for cell in widest[3:]]
    names = [[] for _ in centres]
    # "—Spell Slots per Spell Level—" runs over the nine slot columns and names none of them.
    dashes = [w for w in head if "—" in w[4]]
    banner = (min(w[1] for w in dashes), min(w[0] for w in dashes), max(w[2] for w in dashes)) if dashes else None
    for w in sorted(head, key=lambda w: (round(w[1]), w[0])):
        centre = (w[0] + w[2]) / 2
        if not centres or centre < widest[3][0] - 25 or (banner and abs(w[1] - banner[0]) < 3 and banner[1] - 1 <= w[0] <= banner[2]):
            continue
        nearest = min(range(len(centres)), key=lambda i: abs(centres[i] - centre))
        names[nearest].append(w[4])
    headings = [" ".join(name) for name in names]
    if banner:
        headings = [f"Spell Slots Level {name}" if re.fullmatch(r"[1-9]", name) else name for name in headings]
    columns = {heading: [] for heading in headings}
    by_level = []
    for row in levels:
        by_level.append([part.strip() for part in row[2][3].split(",") if part.strip() and part.strip() != "—"])
        values = {min(range(len(centres)), key=lambda i: abs(centres[i] - (cell[0] + cell[2]) / 2)): cell[3] for cell in row[3:]}
        for index, heading in enumerate(headings):
            columns[heading].append(values.get(index, "—"))
    return by_level, columns


def core_traits(page, x, top, bottom):
    """The Core Traits table, read from its own column with its two columns kept apart."""
    crop = ["-layout", "-x", str(x), "-y", str(int(top)), "-W", str(PAGE[0] // 2), "-H", str(int(bottom - top))]
    rows = []
    for line in run(page, *crop).splitlines()[1:]:
        cells = [cell for cell in re.split(r"\s{2,}", line.strip()) if cell]
        if not cells:
            continue
        first = cells[0]
        label = next((l for l in CORE_LABELS if first == l or first.startswith(l + " ")), None)
        if label:
            # The label, then the value: in the next cell, or after a single space on the same one.
            rows.append([label, " ".join([first[len(label) :].strip(), *cells[1:]]).strip()])
        elif first in ("Saving Throw", "Skill", "Weapon", "Tool", "Starting", "Armor") and len(cells) <= 2:
            # A label too long for its column: its first word here, the rest on the next line.
            rows.append([first, " ".join(cells[1:])])
        elif rows and first in ("Proficiencies", "Equipment", "Training"):
            rows[-1][0] = next(l for l in CORE_LABELS if l.startswith(rows[-1][0]))
            rows[-1][1] = (rows[-1][1] + " " + " ".join(cells[1:])).strip()
        elif rows:
            rows[-1][1] = (rows[-1][1] + " " + " ".join(cells)).strip()
    unknown = [label for label, _ in rows if label not in CORE_LABELS]
    if unknown:
        raise SystemExit(f"page {page}: core traits rows {unknown} are not ones this script knows")
    return {label: re.sub(r"(\w)- (\w)", r"\1\2", value) for label, value in rows}


def flow():
    """Every line of the section in reading order, with the features tables left out, and where each class starts."""
    lines, tables = [], {}
    for page in range(FIRST_PAGE, LAST_PAGE + 1):
        page_words = words(page)
        band = features_table_band(page_words)
        bands = [(0, PAGE[1])]
        if band:
            title_y, _, last_y = band
            bands = [(last_y + 3, PAGE[1])] if title_y < 100 else [(0, title_y - 3)]
            tables[page] = band
        for top, bottom in bands:
            for x in (0, PAGE[0] // 2):
                crop = ["-x", str(x), "-y", str(int(top)), "-W", str(PAGE[0] // 2), "-H", str(int(bottom - top))]
                for line in run(page, *crop).splitlines():
                    line = line.strip()
                    if line and not FURNITURE.match(line):
                        lines.append((page, x, line))
    return lines, tables


OPTION_NAME = re.compile(rf"^[A-Z][A-Za-z’'\-]*(?: {WORD}){{0,4}}$")


def parse_options(lines):
    """A list of options: each a short heading on its own line, then its cost or prerequisite, then its text."""
    intro, entries = [], []
    for i, line in enumerate(lines):
        previous = lines[i - 1] if i else ""
        heading = OPTION_NAME.match(line) and (not previous or ENDS_SENTENCE.search(previous)) and i + 1 < len(lines)
        if heading:
            entries.append({"name": line, "cost": None, "prerequisite": None, "lines": []})
        elif not entries:
            intro.append(line)
        elif not entries[-1]["lines"] and line.startswith("Cost: "):
            entries[-1]["cost"] = line[len("Cost: ") :]
        elif not entries[-1]["lines"] and (line.startswith("Prerequisite: ") or entries[-1]["prerequisite"] is not None and not entries[-1].get("closed")):
            # A prerequisite too long for its line runs on until the text starts.
            if line.startswith("Prerequisite: "):
                entries[-1]["prerequisite"] = line[len("Prerequisite: ") :]
            elif len(line) < 40 and line[0].isupper() and not re.search(r"[.!?]$", line) and len(entries[-1]["prerequisite"]) > 30:
                entries[-1]["prerequisite"] += " " + line
            else:
                entries[-1]["closed"] = True
                entries[-1]["lines"].append(line)
        else:
            entries[-1]["lines"].append(line)
    return join(intro), [
        {"name": e["name"], "cost": e["cost"], "prerequisite": e["prerequisite"], "text": paragraphs(e["lines"])} for e in entries
    ]


def parse_features(lines):
    features, current = [], None
    for line in lines:
        found = FEATURE.match(line)
        if found:
            current = {"level": int(found.group(1)), "name": found.group(2), "lines": []}
            features.append(current)
        elif current:
            current["lines"].append(line)
    return [{"level": f["level"], "name": f["name"], "text": paragraphs(f["lines"])} for f in features]


def main():
    global PDF
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    PDF = sys.argv[1]
    lines, tables = flow()
    text = [line for _, _, line in lines]
    starts = [text.index(f"Core {name} Traits") for name in CLASSES]
    classes = []
    for n, name in enumerate(CLASSES):
        start = starts[n]
        end = starts[n + 1] if n + 1 < len(CLASSES) else len(text)
        # The class's heading, a line with only its name, sits just before its Core Traits table.
        segment = text[start:end]
        if segment[-1] in CLASSES:
            segment = segment[:-1]

        becoming = next(i for i, line in enumerate(segment) if re.match(rf"^Becoming an? {name} …$", line))
        page, x, _ = lines[start]
        title = next(w for w in words(page) if w[4] == "Core" and abs(w[0] - (63 if x == 0 else 313)) < 6)
        after = [w for w in words(page) if w[4] == "Becoming" and (w[0] >= PAGE[0] // 2) == (x > 0) and w[1] > title[1]]
        table_page = min(p for p in tables if p >= page)
        limit = tables[table_page][0] - 3 if table_page == page and tables[table_page][0] > title[1] else PAGE[1] - 40
        bottom = min([w[1] for w in after] + [limit])
        core = core_traits(page, x, title[1] - 2, bottom)

        subclass_at = next(i for i, line in enumerate(segment) if line.startswith(f"{name} Subclass:"))
        spell_list = next((i for i, line in enumerate(segment) if line == f"{name} Spell List"), None)
        class_end = spell_list if spell_list is not None else subclass_at
        option_starts = sorted(i for i, line in enumerate(segment[:class_end]) if line in OPTION_LISTS)
        features_end = option_starts[0] if option_starts else class_end
        first_feature = next(i for i, line in enumerate(segment) if FEATURE.match(line))

        option_lists = []
        for k, at in enumerate(option_starts):
            stop = option_starts[k + 1] if k + 1 < len(option_starts) else class_end
            intro, entries = parse_options(segment[at + 1 : stop])
            option_lists.append({"name": segment[at], "description": intro, "options": entries})

        sub_lines = segment[subclass_at:]
        sub_name = sub_lines[0][len(f"{name} Subclass:") :].strip()
        sub_first = next(i for i, line in enumerate(sub_lines) if FEATURE.match(line))
        # A subclass name too long for the heading's line wraps onto the next.
        intro = sub_lines[1:sub_first]
        if intro and (not sub_name or len(intro[0].split()) <= 2) and not ENDS_SENTENCE.search(intro[0]) and intro[0][0].isupper() and len(intro) > 1:
            sub_name = (sub_name + " " + intro[0]).strip()
            intro = intro[1:]

        by_level, columns = table(table_page, tables[table_page])
        classes.append(
            {
                "id": slug(name),
                "name": name,
                "coreTraits": core,
                "featuresByLevel": by_level,
                "columns": columns,
                "features": parse_features(segment[first_feature:features_end]),
                "optionLists": option_lists,
                "subclass": {"name": sub_name, "description": join(intro), "features": parse_features(sub_lines[sub_first:])},
            }
        )
    document = {"source": "System Reference Document 5.2.1", "license": "CC-BY-4.0", "classes": classes}
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {len(classes)} classes to {OUT}")


if __name__ == "__main__":
    main()
