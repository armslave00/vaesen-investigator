import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { ATTRIBUTES, XP_CELLS } from './rules-engine.js';

const CARD = '角色卡';
export const PAGE_SIZE = [790.866, 612.283];
const string = value => value === null || value === undefined ? '' : String(value);
const display = value => string(value) === '' ? '—' : string(value);

// Capture before loading fonts: one export always describes one moment in time.
export function snapshotCharacter(engine, rules) {
  const get = cell => engine.get(CARD, cell);
  const derived = structuredClone(engine.derived());
  const now = new Date();
  return {
    values: Object.fromEntries(engine.workbook.controls.map(({ sheet, cell }) => [`${sheet}!${cell}`, engine.get(sheet, cell)])),
    name: get('A2'), player: get('A4'), archetype: get('D15'), age: get('D16'), ageGroup: get('F16'),
    motivation: get('I2'), trauma: get('I5'), darkSecret: get('I8'), appearance: get('A5'),
    background: get('AE2'), notes: get('AE19'),
    attributes: ATTRIBUTES.map(item => ({ name: item.name, value: get(item.cell), skills: item.skills.map(skill => ({ name: skill.name, value: get(skill.cell) })) })),
    conditions: [
      { name: '物理状态', items: ['力竭', '伤痕累累', '创伤', '崩溃'].map((name, index) => ({ name, value: get(`Y${10 + index}`) })) },
      { name: '精神状态', items: ['愤怒', '恐惧', '绝望', '崩溃'].map((name, index) => ({ name, value: get(`AD${10 + index}`) })) },
    ],
    relationships: [['K11', 'I12'], ['K13', 'I14'], ['K15', 'I16'], ['K17', 'I18']].map(([name, text]) => ({ name: get(name), text: get(text) })),
    talents: [25, 26, 27, 28].map(row => ({ name: get(`A${row}`), description: get(`E${row}`), source: '角色卡' })).concat(engine.progress.extraTalents.map(name => ({ name, description: rules.talents.find(item => item.name === name)?.description ?? '', source: '经验购买' }))),
    equipment: [30, 31, 32, 33, 34, 35].map(row => ({ name: get(`A${row}`), description: get(`E${row}`), bonus: get(`M${row}`) })),
    weapons: [32, 33, 34, 35].map(row => ({ name: get(`O${row}`), damage: get(`V${row}`), range: get(`X${row}`), bonus: get(`Z${row}`), skill: get(`AB${row}`) })),
    armor: { name: get('O30'), protection: get('AA30'), agility: get('AC30') },
    mementos: [2, 3, 4].map(row => get(`U${row}`)), advantages: [6, 7, 8].map(row => get(`U${row}`)), insights: [15, 16, 17].map(row => get(`U${row}`)),
    xpAnswers: XP_CELLS.map((cell, index) => ({ value: get(cell), question: rules.rules.xpQuestions.questions[index] })),
    derived, progress: structuredClone(engine.progress), exportedAt: now.toISOString(),
    exportedDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  };
}

