#!/usr/bin/env python3
"""Convert the supplied Chinese Vaesen PDF using its visible text geometry.

Run with pdfplumber and pypdf installed. Table overrides are derived from this
edition's ruled tables; source page numbers in the output are one-based.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "raw-docs/北欧奇谭规则书.pdf"
OUT = ROOT / "docs/rulebook"
CACHE = ROOT / "tmp/pdfs"
DATA = ROOT / "scripts/data"
PAGE_EXTRAS = {}
SIDEBARS = {}
CHAPTERS = [
    ("01-introduction", "导言", 8, 19),
    ("02-player-characters", "玩家角色", 20, 39),
    ("03-skills", "技能", 40, 51),
    ("04-talents", "天赋", 52, 59),
    ("05-conflict-and-injuries", "冲突与受伤", 60, 81),
    ("06-society-and-headquarters", "结社与大本营", 82, 99),
    ("07-mythic-north-and-upsala", "神秘的北欧和乌普萨拉", 100, 113),
    ("08-vaesen", "自在之物", 114, 173),
    ("09-mysteries", "谜题", 174, 199),
    ("10-dance-of-dreams", "梦中之舞", 200, 217),
    ("11-background-tables", "背景故事表", 218, 233),
]
MAIN_TITLES = {9, 21, 41, 53, 61, 83, 101, 115, 175, 200, 218}
ART = {
    8: "章节插图", 15: "章节插图", 20: "章节插图", 40: "章节插图",
    52: "章节插图", 60: "章节插图", 82: "章节插图", 100: "章节插图",
    103: "神秘北欧地图", 110: "乌普萨拉地图", 114: "章节插图",
    174: "章节插图", 184: "章节插图", 204: "女巫之猫旅馆平面图",
    234: "角色卡", 235: "大本营卡",
}


def load_geometry():
    path = CACHE / "geometry.json"
    if path.exists():
        return json.loads(path.read_text())
    import pdfplumber
    result = []
    with pdfplumber.open(SOURCE) as pdf:
        for i, page in enumerate(pdf.pages):
            result.append({"page": i + 1, "width": page.width, "height": page.height,
                           "chars": [dict({k: c[k] for k in
                                     ("text", "x0", "x1", "top", "bottom", "size", "fontname")},
                                      baseline=page.height-c["matrix"][5],
                                      slope=c["matrix"][1]/c["matrix"][0] if c["matrix"][0] else 0)
                                     for c in page.chars]})
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False))
    return result


def clean(text):
    # In this PDF the regular Chinese font maps many word spaces to a period.
    text = re.sub(r"(?<=[\u3400-\u9fff])\.(?!\d)", " ", text)
    text = re.sub(r"(?<!\d)\.(?=[\u3400-\u9fff])", " ", text)
    text = re.sub(r"(?<=[A-Za-z])\.(?=[A-Za-z])", " ", text)
    text = re.sub(r"(?<=[\u3400-\u9fff])\.(?=\d)", " ", text)
    text = re.sub(r"\.\s+(?=[\u3400-\u9fff])", " ", text)
    text = re.sub(r"([+−-])\.(?=\d)", r"\1", text)
    text = re.sub(r"(\d)\.\s*(?=[点个枚位张颗只轮米])", r"\1", text)
    text = re.sub(r"([。！？；，])\.", r"\1", text)
    if not re.match(r"^\s*\d{1,2}\.", text):
        text = re.sub(r"(?<=\d)\.(?=[\u3400-\u9fff])", " ", text)
    text = re.sub(r"^\s*\.\s*", "", text)
    text = re.sub(r"[ \t]+", " ", text).strip()
    text = re.sub(r"([\u3400-\u9fff]) ([\u3400-\u9fff])", r"\1\2", text)
    return text


def inside(c, bbox):
    x0, top, x1, bottom = bbox
    return x0 - .4 <= (c["x0"] + c["x1"]) / 2 <= x1 + .4 and \
        top - .4 <= (c.get("source_top", c["top"]) +
                      c.get("source_bottom", c["bottom"])) / 2 <= bottom + .4


def visible_chars(page):
    result, seen = [], set()
    for source in page["chars"]:
        c = dict(source)
        if c["x0"] < 0 or c["x0"] >= page["width"] or c["top"] < 0:
            continue
        if c["size"] <= 11 and (c["top"] < 58 or
                                  (c["top"] > 858 and page["page"] != 236)):
            continue
        key = (c["text"], round(c["x0"], 1), round(c["top"], 1))
        if key in seen:
            continue
        seen.add(key)
        c["source_top"], c["source_bottom"] = c["top"], c["bottom"]
        if "baseline" in c:
            baseline = c["baseline"] + c.get("slope", 0) * c["x0"]
            c["top"], c["bottom"] = baseline - c["size"], baseline
        if "Wingdings" in c["fontname"]:
            c["text"] = "◆"
        if "Webdings" in c["fontname"] and c["text"] == "F":
            c["text"] = "□"
        result.append(c)
    return result


def lines(chars):
    def superscript(c):
        return (c["size"] < 8.5 and (c["text"].strip().isdigit() or c["text"] in "†‡")) or \
            ("FZYTK" in c["fontname"] and c["size"] < 25)
    ordinary = [c for c in chars if not superscript(c)]
    small = [c for c in chars if superscript(c)]
    groups = []
    for c in sorted(ordinary, key=lambda c: (c["bottom"], c["x0"])):
        match = next((g for g in reversed(groups[-4:])
                      if abs(g["baseline"] - c["bottom"]) < 3.8), None)
        if match is None:
            groups.append({"top": c["top"], "baseline": c["bottom"], "chars": [c]})
        else:
            match["chars"].append(c)
            match["top"] = min(match["top"], c["top"])
    for c in small:
        candidates = [g for g in groups if -14 <= c["top"] - g["top"] <= 8]
        if candidates:
            nearest = min(candidates, key=lambda g:
                          min(abs(c["x0"] - x["x1"]) for x in g["chars"]))
            cc = dict(c)
            cc["text"] = f"<sup>{c['text']}</sup>"
            nearest["chars"].append(cc)
        else:
            groups.append({"top": c["top"], "baseline": c["bottom"], "chars": [c]})
    result = []
    for group in sorted(groups, key=lambda g: g["top"]):
        cs = sorted(group["chars"], key=lambda c: c["x0"])
        value = ""
        previous = None
        for c in cs:
            if previous and c["x0"] - previous["x1"] > 2:
                value += " "
            value += c["text"]
            previous = c
        value = clean(value)
        if value:
            result.append({"text": value, "chars": cs, "top": group["top"],
                           "bottom": max(c["bottom"] for c in cs),
                           "x0": min(c["x0"] for c in cs),
                           "x1": max(c["x1"] for c in cs),
                           "size": max(c["size"] for c in cs)})
    return result


def heading(line, page):
    size = line["size"]
    fonts = " ".join(c["fontname"] for c in line["chars"])
    if size >= 30 and ("FZYTK" in fonts or "SourceHanSerifCN-Bold" in fonts):
        if page in MAIN_TITLES and size > 40:
            return 0
        return 3 if 30 <= page <= 39 or 128 <= page <= 169 else 2
    if "SourceHanSerifCN-Bold" in fonts and size >= 17:
        if 128 <= page <= 169:
            return 4
        if 54 <= page <= 59:
            return 2
        return 3
    if "SourceHanSerifCN-Bold" in fonts and size >= 13.5:
        if 54 <= page <= 59:
            return 3
        return 4
    if "SourceHanSansCN-Bold" in fonts and size >= 13.5:
        return 4
    if "SourceHanSerifCN-Bold" in fonts and size >= 12:
        return 4
    if "FZSJ-YISNLYSBA" in fonts and size >= 15:
        return 4  # Dates in Nora's diary.
    return None


def join_text(a, b):
    if a.endswith("-") and b and b[0].isascii() and b[0].isalpha():
        return a[:-1] + b
    separator = " " if a and b and a[-1].isascii() and b[0].isascii() else ""
    return a + separator + b


def render_region(chars, tables, page):
    items = [(line["top"], "line", line) for line in lines(chars)]
    items.extend((t["bbox"][1], "table", t) for t in tables)
    items.sort(key=lambda x: x[0])
    output, paragraph = [], ""
    previous = None
    current_kind = None
    base = min((c["x0"] for c in chars if c["text"].strip()), default=60)

    def flush():
        nonlocal paragraph
        if paragraph:
            output.append(paragraph)
            paragraph = ""

    for _, kind, item in items:
        if kind == "table":
            flush()
            output.append(item["markdown"])
            previous, current_kind = None, None
            continue
        text = item["text"]
        level = heading(item, page)
        if level is not None:
            flush()
            if level:
                prefix = "#" * level + " "
                if previous and current_kind == "heading" and \
                        item["top"] - previous["top"] < 49 and \
                        output and output[-1].startswith(prefix):
                    output[-1] += text
                else:
                    output.append(prefix + text)
            previous, current_kind = item, "heading"
            continue
        bullet = re.match(r"^[◆Ê□]\s*\.?\s*(.*)", text)
        numbered = re.match(r"^(\d{1,2})[.．]\s*\.?\s*(.+)", text)
        if page == 22 and numbered is None:
            numbered = re.match(r"^(1[012])\s+(.+)", text)
        if numbered and re.match(r"^[点个枚位张颗只轮米]", numbered.group(2)):
            numbered = None
        dialogue = re.match(r"^(GM[：:]|玩家\s*(?:\d+|[：:]))", text)
        if bullet or numbered or dialogue:
            flush()
            if bullet:
                paragraph = "- " + ("□ " if text.startswith("□") else "") + bullet.group(1)
            elif numbered:
                paragraph = numbered.group(1) + ". " + numbered.group(2)
            else:
                paragraph = text
            current_kind = "list" if bullet or numbered else "dialogue"
        else:
            gap = item["top"] - previous["top"] if previous else 0
            indented = item["x0"] >= base + 20 and current_kind != "list"
            unfinished = paragraph and not re.search(r"[。！？.!?]$", paragraph) and \
                not paragraph.startswith("——") and current_kind != "dialogue"
            if previous and not unfinished and (gap > max(28, item["size"] * 2.5) or
                             (indented and previous["x1"] < item["x1"] - 10)):
                flush()
                current_kind = "body"
            paragraph = join_text(paragraph, text)
        previous = item
    flush()
    return "\n\n".join(output)


def full_bands(chars, page):
    if page in {1, 5, 216, 240}:
        return [(0, 910)]
    if page == 238:
        return [(0, 415)]
    if page == 239:
        return []
    selected = []
    for line in lines(chars):
        # A visible glyph in the gutter distinguishes full-width text from
        # two unrelated lines that happen to share a baseline.
        gutter = any(c["x0"] <= 350 <= c["x1"] for c in line["chars"])
        lore = any("FZJLJW" in c["fontname"] for c in line["chars"])
        if gutter or lore:
            selected.append((line["top"] - 1, line["bottom"] + 1))
    merged = []
    for start, end in sorted(selected):
        if merged and start <= merged[-1][1] + 7:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def layout_markdown(chars, page_tables, number):
    bands = full_bands(chars, number)
    bands += [(t["bbox"][1], t["bbox"][3]) for t in page_tables
              if t["bbox"][2] - t["bbox"][0] >= 450]
    merged = []
    for start, end in sorted(bands):
        if merged and start <= merged[-1][1] + .5:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    cursor = 0
    parts = []

    def region(top, bottom, full=False):
        cs = [c for c in chars if top <= (c["top"] + c["bottom"]) / 2 < bottom]
        ts = [t for t in page_tables if top <= (t["bbox"][1] + t["bbox"][3]) / 2 < bottom]
        if full:
            return render_region(cs, ts, number)
        output = []
        for left in (True, False):
            column_chars = [c for c in cs if ((c["x0"] + c["x1"]) / 2 < 350) == left]
            column_tables = [t for t in ts if ((t["bbox"][0] + t["bbox"][2]) / 2 < 350) == left]
            output.append(render_region(column_chars, column_tables, number))
        if len(output) == 2 and all(output):
            left_parts, right_parts = output[0].split("\n\n"), output[1].split("\n\n")
            if not re.search(r"[。！？.!?]$", left_parts[-1]) and \
                    not re.match(r"^(#|\||>|!|\d+\.|- )", right_parts[0]) and \
                    not left_parts[-1].startswith(("#", "|", "!")):
                left_parts[-1] = join_text(left_parts[-1], right_parts.pop(0))
                output = ["\n\n".join(left_parts), "\n\n".join(right_parts)]
        return "\n\n".join(x for x in output if x)

    for start, end in merged:
        if start > cursor:
            parts.append(region(cursor, start))
        parts.append(region(start, end + .01, full=True))
        cursor = end + .01
    parts.append(region(cursor, 920))
    return "\n\n".join(x for x in parts if x)


def geometric_inside(c, bbox):
    x0, top, x1, bottom = bbox
    return x0 - .5 <= (c["x0"] + c["x1"]) / 2 <= x1 + .5 and \
        top - .5 <= (c["top"] + c["bottom"]) / 2 <= bottom + .5


def page_markdown(page, tables, notes, defer_extras=False):
    number = page["page"]
    result = [f'<a id="pdf-page-{number}"></a>',
              f'<!-- 来源：北欧奇谭规则书.pdf；PDF 第 {number} 页' +
              (f'；原书第 {number - 4} 页' if 9 <= number <= 233 else '') + ' -->']
    if number in ART:
        result.append(f'![{ART[number]}](assets/page-{number:03d}.png)')
        return "\n\n".join(result)
    if number == 5:
        result.append("## 制作团队\n\nBased on the book Vaesen by Johan Egerkrans\n\n"
                      "| 原书职务 | 制作人员 |\n| --- | --- |\n"
                      "| Illustrations and original concept | Johan Egerkrans |\n"
                      "| Game director | Nils Karlén |\n"
                      "| Lead writer | Nils Hintze |\n"
                      "| Editors | Tomas Härenstam, Mattias Johnsson Haake |\n"
                      "| Additional writing | Rickard Antroia, Nils Karlén |\n"
                      "| Year Zero game engine | Tomas Härenstam |\n"
                      "| Graphic design | Dan Algstrand, Christian Granath |\n"
                      "| Layout and prepress | Dan Algstrand |\n"
                      "| Maps | Tobias Tranell |\n"
                      "| Translation | Niklas Lundmark |\n"
                      "| Proofreading | Brandon Bowling |\n"
                      "| Customer support | Jenny Bremberg, Daniel Lehto |\n"
                      "| Playtesters | Simon Andersson, Rickard Antroia, Marco Behrmann, Therese Clarhed, Nathalie Clarhed, Kosta Kostulas, Jonas Hertz, Tomas Härenstam, Anna Westerling |\n"
                      "| Special thanks to | Axel and Olof Clarhed, Gabrielle de Bourg, Simon Engqvist, Hanna Wedin |\n"
                      "| Print | Livonia Print 2020 |\n"
                      "| ISBN | 978-91-89143-92-0 |\n\n"
                      "Copyright 2020 © Fria Ligan AB and Johan Egerkrans")
        return "\n\n".join(result)
    chars = visible_chars(page)
    if number == 240:
        chars = [c for c in chars if c["source_top"] < 780]
    if number == 217:
        result.append("### C：诺拉的日记")
        chars = [c for c in chars if not (760 < c["source_top"] < 775 and c["x0"] < 350
                                        and c["size"] < 13)]
    page_notes = notes.get(str(number), [])
    note_chars = []
    for note in page_notes:
        picked = [c for c in chars if inside(c, note["bbox"])]
        note_chars.append(picked)
        chars = [c for c in chars if not inside(c, note["bbox"])]
    page_tables = tables.get(number, [])
    table_keys = {tuple(key) for t in page_tables for key in t.get("char_keys", [])}
    chars = [c for c in chars if
             (c["text"], round(c["x0"], 3), round(c["source_top"], 3)) not in table_keys and
             not any(inside(c, t.get("text_bbox", t["bbox"]))
                     for t in page_tables if not t.get("char_keys"))]
    extras = []
    for sidebar in sorted(SIDEBARS.get(str(number), []), key=lambda b: (b["bbox"][0] > 350, b["bbox"][1])):
        picked = [c for c in chars if geometric_inside(c, sidebar["bbox"])]
        picked_tables = [t for t in page_tables if geometric_inside(
            {"x0": t["bbox"][0], "x1": t["bbox"][2],
             "top": t["bbox"][1], "bottom": t["bbox"][3]}, sidebar["bbox"])]
        value = layout_markdown(picked, picked_tables, number)
        if value:
            extras.append(f'<!-- PDF 第 {number} 页侧栏：{sidebar["title"]} -->\n\n' + value)
        chars = [c for c in chars if not geometric_inside(c, sidebar["bbox"])]
        page_tables = [t for t in page_tables if t not in picked_tables]
    if number == 128:
        result.append("## 自在之物图鉴")
    value = layout_markdown(chars, page_tables, number)
    if value:
        result.append(value)
    for cs in note_chars:
        note_text = render_region(cs, [], number)
        extras.append("> " + note_text.replace("\n", "\n> "))
    if defer_extras:
        PAGE_EXTRAS[number] = extras
    else:
        result.extend(extras)
    if number == 240:
        result.append("ISBN 978-91-89143-92-0\n\n© 2020 Fria Ligan AB and Johan Egerkrans\n\nFLFVAS01")
    return "\n\n".join(result)


def chapter_pages(pages, start, end, tables, notes):
    result = []
    pending = []
    for n in range(start, end + 1):
        markdown = page_markdown(pages[n - 1], tables, notes, defer_extras=True)
        if n in ART and result:
            pending.append(markdown)
            continue
        blocks = markdown.split("\n\n")
        header, body = blocks[:2], blocks[2:]
        joined = False
        if result and body:
            previous = result[-1].split("\n\n")
            if previous and not re.search(r"[。！？.!?]$", previous[-1]) and \
                    not re.match(r"^(#|\||>|!|\d+\.|- )", body[0]) and \
                    not previous[-1].startswith(("#", "|", "!", "<")):
                previous[-1] += "".join(header) + body.pop(0)
                result[-1] = "\n\n".join(previous)
                joined = True
        result.extend(pending)
        pending = PAGE_EXTRAS.get(n, [])
        if joined:
            if body:
                result.append("\n\n".join(body))
        else:
            result.append(markdown)
    result.extend(pending)
    return result


def add_chapter_toc(text):
    output, entries, index = [], [], 0
    for line in text.splitlines():
        match = re.match(r"^(#{2,3}) (.+)$", line)
        if match:
            index += 1
            anchor = f"section-{index:02d}"
            output.append(f'<a id="{anchor}"></a>')
            output.append("")
            label = re.sub(r"<sup>.*?</sup>", "", match.group(2)).strip()
            label = re.sub(r"(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])", "", label)
            entries.append((len(match.group(1)), label, anchor))
        output.append(line)
    body = "\n".join(output)
    if not entries:
        return body
    head, rest = body.split("\n\n", 2)[:2], body.split("\n\n", 2)[2]
    toc = "## 本章目录\n\n" + "\n".join(
        ("  " if level == 3 else "") + f"- [{label}](#{anchor})"
        for level, label, anchor in entries)
    return "\n\n".join(head + [toc, rest])


def render_index(page):
    chars = [c for c in visible_chars(page) if c["size"] < 20]
    result = ["# 原书索引", "原书页码保留原样；正文页码定位见各章的 `pdf-page-N` 锚点。",
              '<a id="pdf-page-236"></a>', '<!-- 来源：北欧奇谭规则书.pdf；PDF 第 236 页 -->']
    rows = []
    pending = ""
    for low, high in [(0, 173), (173, 291), (291, 409), (409, 528), (528, 701)]:
        for line in lines([c for c in chars if low <= c["x0"] < high]):
            text = line["text"]
            text = re.sub(r"(?<=\d) (?=\d)", "", text)
            if re.fullmatch(r"[\d，,、 ]+", text) and pending:
                rows.append([pending, text.replace(" ", "")])
                pending = ""
                continue
            match = re.match(r"^(.*?)\s+([\d，,、 ]+)$", text)
            if match:
                rows.append([pending + match.group(1), match.group(2).replace(" ", "")])
                pending = ""
            else:
                pending += text
        if pending:
            rows.append([pending, ""])
            pending = ""
    result.append("| 术语 | 原书页码 |\n| --- | --- |\n" +
                  "\n".join(f"| {term} | {pages} |" for term, pages in rows))
    return "\n\n".join(result) + "\n"


def assets(pages):
    asset_dir = OUT / "assets"
    asset_dir.mkdir(parents=True, exist_ok=True)
    for n in ART:
        destination = asset_dir / f"page-{n:03d}.png"
        if destination.exists():
            continue
        subprocess.run(["pdftoppm", "-f", str(n), "-l", str(n), "-scale-to",
                        "2000" if n in {103, 110, 204, 234, 235} else "1100",
                        "-singlefile", "-png", str(SOURCE), str(destination.with_suffix(""))],
                       check=True)


def main():
    global SIDEBARS
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-assets", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    pages = load_geometry()
    table_path = DATA / "rulebook-tables.json"
    if not table_path.exists():
        table_path = CACHE / "tables.json"
    table_rows = json.loads(table_path.read_text()) if table_path.exists() else []
    tables = defaultdict(list)
    for table in table_rows:
        tables[table["page"]].append(table)
    note_path = DATA / "rulebook-notes.json"
    notes = json.loads(note_path.read_text()) if note_path.exists() else {}
    sidebar_path = DATA / "rulebook-sidebars.json"
    SIDEBARS = json.loads(sidebar_path.read_text()) if sidebar_path.exists() else {}
    front = ["# 书目信息、制作团队与序言"]
    for n in [1, 5, 7]:
        front.append(page_markdown(pages[n - 1], tables, notes))
    front.append("## 汉化团队\n\n翻译：暴食、北河、通灵恶犬皮卡缺\n\n排版：拂晓鵺啼\n\n仅供学习交流使用，严禁用于商业用途，喜欢请支持正版。\n\n<!-- 来源：PDF 第 6 页；原目录由 Markdown 目录替代 -->")
    (OUT / "00-front-matter.md").write_text("\n\n".join(front) + "\n")
    records = []
    for i, (slug, title, start, end) in enumerate(CHAPTERS, 1):
        content = [f"# 第 {i} 章：{title}",
                   f"[返回总目录](README.md) · 原始 PDF 第 {start}–{end} 页"]
        content.extend(chapter_pages(pages, start, end, tables, notes))
        path = OUT / (slug + ".md")
        text = add_chapter_toc("\n\n".join(content))
        neighbors = ["[返回总目录](README.md)"]
        if i > 1:
            neighbors.insert(0, f"[上一章]({CHAPTERS[i - 2][0]}.md)")
        if i < len(CHAPTERS):
            neighbors.append(f"[下一章]({CHAPTERS[i][0]}.md)")
        path.write_text(text + "\n\n" + " · ".join(neighbors) + "\n")
        records.append({"file": str(path.relative_to(ROOT)), "title": title,
                        "pdf_pages": [start, end]})
    forms = ["# 可打印表单", "表单保留原页图，方便打印及对照字段。", "## 角色卡",
             page_markdown(pages[233], tables, notes), "## 大本营卡",
             page_markdown(pages[234], tables, notes)]
    (OUT / "12-character-and-headquarters-sheets.md").write_text("\n\n".join(forms) + "\n")
    (OUT / "13-original-index.md").write_text(render_index(pages[235]))
    back = ["# 致谢与封底"]
    for n in [238, 239, 240]:
        back.append(page_markdown(pages[n - 1], tables, notes))
    (OUT / "14-back-matter.md").write_text("\n\n".join(back) + "\n")
    if not args.skip_assets:
        assets(pages)
    manifest = {"source": str(SOURCE.relative_to(ROOT)),
                "sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                "pdf_pages": len(pages), "chapters": records,
                "table_count": len(table_rows),
                "table_data_rows": sum(len(t["rows"]) - 1 for t in table_rows),
                "sidebar_count": sum(len(boxes) for boxes in SIDEBARS.values()),
                "image_pages": sorted(ART),
                "blank_decorative_pages": [2, 3, 4, 237]}
    (OUT / "conversion-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"Converted {len(pages)} source pages; {len(records)} chapters; {len(table_rows)} tables")


if __name__ == "__main__":
    main()
