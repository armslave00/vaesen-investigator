import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { RulesEngine } from '../web/rules-engine.js';
import { snapshotCharacter, createCharacterPdf } from '../web/pdf-card.js';

const workbook = JSON.parse(readFileSync(new URL('../web/data/workbook.json', import.meta.url), 'utf8'));
const rules = JSON.parse(readFileSync(new URL('../web/data/rules.json', import.meta.url), 'utf8'));
const fontBytes = readFileSync(new URL('../web/fonts/NotoSansSC-Regular.ttf', import.meta.url));
const card = '角色卡';
const creation = {
  A2: '林间调查员', A4: '阿尔瓦玩家', D15: '学者', D16: 35, C18: 2,
  A25: '知识是可靠的', D20: 3, I20: 3, N20: 5, S20: 3,
  D21: 0, D22: 2, D23: 0, I21: 1, I22: 0, I23: 1,
  N21: 2, N22: 3, N23: 1, S21: 0, S22: 0, S23: 0,
};

function investigator() {
  const values = Object.fromEntries(Object.entries(creation).map(([key, value]) => [`${card}!${key}`, value]));
  const engine = new RulesEngine(workbook, rules, values);
  assert.deepEqual(engine.derived().validation, []);
  engine.completeCreation();
  return engine;
}

const gear = [
  ['医疗设备', '医药箱第一号说明', 2], ['书写工具', '羽毛笔第二号说明', 1],
  ['粗制干粮', '免检定第三号说明', 0], ['绳梯', '绳结第四号说明', 3],
  ['特制罗盘', '指针第五号说明', 0], ['铜质怀表', '表盘第六号说明', 0],
];
const weapons = [
  ['剑或军刀', 2, '0', 2, '近身战斗'], ['手枪或左轮', 2, '0-1', 2, '远程战斗'],
  ['矛', 1, '0-1', 1, '近身战斗 / 远程战斗'], ['自制练习刀', 0, '0', 0, '力量'],
];

function completeArchive() {
  const engine = investigator();
  const extras = {
    I2: '寻找失落的森林传说', I5: '童年看见湖中幽影', I8: '秘密藏有银质符文',
    A5: '深绿色外套与古老眼镜', AE2: '背景第一段\n背景第二段', AE19: '记录第一行\n记录第二行',
    E25: '手写说明第一行\n手写说明第二行：保留原文。',
    Y10: '●', Y11: '○', Y12: null, Y13: '○', AD10: '○', AD11: '●', AD12: '', AD13: '○',
    K11: '盟友甲', I12: '共享古籍秘密', K13: '盟友乙', I14: '旧日远征同伴',
    K15: '盟友丙', I16: '有待偿还的恩情', K17: '盟友丁', I18: '共同守护镇民',
    U2: '母亲留下的银钥匙', U3: '旅途旧地图', U4: '一枚雕刻木珠',
    U6: '有利的地形', U7: '事先准备的情报', U8: '可靠的藏身处',
    U15: '对亡灵的洞察', U16: '不愿接近黑湖', U17: '梦中听见钟声',
    O30: '轻甲', AA30: 2, AC30: -1, W18: '○', X18: '●', Y18: '●',
  };
  gear.forEach(([name, description, bonus], index) => {
    extras[`A${30 + index}`] = name; extras[`E${30 + index}`] = description; extras[`M${30 + index}`] = bonus;
  });
  weapons.forEach(([name, damage, range, bonus, skill], index) => {
    for (const [column, value] of [['O', name], ['V', damage], ['X', range], ['Z', bonus], ['AB', skill]]) extras[`${column}${32 + index}`] = value;
  });
  for (const [cell, value] of Object.entries(extras)) engine.set(card, cell, value);
  engine.adjustXP(20, '前期调查经验');
  engine.buyTalent('勇敢');
  engine.buyTalent('军医');
  engine.adjustAssets(-3, '购买六项装备');
  return engine;
}

