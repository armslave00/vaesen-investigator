#!/usr/bin/env python3
"""Extract local rulebook tables and classify talent effects, without editing sources."""

from __future__ import annotations

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
CHARACTERS = "docs/rulebook/02-player-characters.md"
TALENTS = "docs/rulebook/04-talents.md"
CONFLICT = "docs/rulebook/05-conflict-and-injuries.md"
SKILLS = "docs/rulebook/03-skills.md"


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def source(path, page, section=None):
    return {
        "document": "北欧奇谭规则书.pdf", "markdown": path,
        "pdfPage": page, "printedPage": page - 4,
        "anchor": section or f"pdf-page-{page}", "label": f"原书 {page - 4} / PDF {page}",
    }


def current_page(text, offset):
    return int(re.findall(r'<a id="pdf-page-(\d+)"', text[:offset])[-1])


def table(text, title, occurrence=0):
    matches = list(re.finditer(rf"^#### {re.escape(title)}\n", text, re.M))
    body = text[matches[occurrence].end():].lstrip()
    rows = []
    for line in body.splitlines():
        if not line.startswith("|"):
            break
        columns = [part.strip() for part in line.strip("|").split("|")]
        if columns and not all(re.fullmatch(r"[-: ]+", part) for part in columns):
            rows.append(columns)
    return rows[0], rows[1:]


def effect(kind, activation="manual", **kwargs):
    return {"type": kind, "activation": activation, **kwargs}


def dice(target, amount, condition, activation="manual", **kwargs):
    return effect("diceBonus", activation, target=target, amount=amount, condition=condition, **kwargs)


def ignore(target, activation="always", condition="对应技能检定", condition_type="relevant", **kwargs):
    return effect("ignoreConditions", activation, target=target, conditionType=condition_type, condition=condition, **kwargs)


