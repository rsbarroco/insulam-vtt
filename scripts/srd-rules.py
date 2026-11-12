#!/usr/bin/env python3
"""Build the rules of play from the System Reference Document 5.2.1.

The SRD 5.2.1 is published by Wizards of the Coast under CC-BY-4.0 (see
SRD_ATTRIBUTION.md). This reads its "Playing the Game" chapter and its
"Rules Glossary" from the published PDF and writes them as sections of
headings, paragraphs and tables. Nothing is added to what the document says.

    python3 scripts/srd-rules.py SRD_CC_v5.2.1.pdf

Needs `pdftohtml` (poppler). The PDF is at https://www.dndbeyond.com/srd and
is not kept in this repository.
"""

import html
import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "backend/src/rules/dnd/data/srd-5.2.1-rules.json"

CHAPTERS = [("Playing the Game", 5, 18), ("Rules Glossary", 176, 191)]
RED = "#88191f"
GREY = "#7b7879"
# A heading is in the document's red, and its size says how deep it is.
LEVELS = {39: 1, 27: 2, 21: 3, 18: 4}
TEXT = re.compile(r'<text top="(\d+)" left="(\d+)" width="(\d+)" height="(\d+)" font="(\d+)">(.*?)</text>', re.S)
FONT = re.compile(r'<fontspec id="(\d+)" size="(\d+)" family="([^"]+)" color="([^"]+)"')
PAGE = re.compile(r'<page number="(\d+)"[^>]*width="(\d+)"[^>]*>(.*?)</page>', re.S)
ENDS_SENTENCE = re.compile(r"[.!?:”)]$")


def plain(markup):
    return html.unescape(re.sub(r"<[^>]+>", "", markup)).replace("­", "")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower().replace("’", "")).strip("-")


def kind_of(size, family, colour):
    if colour == RED and size in LEVELS:
        return "heading"
    if family == "Cambria":
        return "body"
    if "SemiBold" in family:
        return "tabletitle" if size >= 16 else "tablehead"
    # A sidebar's title is in small capitals: a capital, then smaller capitals.
    return "sidetitle" if size in (17, 12) else "sans"


def lines_of(xml):
    """Every line of a chapter in reading order, each with the pieces set on it."""
    fonts = {m.group(1): (int(m.group(2)), m.group(3).split("+")[-1], m.group(4)) for m in FONT.finditer(xml)}
    out = []
    for number, width, body in PAGE.findall(xml):
        middle = int(width) // 2
        pieces = []
        for top, left, wide, _, font, markup in TEXT.findall(body):
            size, family, colour = fonts[font]
            if colour == GREY:
                continue
            pieces.append(
                {
                    "column": 0 if int(left) < middle else 1, "top": int(top), "left": int(left), "width": int(wide),
                    "kind": kind_of(size, family, colour), "level": LEVELS.get(size, 0), "raw": plain(markup),
                    "bold": bool(re.match(r"\s*(<i>)?<b>", markup)),
                }
            )
        pieces.sort(key=lambda p: (p["column"], p["top"], p["left"]))
        lines = []
        for piece in pieces:
            piece["where"] = (number, piece["column"])
            last = lines[-1] if lines else None
            if last and last["column"] == piece["column"] and abs(last["top"] - piece["top"]) <= 6:
                last["pieces"].append(piece)
            else:
                lines.append({"column": piece["column"], "top": piece["top"], "pieces": [piece]})
        for line in lines:
            line["pieces"].sort(key=lambda p: p["left"])
            inked = [p for p in line["pieces"] if p["raw"].strip()]
            if not inked:
                continue
            raw = "".join(p["raw"] for p in line["pieces"])
            first = inked[0]
            text = re.sub(r"\s+", " ", raw).strip()
            if first["kind"] == "sidetitle":
                text = re.sub(r"(?<=\w )(A|An|And|In|Of|On|Or|The|To)\b", lambda m: m.group(1).lower(), text.title())
            out.append(
                {
                    "order": len(out), "where": first["where"], "kind": first["kind"], "level": first["level"], "text": text, "left": first["left"],
                    # A new paragraph is set in from the margin, or opens with a run-in title in bold.
                    "opens": raw.startswith("  ") or first["bold"] or text.startswith("•"),
                    "pieces": inked,
                }
            )
    return out