// Inspect the bytes independently of the exporter. pdf-lib emits text as hex
// CID strings; their font's ToUnicode map lets us verify actual Chinese text
// without requiring an external Python process or trusting snapshot strings.
const decodeStream = (stream) => new TextDecoder().decode(decodePDFRawStream(stream).decode());
function utf16(hex) {
  const bytes = Buffer.from(hex, 'hex');
  assert.equal(bytes.length % 2, 0, 'ToUnicode destination must be UTF-16BE');
  let value = '';
  for (let offset = 0; offset < bytes.length; offset += 2) value += String.fromCharCode(bytes.readUInt16BE(offset));
  return value;
}
function cmap(stream) {
  const mappings = new Map();
  const source = decodeStream(stream);
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([\dA-Fa-f]+)>\s*<([\dA-Fa-f]+)>/g)) mappings.set(Number.parseInt(pair[1], 16), utf16(pair[2]));
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([\dA-Fa-f]+)>\s*<([\dA-Fa-f]+)>\s*<([\dA-Fa-f]+)>/g)) {
      const start = Number.parseInt(range[1], 16), end = Number.parseInt(range[2], 16), base = Number.parseInt(range[3], 16);
      for (let code = start; code <= end; code++) mappings.set(code, utf16((base + code - start).toString(16).padStart(range[3].length, '0')));
    }
  }
  assert.ok(mappings.size, 'embedded font has an extractable Unicode mapping');
  return mappings;
}

async function inspectPdf(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const runs = [], unicode = new Set();
  let embeddedFonts = 0;
  for (const [pageIndex, page] of pdf.getPages().entries()) {
    const resources = page.node.Resources().lookup(PDFName.of('Font'), PDFDict);
    const fonts = new Map();
    for (const [name, reference] of resources.entries()) {
      const dictionary = pdf.context.lookup(reference, PDFDict);
      const toUnicode = dictionary.lookupMaybe(PDFName.of('ToUnicode'), PDFRawStream);
      const map = toUnicode ? cmap(toUnicode) : null;
      const wide = dictionary.get(PDFName.of('Subtype')).toString() === '/Type0';
      const description = { map, width: wide ? 4 : 2, advances: null, defaultAdvance: 1000 };
      fonts.set(name.decodeText(), description);
      if (map) for (const character of map.values()) unicode.add(character);
      const descendants = dictionary.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
      if (descendants) {
        const descendant = pdf.context.lookup(descendants.get(0), PDFDict);
        description.defaultAdvance = descendant.lookupMaybe(PDFName.of('DW'), PDFNumber)?.asNumber() ?? 1000;
        const widthList = descendant.lookupMaybe(PDFName.of('W'), PDFArray);
        if (widthList) {
          description.advances = new Map();
          for (let index = 0; index < widthList.size();) {
            const start = widthList.lookup(index++, PDFNumber).asNumber();
            const next = widthList.lookup(index++);
            if (next instanceof PDFArray) {
              for (let offset = 0; offset < next.size(); offset++) description.advances.set(start + offset, next.lookup(offset, PDFNumber).asNumber());
            } else {
              const end = next.asNumber(), advance = widthList.lookup(index++, PDFNumber).asNumber();
              for (let code = start; code <= end; code++) description.advances.set(code, advance);
            }
          }
        }
        const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
        const fontFile = descriptor.lookupMaybe(PDFName.of('FontFile2'), PDFRawStream) ?? descriptor.lookupMaybe(PDFName.of('FontFile3'), PDFRawStream);
        if (fontFile && decodePDFRawStream(fontFile).decode().length) embeddedFonts++;
      }
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref, PDFRawStream)) : [contents];
    let currentFont, size = 0, x = 0, y = 0, leading = 0;
    const read = (hex) => {
      const descriptor = fonts.get(currentFont);
      assert.ok(descriptor, 'text uses a declared font');
      assert.equal(hex.length % descriptor.width, 0, 'glyph string has complete character codes');
      let text = '', advance = 0;
      for (let offset = 0; offset < hex.length; offset += descriptor.width) {
        const code = Number.parseInt(hex.slice(offset, offset + descriptor.width), 16);
        advance += descriptor.advances?.get(code) ?? descriptor.defaultAdvance;
        if (descriptor.map) {
          assert.ok(descriptor.map.has(code), `font maps CID ${code} to text`);
          text += descriptor.map.get(code);
        } else text += String.fromCharCode(code);
      }
      runs.push({ text, pageIndex, x, y, size, width: descriptor.advances ? advance * size / 1000 : null });
    };
    for (const stream of streams) {
      const token = /\/(?<font>[A-Za-z0-9_.-]+)\s+(?<size>[-\d.]+)\s+Tf|(?<matrix>(?:[-\d.]+\s+){5}[-\d.]+)\s+Tm|(?<leading>[-\d.]+)\s+TL|(?<nextline>T\*)|<(?<hex>[\dA-Fa-f]+)>\s*Tj|\[(?<array>[\s\S]*?)\]\s*TJ/g;
      for (const match of decodeStream(stream).matchAll(token)) {
        const g = match.groups;
        if (g.font) { currentFont = g.font; size = Number(g.size); }
        else if (g.matrix) [, , , , x, y] = g.matrix.trim().split(/\s+/).map(Number);
        else if (g.leading) leading = Number(g.leading);
        else if (g.nextline) y -= leading;
        else if (g.hex) read(g.hex);
        else if (g.array) for (const item of g.array.matchAll(/<([\dA-Fa-f]+)>/g)) read(item[1]);
      }
    }
  }
  assert.ok(runs.length, 'generated PDF contains a searchable text layer');
  return { pdf, runs, unicode, embeddedFonts, text: runs.map((item) => item.text).join('\n') };
}
const compact = (value) => value.replace(/\s+/g, '');
const hasText = (result, value) => assert.ok(compact(result.text).includes(compact(value)), `PDF contains ${value.slice(0, 60)}`);