USES_SESSION = {"count": 1, "period": "session"}
USES_MYSTERY = {"count": 1, "period": "mystery"}
EFFECTS = {
    "书虫": [dice("学习", 2, "从书籍或图书馆寻找线索")],
    "学富五车": [effect("establishFact", target="学习", condition="地点或现象的真相；GM 决定；不能创造自在之物相关内容")],
    "知识是可靠的": [ignore("学习")],
    "军医": [dice("恐惧", 2, "面对尸体或残破人体")],
    "主任医师": [effect("healingPerSuccess", target="医学", amount=4, replaces=3, condition="通过医学治疗其他玩家的状态；额外成功同样适用")],
    "应急医学": [ignore("医学", ambiguity="正文写无视状态；译注明确指出英文原文精神状态与医学属精准的矛盾，官方没有勘误，应由游戏小组确认解释。")],
    "寻血犬": [dice("警觉", 2, "追踪猎物")],
    "草药专家": [effect("ignoreEquipmentRequirement", target="医学", condition="使用野外草药替代医疗用品")],
    "神射手": [dice("远程战斗", 2, "成功埋伏后的首次攻击")],
    "魔术手法": [effect("replaceSkill", target="操控人心", replacement="隐秘行动", condition="使用魔术手法影响他人")],
    "灵媒": [effect("specialAction", target="观察", condition="降灵仪式；额外成功提供更多信息/时间/显现；失败可能误导、攻击或状态")],
    "恐惧来袭": [effect("fearAttack", target="逻辑/共情", fearLevel=1, action="slow", condition="本区域一个 NPC；对自在之物无效；NPC 可按范围内友善单位数量获得奖励骰")],
    "久经沙场": [effect("initiativeDraw", "always", draw=2, keep=1, condition="确定先攻时")],
    "绅士": [ignore("操控人心", condition_type="mental")],
    "战术家": [effect("grantNextCheckBonus", amount=2, spendExtraSuccesses=1, condition="远程战斗额外成功；友善单位遵从指令；可指令多名不同单位")],
    "赦免": [effect("confessionHealing", amount=3, replaces=2, condition="其他角色向你忏悔并袒露行为")],
    "祝福": [effect("grantAdvantage", amount=2, target="any", uses=USES_MYSTERY, condition="祝福一个物品或另一个玩家；选择一次检定；使用或谜题结束失效", ambiguity="正文同时写每次游戏可祝福、每个谜题只能祝福一个对象，保留两种限制，不自动刷新。")],
    "忏悔者": [effect("replaceSkill", target="操控人心", replacement="观察", condition="保密的谈话")],
    "鹰眼": [dice("警觉", 2, "远程观测")],
    "基础推演法": [effect("askGM", uses=USES_SESSION, condition="要求 GM 解释线索如何串联")],
    "专注": [ignore("调查")],
    "忠诚": [dice("恐惧", 2, "你发誓保护的人在场")],
    "强硬如钉": [dice("力量", 2, "徒手战斗", "weapon", weaponKind="unarmed")],
    "坚韧": [ignore("any", "manual", "任何一次检定", uses=USES_SESSION)],
    "流浪者戏法": [dice("隐秘行动", 2, "在富人面前隐藏自己或物品")],
    "疑心": [ignore("警觉")],
    "云游": [effect("createNPC", target="操控人心", uses=USES_MYSTERY, condition="该地点一个 NPC 或曾经见过的人；GM 决定变化与看法；失败可能敌意或需要帮助")],
    "自动书写": [effect("specialAction", target="启迪", uses=USES_SESSION, condition="引导灵体自动书写取得线索；额外成功提供更多线索；失败可能状态、附身或 1D6 小时人格改变")],
    "记者": [effect("replaceSkill", target="操控人心", replacement="启迪", condition="吸引或哄骗他人以获得信息")],
    "墨客": [ignore("启迪")],
    "战场经历": [dice("医学", 2, "治疗肉体重创")],
    "勇敢": [dice("恐惧", 1, "恐惧检定", "always")],
    "近战训练": [dice("力量/近身战斗", 2, "格挡")],
    "联络人": [effect("declareContact", uses=USES_SESSION, condition="已认识某个 NPC 且关系积极；GM 可因使谜题失去趣味而否决")],
    "怯懦": [effect("redirectDamage", target="隐秘行动", uses={"count": 1, "period": "combat"}, failureExtraDamage=1, action="free", condition="在战斗中受伤时转由另一名玩家承受；不占用动作")],
    "骗术专精": [dice("操控人心", 2, "谎言或欺骗")],
    "献身": [ignore("any", "manual", "一个检定", "mental", uses=USES_SESSION)],
    "防御专精": [effect("extraDefenseAction", "always", amount=1, period="round", condition="额外动作只能闪避或格挡")],
    "双手武器专精": [effect("extraTarget", spendExtraSuccesses=1, condition="近身战斗使用双武器；攻击本区域另一个敌人；自行分配额外伤害", ambiguity="标题为双手武器专精，正文要求双武器，不能按单件双手武器自动适用。")],
    "炸药专家": [dice("远程战斗", 2, "使用爆炸物进行战斗")],
    "同理心": [ignore("观察")],
    "逃脱大师": [ignore("敏捷", "manual", "通过敏捷检定逃离")],
    "名望": [dice("操控人心", 2, "影响听说过你的人")],
    "疾行": [effect("freeMovement", "always", condition="战斗中在自身区域内移动不占用动作")],
    "神圣象征": [effect("specialAttack", target="启迪", damage=1, condition="通过拥有的宗教物品攻击自在之物")],
    "风驰电掣": [effect("freeDrawWeapon", "always", condition="拔出武器不占用动作")],
    "命大": [effect("criticalDiceOrder", condition="投重创时自行决定十位与个位的骰子")],
    "宠物": [dice("any", 1, "宠物明显有用的检定", uses=USES_SESSION)],
    "拳击手": [effect("damageBonus", "weapon", amount=1, target="unarmed", condition="徒手战斗")],
    "人多壮胆": [dice("恐惧", 2, "至少与另外 2 个玩家角色一起；战斗中必须同一区域")],
    "第六感": [effect("senseMagic", target="调查", spendExtraSuccesses=1, condition="了解区域内自在之物、粗略种类及是否有人使用魔法")],
    "短跑选手": [dice("敏捷", 2, "赶超或追上某人")],
    "主的牧羊人": [dice("启迪", 2, "治疗精神重创")],
    "富有": [effect("resourceBonus", "always", amount=1, repeatable=True, condition="每次购买增加 1 点资源；成长天赋不消费建卡技能预算")],
    "吸血者恨意": [dice("恐惧", 2, "面对各类吸血鬼及其子嗣（衍体）", verified=False)],
    "穿刺者": [dice("近身战斗", 2, "使用木桩", "weapon", weaponName="木桩", verified=False)],
    "猎杀时刻": [effect("restoreCondition", amount=1, condition="得知一个自在之物的藏身地点", verified=False)],
}