def join_words(parts):
    """Join wrapped lines; a word broken at the end of a line is put back together."""
    text = ""
    for part in parts:
        if text.endswith("-") and part[:1].islower():
            text = text[:-1] + part
        else:
            text = (text + " " + part).strip()
    return text


def table_of(title, head, rows):
    """Cells under the columns the table is set in."""
    if len(head) > 3:
        # Not headings at all: a list of short forms set in bold, each beside its meaning.
        head, rows = [], sorted(head + rows, key=lambda line: line["order"])
    seen = {}
    for line in head + rows:
        for left in {p["left"] for p in line["pieces"]}:
            seen[left] = seen.get(left, 0) + 1
    heads = {p["left"] for line in head for p in line["pieces"]}
    columns = []
    for left in sorted(left for left, times in seen.items() if times > 1 or left in heads or not head):
        if not columns or left - columns[-1] > 12:
            columns.append(left)

    def cells(line):
        out = [""] * len(columns)
        for piece in line["pieces"]:
            at = max([i for i, left in enumerate(columns) if left <= piece["left"] + 15] or [0])
            text = re.sub(r"\s+", " ", piece["raw"]).strip()
            # Two cells close together come out of the PDF as one piece of text.
            if at + 1 < len(columns) and piece["left"] + piece["width"] > columns[at + 1] + 10 and " " in text and line not in head:
                first, text = text.split(" ", 1)
                out[at] = (out[at] + " " + first).strip()
                at += 1
            out[at] = (out[at] + " " + text).strip()
        return out

    body = []
    for line in rows:
        row = cells(line)
        # A row with nothing in its first column carries on the cells of the row above.
        if body and len(columns) > 1 and (not row[0] or body[-1][0].endswith("-")):
            body[-1] = [join_words([a, b]) if b else a for a, b in zip(body[-1], row)]
        else:
            body.append(row)
    if not head and len(columns) == 4 and not title:
        right = []
        for row in body:
            if row[2]:
                right.append(row[2:])
            elif row[3] and right:
                right[-1][1] = join_words([right[-1][1], row[3]])
        body = [row[:2] for row in body if row[0]] + right
    table = {"type": "table", "head": [cells(line) for line in head], "rows": body}
    if title:
        table["title"] = title
    return table


