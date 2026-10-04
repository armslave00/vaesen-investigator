#!/usr/bin/env python3
"""Read the source XLSX and produce a lossless inventory for the web card.

The workbook is never saved or modified. OOXML is inspected directly so that
Excel extension validations and conditional-format expressions survive.
openpyxl is only used to expand Excel shared formulas and read cell styles.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import posixpath
import re
import warnings
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import openpyxl
from openpyxl.cell.cell import MergedCell
from openpyxl.utils.cell import range_boundaries


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "raw-docs/vaesen自动卡by拂晓鵺啼 v2.0.xlsx"
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS = {"m": MAIN}


def local(tag):
    return tag.rsplit("}", 1)[-1]


def xml_tree(element):
    """Keep namespace, attributes, text, and children without losing extensions."""
    return {
        "tag": element.tag,
        "attributes": dict(element.attrib),
        "text": element.text,
        "children": [xml_tree(child) for child in element],
    }


def text_of(element):
    return "" if element is None else "".join(element.itertext())


def descendants(element, name):
    return [child for child in element.iter() if local(child.tag) == name]


def parse_typed(value, kind):
    if value is None:
        return None
    if kind == "b":
        return value == "1"
    if kind in ("str", "e", "inlineStr"):
        return value
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except (ValueError, TypeError):
        return value


def bounds_contains(region, cell):
    x1, y1, x2, y2 = range_boundaries(region.replace("$", ""))
    cx1, cy1, _, _ = range_boundaries(cell)
    return x1 <= cx1 <= x2 and y1 <= cy1 <= y2


def formula_dependencies(formula, current_sheet):
    # All formulas in this version use ordinary A1 references; removing string
    # literals avoids accidentally interpreting an age label as a cell address.
    expression = re.sub(r'"(?:[^"]|"")*"', '""', formula)
    pattern = r"(?:(?:'((?:[^']|'')+)'|([\w\u4e00-\u9fff]+))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)"
    return [{"sheet": quoted.replace("''", "'") or unquoted or current_sheet,
             "reference": reference.replace("$", "")}
            for quoted, unquoted, reference in re.findall(pattern, expression)]


def validation_inventory(xml):
    validations = []
    for element in descendants(xml, "dataValidation"):
        formulas = {}
        for name in ("formula1", "formula2"):
            node = next((child for child in element if local(child.tag) == name), None)
            formulas[name] = text_of(node) if node is not None else None
        sqref_node = next((child for child in element if local(child.tag) == "sqref"), None)
        sqref = element.get("sqref") or text_of(sqref_node)
        validations.append({
            "ranges": sqref.split(),
            "sqref": sqref,
            "extension": element.tag != f"{{{MAIN}}}dataValidation",
            **dict(element.attrib),
            **formulas,
        })
    return validations


def formatting_inventory(xml):
    formats = []
    for element in descendants(xml, "conditionalFormatting"):
        sqref_node = next((child for child in element if local(child.tag) == "sqref"), None)
        sqref = element.get("sqref") or text_of(sqref_node)
        rules = []
        for rule in element:
            if local(rule.tag) != "cfRule":
                continue
            formulas = [text_of(node) for node in rule if local(node.tag) in ("formula", "f")]
            rules.append({
                **dict(rule.attrib),
                "formulas": formulas,
                "format": xml_tree(rule),
            })
        formats.append({
            "ranges": sqref.split(),
            "sqref": sqref,
            "extension": element.tag != f"{{{MAIN}}}conditionalFormatting",
            "rules": rules,
        })
    return formats


def extract(source):
    warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")
    # Normal read mode is required to inspect protection/styles and merged cells.
    # This is read-only analysis: there is deliberately no Workbook.save call.
    workbook = openpyxl.load_workbook(source, data_only=False)
    with ZipFile(source) as archive:
        workbook_xml = ET.fromstring(archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            item.get("Id"): posixpath.normpath(posixpath.join("xl", item.get("Target")))
            for item in relationships
        }
        source_bytes = source.read_bytes()
        result = {
            "schemaVersion": 1,
            "source": {
                "path": source.relative_to(ROOT).as_posix() if source.is_relative_to(ROOT) else str(source),
                "filename": source.name,
                "sha256": hashlib.sha256(source_bytes).hexdigest(),
                "size": len(source_bytes),
            },
            "calculationProperties": dict(workbook_xml.find("m:calcPr", NS).attrib),
            "definedNames": [dict(element.attrib, formula=text_of(element))
                             for element in workbook_xml.findall("m:definedNames/m:definedName", NS)],
            "sheets": [],
            "controls": [],
            "tables": [xml_tree(ET.fromstring(archive.read(name))) for name in archive.namelist()
                       if re.fullmatch(r"xl/tables/table\d+\.xml", name)],
            "styles": xml_tree(ET.fromstring(archive.read("xl/styles.xml"))),
            "packageParts": archive.namelist(),
        }
        formula_functions = Counter()
        for sheet_node in workbook_xml.findall("m:sheets/m:sheet", NS):
            name = sheet_node.get("name")
            sheet = workbook[name]
            part = targets[sheet_node.get(f"{{{REL}}}id")]
            xml = ET.fromstring(archive.read(part))
            merges = [element.get("ref") for element in xml.findall("m:mergeCells/m:mergeCell", NS)]
            validations = validation_inventory(xml)
            cells = {}
            for element in xml.findall("m:sheetData/m:row/m:c", NS):
                coordinate = element.get("r")
                cell = sheet[coordinate]
                is_merged = isinstance(cell, MergedCell)
                formula_node = element.find("m:f", NS)
                value_node = element.find("m:v", NS)
                kind = element.get("t", "n")
                formula = cell.value if formula_node is not None else None
                cached = parse_typed(value_node.text if value_node is not None else None, kind)
                if formula_node is not None and kind == "str" and value_node is not None and value_node.text is None:
                    cached = ""
                if formula:
                    formula_functions.update(re.findall(r"([A-Za-z_.]+)\(", formula))
                # Reading source cells rather than postprocessed merged placeholders
                # keeps all explicit blank/style records for auditing.
                cells[coordinate] = {
                    "value": None if formula is not None or is_merged else cell.value,
                    "formula": formula,
                    "cached": cached if formula is not None else None,
                    "type": kind,
                    "style": int(element.get("s", 0)),
                    "locked": cell.protection.locked,
                    "numberFormat": cell.number_format,
                    "mergedPlaceholder": is_merged,
                    "rawAttributes": dict(element.attrib),
                }
                if formula_node is not None:
                    cells[coordinate]["formulaAttributes"] = dict(formula_node.attrib)
                    cells[coordinate]["rawFormula"] = formula_node.text
                    cells[coordinate]["dependencies"] = formula_dependencies(formula, name)
            node_attrs = lambda key: dict(xml.find(f"m:{key}", NS).attrib) if xml.find(f"m:{key}", NS) is not None else None
            result["sheets"].append({
                "name": name,
                "state": sheet_node.get("state", "visible"),
                "part": part,
                "dimension": node_attrs("dimension")["ref"],
                "cells": cells,
                "mergedRanges": merges,
                "validations": validations,
                "conditionalFormats": formatting_inventory(xml),
                "protection": node_attrs("sheetProtection"),
                "rows": [dict(row.attrib) for row in xml.findall("m:sheetData/m:row", NS)],
                "columns": [dict(column.attrib) for column in xml.findall("m:cols/m:col", NS)],
                "views": [xml_tree(view) for view in xml.findall("m:sheetViews/m:sheetView", NS)],
                "pageSetup": node_attrs("pageSetup"),
                "pageMargins": node_attrs("pageMargins"),
                "hyperlinks": [dict(link.attrib) for link in xml.findall("m:hyperlinks/m:hyperlink", NS)],
                "relationships": xml_tree(ET.fromstring(archive.read(posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels"))))
                if posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels") in archive.namelist() else None,
            })
            if name == "角色卡":
                for row in sheet:
                    for cell in row:
                        if isinstance(cell, MergedCell) or cell.protection.locked:
                            continue
                        region = next((region for region in merges if bounds_contains(region, cell.coordinate)), cell.coordinate)
                        active_validation = next((validation for validation in validations
                                                  if any(bounds_contains(region, cell.coordinate) for region in validation["ranges"])), None)
                        result["controls"].append({
                            "sheet": name,
                            "cell": cell.coordinate,
                            "range": region,
                            "value": None if cell.data_type == "f" else cell.value,
                            "formula": cell.value if cell.data_type == "f" else None,
                            "validation": active_validation,
                        })
        result["summary"] = {
            "sheetCount": len(result["sheets"]),
            "literalCount": sum(cell["value"] is not None for sheet in result["sheets"] for cell in sheet["cells"].values()),
            "formulaCount": sum(1 for sheet in result["sheets"] for cell in sheet["cells"].values() if cell["formula"]),
            "formulaFunctions": dict(sorted(formula_functions.items())),
            "controlCount": len(result["controls"]),
            "validationCount": sum(len(sheet["validations"]) for sheet in result["sheets"]),
            "conditionalFormatRuleCount": sum(len(rule["rules"]) for sheet in result["sheets"] for rule in sheet["conditionalFormats"]),
            "cachedErrors": [{"sheet": sheet["name"], "cell": coordinate, "value": cell["cached"]}
                             for sheet in result["sheets"] for coordinate, cell in sheet["cells"].items()
                             if cell["formula"] and cell["type"] == "e"],
        }
        # Trace each editable anchor through helper formulas to affected outputs.
        formula_cells = [(sheet["name"], coordinate, cell)
                         for sheet in result["sheets"] for coordinate, cell in sheet["cells"].items()
                         if cell["formula"]]
        for control in result["controls"]:
            affected = {(control["sheet"], control["cell"])}
            while True:
                discovered = {(name, coordinate) for name, coordinate, cell in formula_cells
                              if any(dep["sheet"] == target_sheet and bounds_contains(dep["reference"], target_cell)
                                     for dep in cell["dependencies"] for target_sheet, target_cell in affected)}
                if discovered.issubset(affected):
                    break
                affected.update(discovered)
            affected.discard((control["sheet"], control["cell"]))
            control["affectedFormulas"] = [{"sheet": name, "cell": coordinate}
                                            for name, coordinate in sorted(affected)]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=ROOT / "web/data/workbook.json")
    args = parser.parse_args()
    data = extract(args.source.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(data["summary"], ensure_ascii=False))


if __name__ == "__main__":
    main()