export async function createCharacterPdf(snapshot, fontBytes) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const titleFont = await pdf.embedFont(StandardFonts.TimesRomanBold);
  pdf.setTitle(`北欧奇谭 · ${display(snapshot.name)} · 调查员角色卡`);
  pdf.setAuthor(string(snapshot.player));
  pdf.setCreator('Vaesen Investigator Archive');
  pdf.setProducer('Vaesen Investigator Archive / pdf-lib');
  const [width, height] = PAGE_SIZE;
  const ink = rgb(0.10, 0.20, 0.18), copper = rgb(0.49, 0.34, 0.21), muted = rgb(0.35, 0.39, 0.36);
  const paper = rgb(0.99, 0.985, 0.97), lineColor = rgb(0.73, 0.74, 0.68), wash = rgb(0.94, 0.945, 0.91);
  const missing = new Set(), coverage = new Set(font.getCharacterSet());
  const safe = value => Array.from(string(value).replaceAll('\r\n', '\n').replaceAll('\r', '\n')).map(char => {
    if (char === '\n') return char;
    if (char === '\t') return '    ';
    const code = char.codePointAt(0);
    if (coverage.has(code)) return char;
    missing.add(code);
    return `[U+${code.toString(16).toUpperCase()}]`;
  }).join('');
  const wrap = (value, size, available) => {
    const lines = [];
    for (const paragraph of safe(value).split('\n')) {
      let current = '', currentWidth = 0;
      for (const char of paragraph) {
        const charWidth = font.widthOfTextAtSize(char, size);
        if (current && currentWidth + charWidth > available) { lines.push(current); current = ''; currentWidth = 0; }
        current += char; currentWidth += charWidth;
      }
      lines.push(current);
    }
    return lines;
  };
  let page;
  const text = (value, x, top, size = 9, color = ink) => page.drawText(safe(value), { x, y: height - top - size, size, font, color });
  const rule = (x, top, w, color = lineColor) => page.drawLine({ start: { x, y: height - top }, end: { x: x + w, y: height - top }, thickness: 0.45, color });
  const newPage = () => {
    page = pdf.addPage(PAGE_SIZE);
    page.drawRectangle({ x: 0, y: 0, width, height, color: paper });
    page.drawRectangle({ x: 18, y: 18, width: width - 36, height: height - 36, borderColor: copper, borderWidth: 0.65 });
    return page;
  };
  const detail = [];
  const addDetail = (title, value) => { if (string(value) !== '') detail.push({ title, value: string(value) }); };
  // Every overlong field receives an explicit continuation; never silently cut data.
  const fitted = (value, x, top, w, h, title, preferred = 9, recordOverflow = true, color = ink) => {
    let size = preferred, lines;
    do { lines = wrap(display(value), size, w); if (lines.length * size * 1.35 <= h || size <= 8) break; size -= 0.5; } while (true);
    const capacity = Math.max(1, Math.floor(h / (size * 1.35)));
    if (lines.length > capacity) {
      if (recordOverflow) addDetail(title, value);
      lines = lines.slice(0, capacity);
      lines[capacity - 1] = w < 95 ? '…' : '… 完整内容见续页';
    }
    lines.forEach((value, index) => text(value, x, top + index * size * 1.35, size, color));
  };
  const box = (title, value, x, top, w, h, size = 9) => {
    page.drawRectangle({ x, y: height - top - h, width: w, height: h, borderColor: lineColor, borderWidth: 0.45 });
    page.drawRectangle({ x, y: height - top - 17, width: w, height: 17, color: wash });
    fitted(title, x + 6, top + 3, w - 12, 13, `${title}标题`, 8.5, true, copper);
    fitted(value, x + 6, top + 21, w - 12, h - 25, title, size);
  };
  newPage();
  const left = 28, lw = 225, right = 267, rw = width - 295, half = (rw - 12) / 2, far = right + half + 12;
  box('调查员 / 玩家', `${display(snapshot.name)}\n玩家：${display(snapshot.player)}`, left, 30, lw, 56, 12);
  box('年龄 / 年龄阶段 / 范型', `${display(snapshot.age)} · ${display(snapshot.ageGroup)} · ${display(snapshot.archetype)}`, left, 98, lw, 33, 8.5);
  box('动机', snapshot.motivation, left, 143, lw, 44);
  box('创伤', snapshot.trauma, left, 199, lw, 44);
  box('黑暗秘密', snapshot.darkSecret, left, 255, lw, 44);
  box('人际关系', snapshot.relationships.map((item, index) => `${index + 1}. ${display(item.name)}：${display(item.text)}`).join('\n'), left, 311, lw, 94);
  const d = snapshot.derived;
  box('资源与资产', `资源 ${display(d.resource)} · ${d.lifestyle || '生活标准未收录'} · 交易奖励 ${display(d.exchangeBonus)}\n当前资产 ${display(d.currentAssets)} · 标准资产 ${display(d.standardAssets)}\n基础 ${display(d.resourceBase)} / 初始投资 ${display(d.resourcePurchased)} / 富有 ${d.wealthyCount}`, left, 417, lw, 60, 8.5);
  box('装备 / 奖励骰', snapshot.equipment.map((item, index) => `${index + 1}. ${display(item.name)}  /  ${display(item.bonus)}`).join('\n'), left, 489, lw, 90, 8);
  page.drawText('VAESEN', { x: right, y: height - 57, size: 27, font: titleFont, color: ink });
  text('北欧奇谭 · 调查员角色卡', right, 62, 9, copper);
  box(`经验 ${d.xp} XP · 第 ${snapshot.progress.session.id} 场`, `本场 ${d.sessionSettled ? '已结算' : `待结算 ${d.pendingXP} XP`}\n${snapshot.xpAnswers.map((item, index) => `${index + 1}${display(item.value)}`).join('  ')}`, far, 30, half, 49, 8.5);
  const col = rw / 4;
  snapshot.attributes.forEach((attribute, index) => {
    const x = right + col * index;
    box(attribute.name, display(attribute.value), x, 98, col - 5, 36, 12);
    attribute.skills.forEach((skill, row) => {
      text(skill.name, x + 4, 149 + row * 24, 9);
      fitted(display(skill.value), x + col - 25, 149 + row * 24, 20, 14, `${skill.name}等级`, 10);
      rule(x + 4, 166 + row * 24, col - 13);
    });
  });
  snapshot.conditions.forEach((group, index) => box(group.name, group.items.map(item => `${display(item.value)}${item.name}`).join('  '), right + index * (half + 12), 230, half, 37, 8));
  const talentNames = snapshot.talents.filter(item => string(item.name) !== '').map(item => `${display(item.name)}${item.source === '经验购买' ? '（成长）' : ''}`).join('\n');
  box('天赋', talentNames, right, 279, half, 79);
  box('洞察与缺陷', snapshot.insights.map(display).join('\n'), far, 279, half, 79);
  box('纪念物', snapshot.mementos.map(display).join('\n'), right, 365, half, 61, 8);
  box('优势', snapshot.advantages.map(display).join('\n'), far, 365, half, 61, 8);
  box('装备说明', snapshot.equipment.map((item, index) => `${index + 1}. ${display(item.description)}`).join('\n'), right, 435, half, 144, 8.5);
  box('武器 / 伤害 / 范围 / 奖励骰', snapshot.weapons.map((item, index) => `${index + 1}. ${display(item.name)} / ${display(item.damage)} / ${display(item.range)} / ${display(item.bonus)}`).join('\n'), far, 435, half, 94, 8.5);
  box('护甲 / 防护骰 / 敏捷调整', `${display(snapshot.armor.name)} / ${display(snapshot.armor.protection)} / ${display(snapshot.armor.agility)}`, far, 541, half, 38, 8.5);

  addDetail('外貌 / 肖像备注', snapshot.appearance);
  addDetail('人物背景', snapshot.background);
  addDetail('笔记', snapshot.notes);
  snapshot.talents.forEach((item, index) => {
    if (string(item.name) !== '' || string(item.description) !== '') addDetail(`天赋 ${index + 1} · ${display(item.name)} · ${item.source}`, item.description || '未填写说明');
  });
  snapshot.weapons.forEach((item, index) => {
    if (Object.values(item).some(value => string(value) !== '')) addDetail(`武器 ${index + 1} · ${display(item.name)}`, `伤害：${display(item.damage)}；范围：${display(item.range)}；奖励骰：${display(item.bonus)}；技能：${display(item.skill)}`);
  });
  addDetail('本场经验回答', snapshot.xpAnswers.map((item, index) => `${index + 1}. ${display(item.value)} ${item.question}`).join('\n'));
  if (snapshot.progress.creation) {
    const c = snapshot.progress.creation;
    addDetail('建卡记录', `范型：${display(c.archetype)}；年龄：${display(c.age)}\n初始属性预算 ${display(c.attributeBudget)}，剩余 ${display(c.attributeRemaining)}；初始技能预算 ${display(c.skillBudget)}，剩余 ${display(c.skillRemaining)}\n初始属性：${ATTRIBUTES.map(a => `${a.name} ${display(c.attributes[a.cell])}`).join(' / ')}\n初始技能：${ATTRIBUTES.flatMap(a => a.skills).map(s => `${s.name} ${display(c.skills[s.cell])}`).join(' / ')}\n初始资源：基础 ${display(c.resourceBase)}，投资 ${display(c.resourcePurchased)}`);
  }
  if (snapshot.progress.ledger.length) addDetail('经验与资产账本', snapshot.progress.ledger.map((item, index) => `${index + 1}. 第 ${item.sessionId} 场 · ${item.kind === 'xp' ? 'XP' : '资产'} ${item.amount >= 0 ? '+' : ''}${item.amount} → ${item.balance} · ${item.reason}`).join('\n'));
  if (d.validation.length) addDetail('当前规则校验提示', d.validation.map(item => item.message).join('\n'));
  if (d.warnings.length) addDetail('规则资料提示', d.warnings.join('\n'));

  let cursor = 0;
  const continuation = () => {
    newPage();
    text('调查员档案 · 完整说明与记录', 32, 30, 14, copper);
    fitted(`${display(snapshot.name)} · ${display(snapshot.archetype)}`, 32, 53, width - 64, 18, '身份', 9, false);
    rule(32, 77, width - 64, copper);
    cursor = 90;
  };
  for (const item of detail) {
    if (!cursor || cursor > 527) continuation();
    for (const heading of wrap(item.title, 10, width - 64)) {
      if (cursor > 565) continuation();
      text(heading, 32, cursor, 10, copper);
      cursor += 14;
    }
    cursor += 5;
    for (const value of wrap(item.value, 10, width - 80)) {
      if (cursor > 565) { continuation(); text('完整说明（续）', 32, cursor, 10, copper); cursor += 19; }
      text(value, 40, cursor, 10);
      cursor += 14;
    }
    cursor += 15;
  }
  const pages = pdf.getPages();
  const date = snapshot.exportedDate ?? snapshot.exportedAt.slice(0, 10);
  pages.forEach((entry, index) => {
    page = entry;
    rule(28, 582, width - 56, copper);
    const label = `${display(snapshot.name)} · ${d.phase === 'play' ? '游戏阶段' : '建卡阶段'} · 属性余点 ${display(d.attributeRemaining)} / 技能余点 ${display(d.skillRemaining)}`;
    fitted(label, 28, 584, width - 240, 10, '档案状态', 7, false);
    text(`${date} · ${index + 1} / ${pages.length}`, width - 169, 584, 7, muted);
  });
  return { bytes: await pdf.save(), pageCount: pages.length, warnings: missing.size ? [`字体未收录 ${missing.size} 个字符，已以 Unicode 编码标注：${[...missing].map(code => `U+${code.toString(16).toUpperCase()}`).join('、')}`] : [] };
}