test('snapshot preserves independent rule totals, all cells, conditions and six equipment/four weapon slots', () => {
  const engine = completeArchive();
  const s = snapshotCharacter(engine, rules);
  assert.deepEqual([s.name, s.player, s.archetype, s.age], ['林间调查员', '阿尔瓦玩家', '学者', 35]);
  assert.match(s.ageGroup, /中年/);
  assert.deepEqual([s.derived.resource, s.derived.lifestyle, s.derived.exchangeBonus, s.derived.standardAssets, s.derived.currentAssets, s.derived.xp, s.derived.pendingXP], [6, '小康', 2, 5, 2, 10, 3]);
  assert.deepEqual([s.derived.attributeRemaining, s.derived.skillRemaining], [0, 0]);
  assert.deepEqual(s.attributes.map((a) => [a.name, a.value, a.skills.map((i) => i.value)]), [
    ['体能', 3, [0, 2, 0]], ['精准', 3, [1, 0, 1]], ['逻辑', 5, [2, 3, 1]], ['共情', 3, [0, 0, 0]],
  ]);
  // The existing engine input API normalizes an entered empty string to null.
  assert.deepEqual(s.conditions.map((group) => group.items.map((i) => i.value)), [['●', '○', null, '○'], ['○', '●', null, '○']]);
  assert.deepEqual(s.equipment.map((i) => [i.name, i.description, i.bonus]), gear);
  assert.deepEqual(s.weapons.map((i) => [i.name, i.damage, i.range, i.bonus, i.skill]), weapons);
  assert.deepEqual(s.armor, { name: '轻甲', protection: 2, agility: -1 });
  assert.equal(s.talents[0].description, '手写说明第一行\n手写说明第二行：保留原文。');
  assert.deepEqual(s.talents.filter((t) => t.source === '经验购买').map((t) => t.name), ['勇敢', '军医']);
  assert.deepEqual(s.progress.extraTalents, ['勇敢', '军医']);
  assert.equal(s.progress.creation.validated, true);
  assert.equal(s.progress.creation.kind, 'created');
  assert.equal(s.progress.ledger.length, 4);
  assert.equal(Object.keys(s.values).length, 110);
  for (const { sheet, cell } of workbook.controls) assert.deepEqual(s.values[`${sheet}!${cell}`], engine.get(sheet, cell), `${cell} source field`);
  assert.equal(s.values['角色卡!M32'], 0);
  assert.equal(s.values['角色卡!Y12'], null);
  assert.equal(s.values['角色卡!AD12'], null);
});