# Eligibility was reviewed against each row's effect, not inferred from a
# mentioned skill name. Food waives a Strength check; fine disguises substitute
# Manipulation for Stealth rather than rewarding the original Stealth check.
EQUIPMENT_SKILLS = {
    "撬棍": ["力量"], "开锁器": ["隐秘行动"], "观剧镜": ["警觉"],
    "双筒望远镜": ["警觉"], "狩猎陷阱": ["警觉"], "狩猎装备": ["调查"],
    "火绒盒": ["调查"], "马灯": ["调查", "警觉"], "指南针": ["学习"],
    "放大镜": ["调查"], "照相机": ["学习", "调查"], "书写工具及纸张": ["调查"],
    "计算尺": ["学习"], "简易绷带": ["医学"], "医疗设备": ["医学"],
    "乐器": ["启迪"], "乐器（大师工艺）": ["启迪"], "烹饪锅": ["启迪"],
    "野外厨房": ["启迪"], "粗制干粮": [], "营养食品": [],
    "烈酒": ["启迪"], "好酒": ["启迪", "操控人心"], "化学设备": ["调查"],
    "便携实验工具": ["学习"], "藏书": ["学习"], "老旧的卷轴": ["学习"],
    "水晶球": ["观察"], "地图册": ["调查", "学习"], "瘦马": ["力量"],
    "骏马": ["近身战斗", "力量"], "宠物狗": ["近身战斗"],
    "看门狗": ["警觉", "近身战斗"], "猎犬": ["警觉", "近身战斗", "调查"],
    "化妆品": ["操控人心"], "伪装物": ["操控人心"], "高档伪装物": ["操控人心"],
    "绳子": ["力量"], "绳梯": ["力量", "敏捷"],
    "弱效毒药（剂量3）": [], "强效毒药（剂量2）": [], "烈性毒药（剂量1）": [],
}


def extract_talents(text):
    results = []
    category = None
    for match in re.finditer(r"^(##|###) (.+)$", text, re.M):
        level, name = match.groups()
        if level == "##":
            category = name.removesuffix("天赋") if name.endswith("天赋") else None
            continue
        if category is None:
            continue
        fragment = text[match.end():]
        body = re.split(r'\n(?:<a id=|<!--|>|##|\[上一章)', fragment, maxsplit=1)[0].strip()
        footnotes = re.findall(r"<sup>(\d+)</sup>", body)
        body = re.sub(r"<sup>\d+</sup>", "", body)
        body = re.sub(r"\n+", " ", body).strip().rstrip("—")
        section = re.findall(r'<a id="(section-\d+)"', text[:match.start()])[-1]
        results.append({
            "name": name, "category": category, "description": body, "verified": True,
            "repeatable": name == "富有", "effects": EFFECTS[name],
            "source": source(TALENTS, current_page(text, match.start()), section),
            "warnings": ["译注 1：英文原文精神状态与医学属精准矛盾；官方未勘误，请游戏小组确认解释。"] if footnotes else [],
        })
    return results