def blocks_of(lines):
    """Paragraphs, tables and sidebars from the lines under one heading."""
    blocks, waiting = [], []
    paragraph = []
    aside = None

    def end_paragraph():
        nonlocal paragraph, waiting
        if paragraph:
            blocks.append({"type": "paragraph", "text": join_words([line["text"] for line in paragraph])})
        blocks.extend(waiting)
        paragraph, waiting = [], []

    def end_aside():
        nonlocal aside
        if not aside:
            return
        if aside["type"] == "sidebar":
            paragraphs = [join_words([line["text"] for line in part]) for part in aside["parts"] if part]
            block = {"type": "sidebar", "title": aside["title"], "paragraphs": paragraphs}
        elif aside["rows"] or aside["title"]:
            block = table_of(aside["title"], aside["head"], aside["rows"])
        else:
            # A formula set apart in bold, not a table.
            block = {"type": "paragraph", "text": " ".join(line["text"] for line in aside["head"])}
        aside = None
        # Set in the middle of a sentence, it waits for the sentence to end.
        last = (waiting or blocks or [None])[-1]
        if block["type"] == "table" and "title" not in block and last and last["type"] == "table" and last["head"] == block["head"] and block["head"]:
            # The same table, carried over to the next column.
            last["rows"] += block["rows"]
        elif paragraph and not ENDS_SENTENCE.search(paragraph[-1]["text"]):
            waiting.append(block)
        else:
            end_paragraph()
            blocks.append(block)

    for line in lines:
        kind = line["kind"]
        # A list set in the plainer face is still part of the running text.
        listed = paragraph and paragraph[-1]["text"].startswith("•") or paragraph and paragraph[-1].get("listed")
        if kind == "sans" and not aside and (line["text"].startswith("•") or listed and line["left"] > paragraph[-1]["left"] - 2 and not line["opens"]):
            kind = "body"
            line["listed"] = True
        if kind == "body":
            end_aside()
            if paragraph:
                above = paragraph[-1]
                beside = above["where"] == line["where"]
                # A line hung in under the one above carries it on, even in bold.
                hung = beside and line["left"] > above["left"] + 5 and not line["text"].startswith("•")
                if not hung and (line["opens"] or beside and line["left"] < above["left"] - 5):
                    end_paragraph()
            paragraph.append(line)
        elif kind == "sidetitle":
            end_aside()
            aside = {"type": "sidebar", "title": line["text"], "parts": [[]]}
        elif kind == "tabletitle":
            end_aside()
            aside = {"type": "table", "title": line["text"], "head": [], "rows": []}
        elif aside and aside["type"] == "sidebar":
            if line["opens"] and aside["parts"][-1]:
                aside["parts"].append([])
            aside["parts"][-1].append(line)
        else:
            if not aside or (kind == "tablehead" and aside["rows"] and len(aside["head"]) < 4):
                end_aside()
                aside = {"type": "table", "title": "", "head": [], "rows": []}
            aside["head" if kind == "tablehead" else "rows"].append(line)
    end_aside()
    end_paragraph()
    return blocks


def sections_of(chapter, lines):
    sections, trail = [], []
    current = None
    for line in lines:
        if line["kind"] == "heading":
            # A heading too long for its line runs onto the next, at the same size.
            if current and not current["lines"] and current["level"] == line["level"]:
                current["title"] += " " + line["text"]
                trail[-1] = current["title"]
                continue
            trail = [title for title, level in zip(trail, [s for s in current["levels"]] if current else []) if level < line["level"]]
            levels = [level for level in (current["levels"] if current else []) if level < line["level"]] + [line["level"]]
            trail = trail[: len(levels) - 1] + [line["text"]]
            current = {"title": line["text"], "level": line["level"], "levels": levels, "trail": trail, "lines": []}
            sections.append(current)
        elif current:
            current["lines"].append(line)
    out, seen = [], {}
    for section in sections:
        path = [title for title in section["trail"][:-1]] + [section["title"]]
        identity = slug(f"{chapter} {section['title']}")
        seen[identity] = seen.get(identity, 0) + 1
        if seen[identity] > 1:
            identity = slug(" ".join([chapter, *path]))
        out.append({"id": identity, "chapter": chapter, "title": section["title"], "level": section["level"], "path": path, "blocks": blocks_of(section["lines"])})
    return out


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sections = []
    for chapter, first, last in CHAPTERS:
        command = ["pdftohtml", "-xml", "-i", "-f", str(first), "-l", str(last), "-stdout", sys.argv[1]]
        xml = subprocess.run(command, check=True, capture_output=True, text=True).stdout
        sections += sections_of(chapter, lines_of(xml))
    document = {"source": "System Reference Document 5.2.1", "license": "CC-BY-4.0", "sections": sections}
    text = json.dumps(document, ensure_ascii=False, indent=1) + "\n"
    # "1½" is set as a 1 and a small fraction, which reads back as "11/2".
    OUT.write_text(text.replace("plus 11/2 times", "plus 1½ times"), encoding="utf-8")
    print(f"Wrote {len(sections)} sections to {OUT}")


if __name__ == "__main__":
    main()