test('snapshot is isolated from later character, XP, asset and creation-record edits', () => {
  const engine = completeArchive();
  const s = snapshotCharacter(engine, rules), before = structuredClone(s);
  engine.set(card, 'A2', '后来的姓名');
  engine.set(card, 'E25', '后来的说明');
  engine.set(card, 'M32', 4);
  engine.adjustXP(5, '后续调查经验');
  engine.buyTalent('富有');
  engine.progress.creation.attributes.D20 = 4;
  assert.deepEqual(s, before);
  s.progress.extraTalents.push('专注');
  assert.deepEqual(engine.progress.extraTalents, ['勇敢', '军医', '富有']);
});

test('repeatable wealthy growth preserves both purchases and spent assets in the exported snapshot', () => {
  const engine = investigator();
  engine.adjustAssets(-3, '已花资产');
  engine.adjustXP(15, '已有经验');
  engine.buyTalent('富有'); engine.buyTalent('富有');
  const s = snapshotCharacter(engine, rules);
  assert.deepEqual([s.derived.resource, s.derived.standardAssets, s.derived.currentAssets, s.derived.exchangeBonus, s.derived.xp], [8, 12, 2, 5, 5]);
  assert.equal(s.talents.filter((t) => t.name === '富有').length, 2);
  assert.deepEqual(s.progress.extraTalents, ['富有', '富有']);
  assert.deepEqual([s.progress.creation.attributeBudget, s.progress.creation.skillBudget, s.progress.creation.resourcePurchased], [14, 12, 2]);
});

test('ordinary PDF embeds Chinese, uses the official landscape dimensions and includes a full explanation appendix', async () => {
  const s = snapshotCharacter(investigator(), rules);
  const generated = await createCharacterPdf(s, fontBytes);
  assert.ok(generated.bytes instanceof Uint8Array);
  const inspected = await inspectPdf(generated.bytes);
  assert.equal(generated.pageCount, inspected.pdf.getPageCount());
  assert.ok(generated.pageCount >= 2 && generated.pageCount <= 4, 'one main card plus compact ordinary explanation pages');
  assert.deepEqual(generated.warnings, []);
  assert.match(inspected.pdf.getTitle(), /林间调查员/);
  assert.equal(inspected.pdf.getAuthor(), '阿尔瓦玩家');
  assert.ok(inspected.pdf.getCreator());
  assert.ok(inspected.pdf.getProducer());
  assert.ok(inspected.embeddedFonts > 0, 'Chinese font program is actually embedded');
  for (const char of ['学', '者', '调', '查', '员', '知', '识']) assert.ok(inspected.unicode.has(char), `embedded Unicode text maps ${char}`);
  for (const page of inspected.pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 790.866) < 0.001);
    assert.ok(Math.abs(page.getHeight() - 612.283) < 0.001);
  }
  hasText(inspected, '知识是可靠的');
  hasText(inspected, '资源 6');
  hasText(inspected, '小康');
  hasText(inspected, '当前资产 5');
  hasText(inspected, '初始技能预算 12');
  hasText(inspected, '建卡记录');
  hasText(inspected, '本场经验回答');
  for (const run of inspected.runs) {
    assert.ok(run.x >= 18 && run.x < 790.866, 'text origin lies inside printable page horizontally');
    assert.ok(run.y >= 10 && run.y < 612.283, 'text origin lies inside printable page vertically');
    if (run.width !== null) assert.ok(run.x + run.width <= 790.866 - 18, 'embedded text extent lies inside the right page border');
  }
});

test('PDF writes real growth balances, hand-written multiline talent text, every gear slot and dual weapon skills', async () => {
  const engine = completeArchive();
  const generated = await createCharacterPdf(snapshotCharacter(engine, rules), fontBytes);
  const inspected = await inspectPdf(generated.bytes);
  assert.deepEqual(generated.warnings, []);
  for (const value of ['经验 10 XP', '待结算 3 XP', '当前资产 2', '标准资产 5', '交易奖励 2', '勇敢', '军医', '手写说明第一行', '手写说明第二行：保留原文。', '背景第一段', '背景第二段', '记录第一行', '记录第二行', '购买六项装备', '前期调查经验', '建卡记录']) hasText(inspected, value);
  for (const [name, description] of gear) { hasText(inspected, name); hasText(inspected, description); }
  for (const [name, , , , skill] of weapons) { hasText(inspected, name); hasText(inspected, skill); }
  hasText(inspected, '自制练习刀 / 0 / 0 / 0');
  hasText(inspected, '近身战斗 / 远程战斗');
  hasText(inspected, '轻甲 / 2 / -1');
  for (const value of ['母亲留下的银钥匙', '旅途旧地图', '一枚雕刻木珠', '有利的地形', '事先准备的情报', '可靠的藏身处', '对亡灵的洞察', '不愿接近黑湖', '梦中听见钟声', '盟友甲', '盟友乙', '盟友丙', '盟友丁']) hasText(inspected, value);
});