def main():
    characters, conflict, talent_text = read(CHARACTERS), read(CONFLICT), read(TALENTS)
    workbook = json.loads(read("web/data/workbook.json"))
    workbook_sheets = {sheet["name"]: sheet["cells"] for sheet in workbook["sheets"]}
    manifest = json.loads(read("docs/rulebook/conversion-manifest.json"))
    archetypes = []
    for name in ("学者", "医生", "猎人", "神秘学家", "军官", "牧师", "私家侦探", "仆人", "流浪者", "作家"):
        match = re.search(rf"^### {name}$", characters, re.M)
        block = re.split(r"\n### ", characters[match.end():], maxsplit=1)[0]
        values = dict(re.findall(r"^- (主属性|主技能|天赋|资源|装备)：(.+)$", block, re.M))
        minimum, maximum = map(int, values["资源"].split("-"))
        equipment = values["装备"]
        choices = [re.split(r"或", group) for group in re.split(r"[、，]", equipment)]
        section = re.findall(r'<a id="(section-\d+)"', characters[:match.start()])[-1]
        archetypes.append({
            "name": name, "verified": True, "resourceMin": minimum, "resourceMax": maximum,
            "mainAttribute": values["主属性"], "mainSkill": values["主技能"],
            "talents": values["天赋"].split("、"), "equipment": equipment, "equipmentChoices": choices,
            "source": source(CHARACTERS, current_page(characters, match.start()), section),
        })
    hunter_source = {
        "document": workbook["source"]["filename"], "sheet": "辅助表", "range": "A12:I12",
        "markdown": "docs/web-card-workbook.md", "pdfPage": None, "printedPage": None,
        "label": "Excel 扩展（基础规则书未核验）",
    }
    helper = workbook_sheets["辅助表"]
    archetypes.append({
        "name": "吸血鬼猎人", "verified": False,
        "resourceMin": helper["B12"]["value"], "resourceMax": helper["C12"]["value"],
        "mainAttribute": helper["G12"]["value"], "mainSkill": helper["H12"]["value"],
        "talents": [workbook_sheets["天赋表"][f"B{row}"]["value"] for row in range(32, 35)],
        "equipment": helper["I12"]["value"],
        "equipmentChoices": [[name] for name in helper["I12"]["value"].rstrip("。").split("、")],
        "source": hunter_source, "warnings": ["此范型及三个天赋不在本地基础规则书中，沿用 Excel 扩展数据。"],
    })
    talents = extract_talents(talent_text)
    for row in range(32, 35):
        name = workbook_sheets["天赋表"][f"B{row}"]["value"]
        talents.append({
            "name": name, "category": "吸血鬼猎人", "verified": False, "repeatable": False,
            "description": workbook_sheets["天赋表"][f"C{row}"]["value"], "effects": EFFECTS[name],
            "warnings": ["基础规则书没有此天赋；数值与说明仅来自原自动卡。"],
            "source": {**hunter_source, "sheet": "天赋表", "range": f"B{row}:C{row}"},
        })
    _, resource_descriptions = table(characters, "资源表")
    _, adjustments = table(conflict, "资源调整值")
    resources = []
    for (number, description), adjustment in zip(resource_descriptions, adjustments, strict=True):
        resources.append({
            "value": int(number), "name": description.split("。")[0], "description": description,
            "exchangeBonus": int(adjustment[2]) if adjustment[2] != "-" else 0,
            "assets": int(adjustment[3]) if adjustment[3] != "-" else 0,
            "exchangeBonusText": adjustment[2], "assetsText": adjustment[3],
            "source": source(CHARACTERS, 26), "adjustmentSource": source(CONFLICT, 77),
        })
    _, armor_rows = table(conflict, "护甲表")
    armor = [{"name": name, "protection": int(protection), "agility": int(agility),
              "availability": int(availability), "source": source(CONFLICT, 78),
              "warnings": ["护甲的保护值用于抵消攻击伤害；不能抵消爆炸或坠落伤害。"]}
             for name, protection, agility, availability in armor_rows]
    weapons = []
    for kind in ("近战武器", "远程武器"):
        _, rows = table(conflict, kind)
        for name, damage, range_text, bonus, availability, skill in rows:
            bounds = list(map(int, range_text.split("-")))
            warnings = []
            if bounds[0] > 0:
                warnings.append("不能攻击同一区域的目标。")
            if "/" in skill:
                warnings.append("矛可按使用方式选择近身战斗或远程战斗检定。")
            weapons.append({
                "name": name, "kind": "unarmed" if name == "拳击或踢击" else "melee" if kind == "近战武器" else "ranged",
                "damage": int(damage), "range": range_text, "rangeMin": bounds[0], "rangeMax": bounds[-1],
                "bonus": int(bonus), "availability": None if availability == "-" else int(availability),
                "skills": skill.split("/"), "skill": skill, "source": source(CONFLICT, 81), "warnings": warnings,
            })
    equipment = []
    for occurrence, page in ((0, 78), (1, 79)):
        _, rows = table(conflict, "装备表", occurrence)
        for name, bonus, availability, description in rows:
            equipment.append({
                "name": name, "bonus": int(bonus) if bonus != "-" else 0, "availability": int(availability),
                "effect": description,
                "skills": EQUIPMENT_SKILLS[name],
                "activation": "manual", "source": source(CONFLICT, page),
            })
    _, covers = table(conflict, "掩体")
    _, services = table(conflict, "服务与设施")
    result = {
        "schemaVersion": 1,
        "source": {"path": manifest["source"], "sha256": manifest["sha256"], "label": "北欧奇谭基础规则书（本地中文版本）"},
        "archetypes": archetypes, "talents": talents, "resources": resources, "armor": armor,
        "weapons": weapons, "equipment": equipment,
        "talentAliases": {"人多胆壮": "人多壮胆"},
        "skillAliases": {"蛮力": "力量"},
        "skills": [
            {"name": skill, "attribute": attribute,
             "conditionType": "physical" if attribute in ("体能", "精准") else "mental",
             "source": source(CHARACTERS, 25)}
            for attribute, names in (("体能", ["敏捷", "近身战斗", "力量"]), ("精准", ["医学", "远程战斗", "隐秘行动"]), ("逻辑", ["调查", "学习", "警觉"]), ("共情", ["启迪", "操控人心", "观察"]))
            for skill in names
        ],
        "cover": [{"name": name, "protection": int(protection), "source": source(CONFLICT, 78)} for name, protection in covers],
        "services": [{"name": name, "availability": int(availability), "effect": description, "source": source(CONFLICT, 80)} for name, availability, description in services],
        "ageGroups": [
            {"name": "青年", "min": 17, "max": 25, "attributePoints": 15, "skillPoints": 10, "source": source(CHARACTERS, 22)},
            {"name": "中年", "min": 26, "max": 50, "attributePoints": 14, "skillPoints": 12, "source": source(CHARACTERS, 22)},
            {"name": "老年", "min": 51, "max": None, "attributePoints": 13, "skillPoints": 14, "source": source(CHARACTERS, 22)},
        ],
        "rules": {
            "creation": {"attributeMin": 2, "attributeMax": 4, "primaryAttributeMax": 5, "skillMin": 0, "skillMax": 2, "primarySkillMax": 3, "initialTalentCount": 1, "initialTalentFromArchetype": True, "resourcePointCost": 1, "resourceIncreaseCostsSkillBudget": True, "source": source(CHARACTERS, 24), "skillSource": source(CHARACTERS, 25)},
            "growth": {"xpCost": 5, "skillIncrease": 1, "skillMax": 5, "canImproveAttributes": False, "anyTalentAllowed": True, "repeatableTalents": ["富有"], "description": "每 5 XP 可提升一项技能一级或购买一个天赋；基础规则未提供属性提升。", "source": source(CHARACTERS, 29)},
            "dice": {"formula": "属性 + 技能 + 装备 + 天赋 + 优势 + 其它调整 - 相关状态", "minimum": 1, "successFace": 6, "talentsStack": True, "source": source(SKILLS, 42)},
            "conditions": {"physical": ["力竭", "伤痕累累", "创伤"], "mental": ["愤怒", "恐惧", "绝望"], "physicalAttributes": ["体能", "精准"], "mentalAttributes": ["逻辑", "共情"], "penaltyPerCondition": 1, "brokenAt": 4, "brokenIsActionBlock": True, "brokenIsNotFourthOrdinaryPenalty": True, "source": source(SKILLS, 44)},
            "fear": {"attributes": ["逻辑", "共情"], "maxCompanionBonus": 3, "companionsMustShareZoneInCombat": True, "brokenOrFrightenedCompanionsDoNotHelp": True, "penalty": "精神状态", "source": source(CONFLICT, 72)},
            "advantage": {"bonus": 2, "usesPerSession": 1, "gainedPerMystery": 1, "expireAtMysteryEnd": True, "nextMysteryRequiresDifferentSkill": True, "declareBeforeRollOrPush": True, "source": source(SKILLS, 46)},
            "push": {"maxPerAction": 1, "rerollNonSuccessesOnly": True, "keepSixes": True, "newConditionAppliesAfterRoll": True, "physicalForAttributes": ["体能", "精准"], "mentalForAttributes": ["逻辑", "共情"], "source": source(SKILLS, 43)},
            "resources": {"exchangeSkill": "操控人心", "assetsCannotBeUsedInOpposedChecks": True, "assetsSpentUntilNextMystery": True, "rollSuccessesCanAddAssets": True, "source": source(CONFLICT, 77)},
            "armor": {"agilityPenaltyWhenEquipped": True, "eachSuccessReducesDamage": 1, "doesNotProtectAgainst": ["爆炸", "坠落"], "source": source(CONFLICT, 77)},
            "memento": {"restoresConditions": 1, "requiresGMApproval": True, "repairXpCost": 1, "replaceAfterFullMysteryWithoutMemento": True, "source": source(CHARACTERS, 26)},
            "xpQuestions": {"pointsPerYes": 1, "questions": re.findall(r"^\d\. (.+)$", characters[characters.index("#### 经验获取问题"):characters.index("#### 人生轨迹")], re.M), "source": source(CHARACTERS, 29)},
        },
        "warnings": [
            {"code": "priest-resource-cap", "message": "牧师建卡资源上限据基础规则书修正为 6；Excel 为 5。", "source": source(CHARACTERS, 35)},
            {"code": "strength-label", "message": "仆人的主技能使用基础规则书术语力量；Excel 辅助表写为蛮力。", "source": source(CHARACTERS, 37)},
            {"code": "starting-equipment", "message": "初始装备按规则书原文提供；学者和流浪者的液体修正为烈酒，并统一开锁器、火绒盒等术语。", "source": source(CHARACTERS, 30)},
            {"code": "emergency-medicine-ambiguity", "message": "应急医学存在原文精神状态与医学所属属性矛盾；本地译注明确说明官方没有勘误，不把译者建议当成官方勘误。", "source": source(TALENTS, 54)},
            {"code": "dual-weapon-title", "message": "双手武器专精的正文写使用双武器；应用时按正文条件，由玩家确认。", "source": source(TALENTS, 59)},
            {"code": "vampire-hunter-extension", "message": "吸血鬼猎人范型及三个天赋沿用 Excel 扩展；未被本地基础规则书核验。", "source": hunter_source},
            {"code": "talent-activation", "message": "天赋的情境奖励、替代技能、次数限制和 GM 裁定均需在检定时确认；不能永久增加技能值或自动恢复状态。", "source": source(TALENTS, 53)},
        ],
        "effectActivation": {
            "always": "拥有天赋且当前对应检定/规则适用时自动生效；不改写基础技能值。",
            "weapon": "仅选择并使用满足条件的武器/徒手攻击时生效。",
            "manual": "需要玩家选择适用情境、动作或确认次数与 GM 裁定。",
        },
    }
    assert len([a for a in archetypes if a["verified"]]) == 10
    assert len(talents) == 57
    assert len(resources) == 8 and len(armor) == 3 and len(weapons) == 23
    assert all(t["description"] and t["source"] for t in talents)
    destination = ROOT / "web/data/rules.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: len(result[key]) for key in ("archetypes", "talents", "resources", "armor", "weapons", "equipment", "cover", "services")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
