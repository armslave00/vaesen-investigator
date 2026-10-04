#!/usr/bin/env python3
"""Extract independent test expectations from the original OOXML, without recalculating."""

import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "raw-docs" / "vaesen自动卡by拂晓鵺啼 v2.0.xlsx"
DESTINATION = ROOT / "test" / "fixtures" / "workbook-reference.json"
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": MAIN_NS}


def value_of(cell, strings):
    raw = cell.findtext("m:v", namespaces=NS)
    kind = cell.get("t")
    if kind == "inlineStr":
        return "".join(cell.find("m:is", NS).itertext())
    if raw is None:
        return None
    if kind == "s":
        return strings[int(raw)]
    if kind in ("str", "e"):
        return raw
    if kind == "b":
        return raw == "1"
    number = float(raw)
    return int(number) if number.is_integer() else number


def coordinates(address):
    letters, row = re.fullmatch(r"([A-Z]+)(\d+)", address).groups()
    column = 0
    for letter in letters:
        column = column * 26 + ord(letter) - ord("A") + 1
    return column, int(row)


def letters(column):
    result = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        result = chr(ord("A") + remainder) + result
    return result


def expand_range(region):
    first, _, last = region.partition(":")
    first_column, first_row = coordinates(first.replace("$", ""))
    last_column, last_row = coordinates((last or first).replace("$", ""))
    return [f"{letters(column)}{row}" for row in range(first_row, last_row + 1) for column in range(first_column, last_column + 1)]


with ZipFile(SOURCE) as archive:
    shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    strings = ["".join(item.itertext()) for item in shared]
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    styles = ET.fromstring(archive.read("xl/styles.xml"))
    unlocked_styles = {
        index
        for index, style in enumerate(styles.findall("m:cellXfs/m:xf", NS))
        if style.find("m:protection", NS) is not None and style.find("m:protection", NS).get("locked") == "0"
    }
    targets = {item.get("Id"): item.get("Target") for item in relationships}
    cells_by_sheet = {}
    cached_formulas = {}
    literal_cells = {}
    validation_sources = {}
    editable_controls = []
    raw_conditional_formats = []

    for sheet in workbook.findall("m:sheets/m:sheet", NS):
        name = sheet.get("name")
        target = targets[sheet.get(f"{{{REL_NS}}}id")]
        path = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        xml = ET.fromstring(archive.read(path))
        if name == "角色卡":
            for formatting in xml.iter():
                if formatting.tag.split("}")[-1] != "conditionalFormatting":
                    continue
                sqref = formatting.get("sqref") or next(
                    (item.text for item in formatting if item.tag.split("}")[-1] == "sqref"), ""
                )
                formulas = [
                    item.text
                    for item in formatting.iter()
                    if item.tag.split("}")[-1] in ("formula", "f") and item.text
                ]
                raw_conditional_formats.append({"sqref": sqref, "formulas": formulas})
        merges = [item.get("ref") for item in xml.findall("m:mergeCells/m:mergeCell", NS)]
        values = {}
        for cell in xml.findall(".//m:sheetData/m:row/m:c", NS):
            address = cell.get("r")
            value = value_of(cell, strings)
            values[address] = value
            if name == "角色卡" and int(cell.get("s", "0")) in unlocked_styles:
                column, row = coordinates(address)
                is_placeholder = False
                for merge in merges:
                    first, last = merge.split(":")
                    first_column, first_row = coordinates(first)
                    last_column, last_row = coordinates(last)
                    if first_column <= column <= last_column and first_row <= row <= last_row and address != first:
                        is_placeholder = True
                        break
                if not is_placeholder:
                    editable_controls.append(f"{name}!{address}")
            if cell.find("m:f", NS) is not None:
                cached_formulas[f"{name}!{address}"] = value
            elif value is not None:
                literal_cells[f"{name}!{address}"] = value
        cells_by_sheet[name] = values
        validation_sources[name] = [
            {"sqref": item.get("sqref"), "formula": item.findtext("m:formula1", namespaces=NS)}
            for item in xml.findall("m:dataValidations/m:dataValidation", NS)
        ]

    helper = cells_by_sheet["辅助表"]
    professions = [
        {
            "name": helper[f"A{row}"],
            "minimum": helper[f"B{row}"],
            "maximum": helper[f"C{row}"],
            "talents": [helper[f"{column}{row}"] for column in "DEF"],
            "attribute": helper[f"G{row}"],
            "skill": helper[f"H{row}"],
            "equipment": helper[f"I{row}"],
            "row": row,
        }
        for row in range(2, 13)
    ]
    talent_table = cells_by_sheet["天赋表"]
    talents = [
        {"name": talent_table[f"B{row}"], "description": talent_table[f"C{row}"], "row": row}
        for row in range(2, 59)
    ]
    asset_table = cells_by_sheet["资产表"]
    assets = [
        {
            "value": asset_table[f"A{row}"],
            "name": asset_table[f"B{row}"],
            "description": asset_table[f"C{row}"],
        }
        for row in range(2, 10)
    ]
    age_groups = [
        {"name": helper[f"A{row}"], "attributes": helper[f"B{row}"], "skills": helper[f"C{row}"], "row": row}
        for row in range(16, 19)
    ]
    keepsakes = [cells_by_sheet["纪念物表"][f"B{row}"] for row in range(2, 38)]
    conditional_highlights = {profession["name"]: [] for profession in professions}
    resource_limit_rule = None
    for formatting in raw_conditional_formats:
        addresses = [address for region in formatting["sqref"].split() for address in expand_range(region)]
        for formula in formatting["formulas"]:
            match = re.fullmatch(r"\$D\$15=辅助表!\$A\$(\d+)", formula)
            if match:
                name = helper[f"A{match.group(1)}"]
                conditional_highlights[name].extend(addresses)
            if "$E$18>VLOOKUP" in formula:
                match = re.search(r"辅助表!\$A\$(\d+):\$C\$(\d+)", formula)
                resource_limit_rule = {"formula": formula, "addresses": addresses, "professionRows": list(range(int(match.group(1)), int(match.group(2)) + 1))}
    conditional_highlights = {name: sorted(set(addresses)) for name, addresses in conditional_highlights.items()}
    reference = {
        "source": SOURCE.name,
        "cachedFormulas": cached_formulas,
        "literalCells": literal_cells,
        "professions": professions,
        "talents": talents,
        "assets": assets,
        "ageGroups": age_groups,
        "keepsakes": keepsakes,
        "validations": validation_sources,
        "editableControls": editable_controls,
        "conditionalHighlights": conditional_highlights,
        "resourceLimitRule": resource_limit_rule,
    }
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(reference, ensure_ascii=False, indent=2) + "\n")
    print(f"Extracted {len(cached_formulas)} cached formulas and {len(literal_cells)} literal cells to {DESTINATION}")