test('long Chinese text and original newlines paginate with all independently numbered lines and the final marker intact', async () => {
  const engine = investigator();
  const lines = Array.from({ length: 120 }, (_, index) => `分页哨兵${String(index + 1).padStart(3, '0')}：古老森林传说。`);
  engine.set(card, 'I2', lines.join('\n'));
  engine.set(card, 'AE19', '长文开头锚点' + '北欧神话'.repeat(700) + '长文中段锚点' + '古老传说'.repeat(400) + '长文末尾锚点');
  const s = snapshotCharacter(engine, rules);
  assert.equal(s.motivation, lines.join('\n'));
  const generated = await createCharacterPdf(s, fontBytes);
  const inspected = await inspectPdf(generated.bytes);
  assert.ok(generated.pageCount >= 6 && generated.pageCount <= 20, 'long content produces bounded continuation pages');
  assert.equal(generated.pageCount, inspected.pdf.getPageCount());
  assert.deepEqual(generated.warnings, []);
  for (const line of lines) hasText(inspected, line);
  for (const marker of ['长文开头锚点', '长文中段锚点', '长文末尾锚点', '完整内容见续页']) hasText(inspected, marker);
});

test('long identity cannot append an endless sequence of continuation entries and preserves the full identity once', { timeout: 60000 }, async () => {
  const engine = investigator();
  const tokens = Array.from({ length: 200 }, (_, index) => `名${String(index + 1).padStart(3, '0')}`);
  engine.set(card, 'A2', tokens.join(''));
  const generated = await createCharacterPdf(snapshotCharacter(engine, rules), fontBytes);
  assert.ok(generated.pageCount >= 2 && generated.pageCount <= 10, 'identity overflow remains bounded');
  const inspected = await inspectPdf(generated.bytes);
  for (const token of tokens) hasText(inspected, token);
  assert.equal(compact(inspected.text).split('调查员/玩家').length - 1, 2, 'one main identity label and one full continuation');
});

test('unsupported Unicode is explicitly represented and reported instead of disappearing', async () => {
  const engine = investigator();
  engine.set(card, 'AE19', '未知字符' + String.fromCodePoint(0x10ffff) + '保留标记');
  const generated = await createCharacterPdf(snapshotCharacter(engine, rules), fontBytes);
  const inspected = await inspectPdf(generated.bytes);
  assert.equal(generated.warnings.length, 1);
  assert.match(generated.warnings[0], /U\+10FFFF/);
  hasText(inspected, '未知字符[U+10FFFF]保留标记');
});

test('long weapon and hand-written talent names keep continuation headings within the page while preserving complete names', async () => {
  const engine = completeArchive();
  const talentName = '长天赋名' + '森林古神'.repeat(65) + '天赋末尾标记';
  const weaponName = '长武器名' + '古老银刃'.repeat(65) + '武器末尾标记';
  engine.set(card, 'A26', talentName); engine.set(card, 'E26', '第二项天赋完整说明');
  engine.set(card, 'O35', weaponName);
  const generated = await createCharacterPdf(snapshotCharacter(engine, rules), fontBytes);
  const inspected = await inspectPdf(generated.bytes);
  assert.ok(generated.pageCount <= 12, 'long headings remain a bounded continuation');
  for (const marker of ['长天赋名', '天赋末尾标记', '第二项天赋完整说明', '长武器名', '武器末尾标记']) hasText(inspected, marker);
  for (const run of inspected.runs) {
    if (run.width !== null) assert.ok(run.x + run.width <= 790.866 - 18, `page ${run.pageIndex + 1} text remains within border: ${run.text.slice(0, 30)}`);
  }
});
