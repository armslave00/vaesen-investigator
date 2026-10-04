import { FormulaEngine } from './engine.js';

const CARD = '角色卡';
export const ATTRIBUTES = [
  { name: '体能', cell: 'D20', skills: [{ name: '敏捷', cell: 'D21' }, { name: '近身战斗', cell: 'D22' }, { name: '力量', cell: 'D23' }] },
  { name: '精准', cell: 'I20', skills: [{ name: '医学', cell: 'I21' }, { name: '远程战斗', cell: 'I22' }, { name: '隐秘行动', cell: 'I23' }] },
  { name: '逻辑', cell: 'N20', skills: [{ name: '调查', cell: 'N21' }, { name: '学习', cell: 'N22' }, { name: '警觉', cell: 'N23' }] },
  { name: '共情', cell: 'S20', skills: [{ name: '启迪', cell: 'S21' }, { name: '操控人心', cell: 'S22' }, { name: '观察', cell: 'S23' }] },
];
export const SKILLS = ATTRIBUTES.flatMap(({ name: attribute, cell: attributeCell, skills }) => skills.map(skill => ({ ...skill, attribute, attributeCell })));
export const XP_CELLS = ['W18', 'X18', 'Y18', 'Z18', 'AA18', 'AB18', 'AC18', 'AD18'];
const ATTRIBUTE_LABELS = ['A20', 'F20', 'K20', 'P20'];
const SKILL_LABELS = ['A21', 'A22', 'A23', 'F21', 'F22', 'F23', 'K21', 'K22', 'K23', 'P21', 'P22', 'P23'];
const TALENT_CELLS = ['A25', 'A26', 'A27', 'A28'];
const BODY_CONDITIONS = ['Y10', 'Y11', 'Y12'];
const MENTAL_CONDITIONS = ['AD10', 'AD11', 'AD12'];
const ACTIONS = new Set(['normal', 'attack', 'ritual', 'flee', 'parry', 'dodge', 'move']);
const blank = value => value === null || value === undefined || value === '' || typeof value === 'string' && value.trim() === '';
const clean = value => typeof value === 'string' ? value.replaceAll('\u00a0', ' ').trim() : '';
const numeric = (value, empty = 0) => blank(value) ? empty : typeof value === 'number' ? value : typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : NaN;
const integer = value => typeof value === 'number' && Number.isSafeInteger(value);
const validBalance = value => integer(value) && value >= 0;
const total = values => { const numbers = values.map(value => numeric(value)); return numbers.every(Number.isFinite) ? numbers.reduce((sum, value) => sum + value, 0) : null; };
const record = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const primitive = value => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
const assertKeys = (value, keys, label) => {
  if (!record(value)) throw new Error(`${label}格式不正确`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${label}包含未知字段或非数据属性`);
  }
};
const safeList = (value, limit, label) => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > limit) throw new Error(`${label}格式不正确`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) throw new Error(`${label}包含非数据属性`);
  }
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new Error(`${label}不能包含空项`);
};
const safeText = (value, label, limit = 2000) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}格式不正确`);
  return value;
};
const safeBalance = (value, label) => {
  if (!validBalance(value)) throw new Error(`${label}必须是非负安全整数`);
  return value;
};
const safeScalar = (value, label) => {
  if (!primitive(value) || typeof value === 'string' && value.length > 200000) throw new Error(`${label}格式不正确`);
  return value;
};
const skillName = (rules, name) => {
  const value = clean(name);
  return rules.skillAliases?.[value] ?? (value === '蛮力' ? '力量' : value);
};

function validateCreationSnapshot(snapshot, rules) {
  if (!snapshot) return;
  const fail = (field, reason) => { throw new Error(`建卡快照无效：${field} ${reason}`); };
  const archetype = rules.archetypes.find(item => item.name === clean(snapshot.archetype));
  if (!archetype) fail('范型', '必须来自当前规则资料。');
  const age = numeric(snapshot.age, NaN);
  const group = integer(age) && age >= 17 ? rules.ageGroups.find(item => age >= item.min && (item.max === null || age <= item.max)) : null;
  if (!group) fail('年龄', '必须是至少 17 岁的整数。');
  if (snapshot.attributeBudget !== group.attributePoints || snapshot.skillBudget !== group.skillPoints) fail('预算', '必须与初始年龄对应。');
  let attributeTotal = 0;
  for (const attribute of ATTRIBUTES) {
    const value = numeric(snapshot.attributes[attribute.cell], NaN);
    const maximum = archetype.mainAttribute === attribute.name ? 5 : 4;
    if (!integer(value) || value < 2 || value > maximum) fail(attribute.cell, `初始属性必须是 2–${maximum} 的整数。`);
    attributeTotal += value;
  }
  let skillTotal = 0;
  const mainSkill = skillName(rules, archetype.mainSkill);
  for (const skill of SKILLS) {
    const value = numeric(snapshot.skills[skill.cell]);
    const maximum = mainSkill === skill.name ? 3 : 2;
    if (!integer(value) || value < 0 || value > maximum) fail(skill.cell, `初始技能必须是 0–${maximum} 的整数。`);
    skillTotal += value;
  }
  if (!integer(snapshot.resourceBase) || snapshot.resourceBase !== archetype.resourceMin) fail('初始资源', '必须等于初始范型的资源下限。');
  const resourcePurchased = numeric(snapshot.resourcePurchased);
  if (!integer(resourcePurchased) || resourcePurchased < 0 || resourcePurchased > archetype.resourceMax - archetype.resourceMin) fail('资源加点', '必须是范型建卡范围内的非负整数。');
  if (snapshot.attributeRemaining !== 0 || attributeTotal !== group.attributePoints) fail('属性分配', '必须恰好用完初始属性预算。');
  if (snapshot.skillRemaining !== 0 || skillTotal + resourcePurchased !== group.skillPoints) fail('技能分配', '技能与资源投资必须恰好用完初始技能预算。');
}

// This is deliberately a finite, plain data schema. Saved progress never
// executes code, implicitly grants XP, or treats a boolean as a numeric balance.
export function normalizeProgress(progress = {}) {
  assertKeys(progress, ['phase', 'xp', 'assets', 'extraTalents', 'ledger', 'session', 'creation'], '成长记录');
  const phase = progress.phase ?? 'creation';
  if (!['creation', 'play'].includes(phase)) throw new Error('角色阶段不正确');
  const xp = safeBalance(progress.xp ?? 0, '经验余额');
  const assets = progress.assets === undefined || progress.assets === null ? null : safeBalance(progress.assets, '资产余额');
  const extraTalents = progress.extraTalents ?? [];
  safeList(extraTalents, 1000, '额外天赋列表');
  const talents = extraTalents.map(name => { safeText(name, '天赋名称', 200); if (!name.trim()) throw new Error('天赋名称不能为空'); return name; });
  const inputSession = progress.session ?? {};
  assertKeys(inputSession, ['id', 'settled'], '场次记录');
  const session = { id: inputSession.id ?? 1, settled: inputSession.settled ?? false };
  if (!integer(session.id) || session.id < 1 || typeof session.settled !== 'boolean') throw new Error('场次记录不正确');
  const inputLedger = progress.ledger ?? [];
  safeList(inputLedger, 5000, '账本');
  const ledger = inputLedger.map(entry => {
    assertKeys(entry, ['kind', 'amount', 'balance', 'reason', 'sessionId'], '账本条目');
    if (!['xp', 'assets'].includes(entry.kind) || !integer(entry.amount) || !validBalance(entry.balance) || !integer(entry.sessionId) || entry.sessionId < 1) throw new Error('账本数值不正确');
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error('账本原因不能为空');
    return { kind: entry.kind, amount: entry.amount, balance: entry.balance, reason: safeText(entry.reason, '账本原因'), sessionId: entry.sessionId };
  });
  let creation = null;
  if (progress.creation !== undefined && progress.creation !== null) {
    const input = progress.creation;
    assertKeys(input, ['kind', 'validated', 'archetype', 'age', 'attributeBudget', 'skillBudget', 'attributes', 'skills', 'resourceBase', 'resourcePurchased', 'attributeRemaining', 'skillRemaining'], '建卡快照');
    if (input.kind !== 'created' || input.validated !== true) throw new Error('建卡快照必须来自已完成的常规建卡。');
    if (!(input.archetype === null || typeof input.archetype === 'string')) throw new Error('建卡快照范型不正确');
    const nullableNumber = (value, label) => {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${label}不正确`);
      return value;
    };
    const cellValues = (values, cells, label) => {
      assertKeys(values, cells, label);
      return Object.fromEntries(cells.map(cell => [cell, safeScalar(values[cell] ?? null, label)]));
    };
    creation = {
      kind: input.kind, validated: input.validated,
      archetype: input.archetype === null ? null : safeText(input.archetype, '建卡范型', 200),
      age: safeScalar(input.age ?? null, '建卡年龄'),
      attributeBudget: nullableNumber(input.attributeBudget, '属性预算'),
      skillBudget: nullableNumber(input.skillBudget, '技能预算'),
      attributes: cellValues(input.attributes, ATTRIBUTES.map(attribute => attribute.cell), '初始属性'),
      skills: cellValues(input.skills, SKILLS.map(skill => skill.cell), '初始技能'),
      resourceBase: nullableNumber(input.resourceBase, '初始资源'),
      resourcePurchased: safeScalar(input.resourcePurchased ?? null, '初始资源加点'),
      attributeRemaining: nullableNumber(input.attributeRemaining, '初始剩余属性'),
      skillRemaining: nullableNumber(input.skillRemaining, '初始剩余技能'),
    };
  }
  if (phase === 'play' && !creation) throw new Error('游戏阶段缺少已完成的建卡记录。');
  return { phase, xp, assets, extraTalents: talents, ledger, session, creation };
}

export class RulesEngine extends FormulaEngine {
  constructor(workbook, rules, overrides = {}, progress = {}) {
    super(workbook, overrides);
    if (!rules || !Array.isArray(rules.archetypes) || !Array.isArray(rules.ageGroups) || !Array.isArray(rules.resources) || !Array.isArray(rules.talents)) throw new Error('规则数据不完整');
    this.rules = rules;
    this.progress = normalizeProgress(progress);
    validateCreationSnapshot(this.progress.creation, rules);
    this.talentMap = new Map(rules.talents.map(talent => [talent.name, talent]));
  }
  _raw(sheet, address) {
    try { return super._read(sheet, address); }
    catch (cause) { if (typeof cause.code === 'string') return cause.code; throw cause; }
  }
  _talentName(name) { const value = clean(name); return this.rules.talentAliases?.[value] ?? (value === '人多胆壮' ? '人多壮胆' : value); }
  _skillName(name) { return skillName(this.rules, name); }
  _talents() { return [...TALENT_CELLS.map(cell => this._raw(CARD, cell)), ...this.progress.extraTalents].map(name => this._talentName(name)).filter(Boolean); }
  _age(value) {
    const age = numeric(value, NaN);
    const group = integer(age) && age >= 17 ? this.rules.ageGroups.find(item => age >= item.min && (item.max === null || age <= item.max)) : null;
    if (!group) return { label: '年龄错误', attributeBudget: null, skillBudget: null };
    return { label: `${group.name}(${group.max === null ? `${group.min}+` : `${group.min}-${group.max}`})`, attributeBudget: group.attributePoints, skillBudget: group.skillPoints };
  }
  _read(sheet, address) {
    address = address.replaceAll('$', '').toUpperCase();
    if (sheet !== CARD) return super._read(sheet, address);
    if (address === 'F18') {
      const original = this._raw(CARD, address);
      return blank(original) ? this.derived().currentAssets : original;
    }
    if (/^E2[5-8]$/.test(address)) {
      if (Object.hasOwn(this.overrides, `${CARD}!${address}`)) return this.overrides[`${CARD}!${address}`];
      return this.talentMap.get(this._talentName(this._raw(CARD, `A${address.slice(1)}`)))?.description ?? '';
    }
    if (['F16', 'P19', 'T19', 'A18', 'E18', 'C17', 'A36'].includes(address)) {
      const value = this.derived();
      if (address === 'F16') return value.age.label;
      if (address === 'P19') return value.attributeRemaining ?? (value.age.attributeBudget === null ? '#N/A' : '#VALUE!');
      if (address === 'T19') return value.skillRemaining ?? (value.age.skillBudget === null ? '#N/A' : '#VALUE!');
      if (address === 'A18') return value.resourceBase ?? '';
      if (address === 'E18') return value.resource ?? '';
      if (address === 'C17') return value.lifestyle;
      return value.archetype ? `职业装备:${value.archetype.equipment}` : ' ';
    }
    return super._read(sheet, address);
  }
  set(sheet, address, value) {
    if (!primitive(value) || typeof value === 'string' && value.length > 200000) throw new Error('单元格值无效');
    if (typeof sheet !== 'string' || typeof address !== 'string' || !/^[A-Z]+\d+$/i.test(address)) throw new Error('单元格地址无效');
    super.set(sheet, address.toUpperCase(), value);
  }
  restore(sheet, address) { super.restore(sheet, address.replaceAll('$', '').toUpperCase()); }
  derived() {
    const phase = this.progress.phase;
    const archetype = this.rules.archetypes.find(item => item.name === clean(this._raw(CARD, 'D15'))) ?? null;
    const age = this._age(this._raw(CARD, 'D16'));
    const attributes = ATTRIBUTES.map(item => this._raw(CARD, item.cell));
    const skills = SKILLS.map(item => this._raw(CARD, item.cell));
    const sumAttributes = total(attributes), sumSkills = total(skills);
    const resourcePurchased = numeric(this._raw(CARD, 'C18'));
    const ownedTalents = this._talents();
    const wealthyCount = ownedTalents.filter(name => name === '富有').length;
    const resourceBase = archetype?.resourceMin ?? null;
    const resource = resourceBase === null || !Number.isFinite(resourcePurchased) ? null : resourceBase + resourcePurchased + wealthyCount;
    const standard = this.rules.resources.find(item => item.value === resource) ?? null;
    let attributeRemaining = age.attributeBudget === null || sumAttributes === null ? null : age.attributeBudget - sumAttributes;
    let skillRemaining = age.skillBudget === null || sumSkills === null || !Number.isFinite(resourcePurchased) ? null : age.skillBudget - sumSkills - resourcePurchased;
    if (phase === 'play' && this.progress.creation) {
      attributeRemaining = this.progress.creation.attributeRemaining;
      skillRemaining = this.progress.creation.skillRemaining;
    }
    const assetInput = this._raw(CARD, 'F18');
    const assetNumber = numeric(assetInput, null);
    const currentAssets = !blank(assetInput) ? validBalance(assetNumber) ? assetNumber : null : this.progress.assets ?? standard?.assets ?? null;
    const validation = [];
    const add = (cell, message) => validation.push({ cell, message });
    const warnings = [];
    if (!archetype) add('D15', '请选择规则数据中存在的范型。');
    if (age.attributeBudget === null) add('D16', '年龄必须是至少 17 岁的整数。');
    for (const item of ATTRIBUTES) {
      const value = numeric(this._raw(CARD, item.cell), NaN);
      const maximum = phase === 'creation' && archetype?.mainAttribute !== item.name ? 4 : 5;
      if (!integer(value) || value < 2 || value > maximum) add(item.cell, `${item.name}常规建卡为 2–${maximum} 的整数。`);
    }
    for (const item of SKILLS) {
      const value = numeric(this._raw(CARD, item.cell));
      const maximum = phase === 'creation' ? this._skillName(archetype?.mainSkill) === item.name ? 3 : 2 : 5;
      if (!integer(value) || value < 0 || value > maximum) add(item.cell, `${item.name}应为 0–${maximum} 的整数。`);
    }
    if (!integer(resourcePurchased) || resourcePurchased < 0) add('C18', '初始资源加点必须是非负整数。');
    else if (archetype && resourcePurchased > archetype.resourceMax - archetype.resourceMin) add('C18', '初始资源投资超过范型建卡上限。');
    if (resource !== null && (!integer(resource) || resource < 1)) add('E18', '资源必须是正安全整数。');
    if (!blank(assetInput) && !validBalance(assetNumber)) add('F18', '资产余额必须是非负整数。');
    if (phase === 'creation') {
      if (attributeRemaining !== null && attributeRemaining !== 0) add('P19', attributeRemaining > 0 ? '属性点尚未分配完。' : '属性分配超过年龄预算。');
      if (skillRemaining !== null && skillRemaining !== 0) add('T19', skillRemaining > 0 ? '技能点尚未分配完。' : '技能与资源投资超过年龄预算。');
      const first = this._talentName(this._raw(CARD, 'A25'));
      if (!archetype?.talents.some(name => this._talentName(name) === first)) add('A25', '初始天赋必须从所选范型的三个天赋中选择。');
      for (const cell of TALENT_CELLS.slice(1)) if (!blank(this._raw(CARD, cell))) add(cell, '常规建卡只获得一个初始天赋，其他天赋在游戏中购买。');
      if (this.progress.extraTalents.length) add('A26', '额外天赋属于游戏中的成长记录。');
    }
    const counts = new Map();
    ownedTalents.forEach(name => counts.set(name, (counts.get(name) ?? 0) + 1));
    for (const [name, count] of counts) {
      const talent = this.talentMap.get(name);
      if (!talent) warnings.push(`天赋“${name}”不在规则资料中，效果需由 GM 确认。`);
      else {
        if (count > 1 && !talent.repeatable && name !== '富有') warnings.push(`天赋“${name}”重复记录，不会重复叠加效果。`);
        if (talent.verified === false) warnings.push(`天赋“${name}”来自扩展自动卡，基础规则书未核验。`);
      }
    }
    if (archetype?.verified === false) warnings.push('吸血鬼猎人为扩展范型，现有基础规则书未独立核验。');
    if (integer(resource) && resource > 8) warnings.push('规则书资源表未收录大于 8 的生活标准、标准资产与交易奖励；资源值保留，请与 GM 确认。');
    return { phase, archetype, age, attributeRemaining, skillRemaining, resource, resourceBase, resourcePurchased: Number.isFinite(resourcePurchased) ? resourcePurchased : null, wealthyCount, lifestyle: standard?.name ?? '', standardAssets: standard?.assets ?? null, exchangeBonus: standard?.exchangeBonus ?? null, currentAssets, xp: this.progress.xp, pendingXP: this.progress.session.settled ? 0 : 1 + XP_CELLS.slice(1).filter(cell => this._raw(CARD, cell) === '●').length, sessionSettled: this.progress.session.settled, validation, warnings, ownedTalents, extraTalents: [...this.progress.extraTalents] };
  }
  _snapshot(data) {
    const attributes = Object.fromEntries(ATTRIBUTES.map(item => [item.cell, this._raw(CARD, item.cell)]));
    const skills = Object.fromEntries(SKILLS.map(item => [item.cell, this._raw(CARD, item.cell)]));
    return { kind: 'created', validated: true, archetype: data.archetype?.name ?? (clean(this._raw(CARD, 'D15')) || null), age: this._raw(CARD, 'D16'), attributeBudget: data.age.attributeBudget, skillBudget: data.age.skillBudget, attributes, skills, resourceBase: data.resourceBase, resourcePurchased: this._raw(CARD, 'C18'), attributeRemaining: data.attributeRemaining, skillRemaining: data.skillRemaining };
  }
  _play() { if (this.progress.phase !== 'play') throw new Error('请先完成建卡，再进行游戏操作。'); }
  _changed() { this.cache.clear(); return this.derived(); }
  completeCreation() {
    if (this.progress.phase !== 'creation') throw new Error('该角色已经进入游戏。');
    const data = this.derived();
    if (data.validation.length) throw new Error(`建卡尚未完成：${data.validation.map(item => item.message).join(' ')}`);
    const creation = this._snapshot(data);
    validateCreationSnapshot(creation, this.rules);
    this.progress.creation = creation;
    this.progress.phase = 'play';
    if (this.progress.assets === null) this.progress.assets = data.currentAssets;
    return this._changed();
  }
  _transaction(kind, amount, reason, balance) {
    if (!integer(amount) || !validBalance(balance)) throw new Error('账本金额超出安全整数范围。');
    safeText(reason, '账本原因');
    if (!reason.trim()) throw new Error('请填写账本调整原因。');
    if (this.progress.ledger.length >= 5000) throw new Error('账本已达到存档上限，请先整理档案。');
    return { kind, amount, balance, reason, sessionId: this.progress.session.id };
  }
  adjustXP(amount, reason) {
    if (!integer(amount)) throw new Error('经验调整必须是有符号整数。');
    const balance = this.progress.xp + amount;
    if (!validBalance(balance)) throw new Error('经验余额不足或超出安全整数范围。');
    const entry = this._transaction('xp', amount, reason, balance);
    this.progress.xp = balance; this.progress.ledger.push(entry);
    return this._changed();
  }
  buySkill(cell) {
    this._play();
    const skill = SKILLS.find(item => item.cell === cell || item.name === this._skillName(cell));
    if (!skill) throw new Error('请选择存在的技能。');
    const current = numeric(this._raw(CARD, skill.cell));
    if (!integer(current) || current < 0 || current >= 5) throw new Error('技能数值必须合法，且不能超过 5。');
    if (this.progress.xp < 5) throw new Error('提升技能需要 5 XP。');
    const entry = this._transaction('xp', -5, `提升技能：${skill.name}`, this.progress.xp - 5);
    super.set(CARD, skill.cell, current + 1);
    this.progress.xp -= 5; this.progress.ledger.push(entry);
    return this._changed();
  }
  buyTalent(name) {
    this._play();
    name = this._talentName(name);
    const talent = this.talentMap.get(name);
    if (!talent) throw new Error('请选择规则资料中存在的天赋。');
    if (name !== '富有' && this._talents().includes(name)) throw new Error('已经拥有该天赋；只有富有可以重复购买。');
    if (this.progress.extraTalents.length >= 1000) throw new Error('额外天赋列表已达到存档上限。');
    const before = this.derived();
    if (name === '富有' && (!integer(before.resource) || before.resource < 1 || !Number.isSafeInteger(before.resource + 1))) throw new Error('富有需要合法的正资源值，成长结果不能超出安全整数范围。');
    if (this.progress.xp < 5) throw new Error('购买天赋需要 5 XP。');
    const entry = this._transaction('xp', -5, `购买天赋：${name}`, this.progress.xp - 5);
    if (this.progress.assets === null && blank(this._raw(CARD, 'F18'))) this.progress.assets = before.currentAssets;
    this.progress.extraTalents.push(name);
    this.progress.xp -= 5; this.progress.ledger.push(entry);
    return this._changed();
  }
  settleExperience() {
    this._play();
    if (this.progress.session.settled) throw new Error('本场经验已结算；请显式开始下一场。');
    const amount = this.derived().pendingXP;
    const balance = this.progress.xp + amount;
    const entry = this._transaction('xp', amount, `结算第 ${this.progress.session.id} 场经验`, balance);
    this.progress.xp = balance; this.progress.session.settled = true; this.progress.ledger.push(entry);
    return this._changed();
  }
  startSession() {
    this._play();
    if (!this.progress.session.settled) throw new Error('请先结算本场经验，再开始下一场，避免丢失未结算回答。');
    if (!Number.isSafeInteger(this.progress.session.id + 1)) throw new Error('场次编号超出安全整数范围。');
    this.progress.session = { id: this.progress.session.id + 1, settled: false };
    for (const cell of XP_CELLS) super.set(CARD, cell, '○');
    return this._changed();
  }
  spendMemento() {
    this._play();
    if (this.progress.xp < 1) throw new Error('修复或重获纪念物需要 1 XP。');
    return this.adjustXP(-1, '修复或重获旧纪念物');
  }
  adjustAssets(amount, reason) {
    if (!integer(amount)) throw new Error('资产调整必须是有符号整数。');
    const current = this.derived().currentAssets;
    if (!validBalance(current)) throw new Error('请先填写合法资产余额或资源值。');
    const balance = current + amount;
    if (!validBalance(balance)) throw new Error('资产余额不足或超出安全整数范围。');
    const entry = this._transaction('assets', amount, reason, balance);
    this.progress.assets = balance;
    super.set(CARD, 'F18', null);
    this.progress.ledger.push(entry);
    return this._changed();
  }
  resetAssets() {
    const data = this.derived();
    if (!validBalance(data.standardAssets)) throw new Error('资源值无效，不能按标准恢复资产。');
    if (data.currentAssets === null) throw new Error('当前资产输入无效，请先修正或清空手填值。');
    const entry = this._transaction('assets', data.standardAssets - data.currentAssets, '显式恢复为标准资产', data.standardAssets);
    this.progress.assets = data.standardAssets;
    super.set(CARD, 'F18', null);
    this.progress.ledger.push(entry);
    return this._changed();
  }
  validationOptions(sheet, address) {
    if (sheet === CARD && address.replaceAll('$', '').toUpperCase() === 'D15') return this.rules.archetypes.map(item => item.name);
    if (sheet === CARD && address.replaceAll('$', '').toUpperCase() === 'A25') return this.derived().archetype?.talents ?? [];
    return super.validationOptions(sheet, address);
  }
  conditionalCells(sheet) {
    if (sheet !== CARD) return super.conditionalCells(sheet);
    const cells = new Set();
    const data = this.derived();
    if (data.archetype) {
      const attribute = ATTRIBUTES.find(item => item.name === data.archetype.mainAttribute);
      const skill = SKILLS.find(item => item.name === this._skillName(data.archetype.mainSkill));
      if (attribute) { cells.add(attribute.cell); cells.add(ATTRIBUTE_LABELS[ATTRIBUTES.indexOf(attribute)]); }
      if (skill) { cells.add(skill.cell); cells.add(SKILL_LABELS[SKILLS.indexOf(skill)]); }
    }
    if (data.validation.some(item => ['C18', 'E18'].includes(item.cell))) cells.add('E18');
    return cells;
  }
  roll(options = {}) {
    const terms = [], warnings = [];
    const result = (status, reason, extras = {}) => ({ pool: null, status, reason, terms, warnings: [...new Set(warnings)], ...extras });
    if (!record(options)) return result('invalid', '检定参数格式不正确。');
    const { kind = 'skill', action = 'normal', fearAttribute = '逻辑', armor = false, weaponRow = null, equipmentRows = [], advantage = false, manualModifier = 0, talents = [], help = 0, unarmed = false, exchange = false } = options;
    if (!['skill', 'fear'].includes(kind) || !ACTIONS.has(action)) return result('invalid', '检定类型或动作无效。');
    if (![armor, advantage, unarmed, exchange].every(value => typeof value === 'boolean')) return result('invalid', '装备、优势或情景开关必须是布尔值。');
    if (!integer(manualModifier) || !integer(help) || help < 0) return result('invalid', '调整值须为整数，帮助人数须为非负整数。');
    if (weaponRow !== null && (!integer(weaponRow) || weaponRow < 32 || weaponRow > 35)) return result('invalid', '武器行应为 32–35。');
    if (!Array.isArray(equipmentRows) || equipmentRows.length > 6 || equipmentRows.some(row => !integer(row) || row < 30 || row > 35) || new Set(equipmentRows).size !== equipmentRows.length) return result('invalid', '装备行应是不重复的 30–35。');
    if (!Array.isArray(talents) || talents.length > 1000 || talents.some(name => typeof name !== 'string')) return result('invalid', '本次天赋列表无效。');
    for (const field of ['fearRating', 'successes']) if (options[field] !== undefined && (!integer(options[field]) || options[field] < 0)) return result('invalid', '恐惧值与成功数须为非负整数。');
    if (this._raw(CARD, 'Y13') === '●') return result('blocked', '物理崩溃时所有检定自动失败，天赋不能解除崩溃限制。');
    if (this._raw(CARD, 'AD13') === '●' && (kind === 'fear' || !['flee', 'parry', 'dodge', 'move'].includes(action))) return result('blocked', '精神崩溃时不能主动攻击、执行仪式或正常行动；受攻击时可逃跑、格挡或闪避。');
    if (this._raw(CARD, 'AD13') === '●') warnings.push('精神崩溃下的防御检定须发生在受到攻击时；移动仍可由 GM 判断。');
    const owned = new Set(this._talents());
    const selected = new Set(talents.map(name => this._talentName(name)));
    for (const name of selected) if (!owned.has(name)) return result('invalid', `尚未拥有天赋“${name}”，不能启用其效果。`);
    let skill = SKILLS.find(item => item.name === this._skillName(options.skill) || item.cell === options.skill);
    if (kind === 'skill' && !skill) return result('invalid', '请选择有效技能。');
    if (kind === 'fear' && !['逻辑', '共情'].includes(fearAttribute)) return result('invalid', '恐惧检定只能选择逻辑或共情。');
    // Explicitly activated skill substitutions select a new attribute and
    // condition category too; incompatible simultaneous substitutions fail.
    if (kind === 'skill') {
      const replacements = [];
      for (const name of selected) for (const effect of this.talentMap.get(name)?.effects ?? []) if (effect.type === 'replaceSkill' && this._target(effect.target, skill.name)) replacements.push({ name, replacement: effect.replacement, condition: effect.condition });
      if (new Set(replacements.map(item => item.replacement)).size > 1) return result('invalid', '一次检定不能同时启用不同的技能替换。');
      if (replacements.length) {
        const replacement = SKILLS.find(item => item.name === this._skillName(replacements[0].replacement));
        if (!replacement) return result('invalid', '天赋替换目标技能未收录。');
        warnings.push(`${replacements[0].name}：已按 ${replacements[0].condition} 改用${replacement.name}，请确认情景成立。`);
        skill = replacement;
      }
    }
    const attribute = kind === 'fear' ? ATTRIBUTES.find(item => item.name === fearAttribute) : ATTRIBUTES.find(item => item.cell === skill.attributeCell);
    const attributeValue = numeric(this._raw(CARD, attribute.cell), NaN);
    if (!integer(attributeValue) || attributeValue < 2 || attributeValue > 5) return result('invalid', `${attribute.name}需为 2–5 的合法属性值，且不能留空。`);
    const skillValue = kind === 'skill' ? numeric(this._raw(CARD, skill.cell)) : 0;
    if (!integer(skillValue) || skillValue < 0 || skillValue > 5) return result('invalid', '技能需为 0–5 的整数。');
    const add = (label, value) => { if (value !== 0) terms.push({ label, value }); };
    add(attribute.name, attributeValue);
    if (kind === 'skill') add(skill.name, skillValue);
    const mental = ['逻辑', '共情'].includes(attribute.name);
    const conditions = (mental ? MENTAL_CONDITIONS : BODY_CONDITIONS).filter(cell => this._raw(CARD, cell) === '●').length;
    let ignoreConditions = false;
    let damage;
    let weapon = null;
    if (weaponRow !== null) {
      if (kind !== 'skill' || action !== 'attack') warnings.push('武器奖励只用于对应技能的攻击，本次未加入。');
      else {
        const name = clean(this._raw(CARD, `O${weaponRow}`));
        const known = this._catalog(this.rules.weapons, name);
        const listed = clean(this._raw(CARD, `AB${weaponRow}`));
        const matchingSkills = listed ? listed.split(/[\/、,，]/).map(name => this._skillName(name)) : known?.skills ?? [];
        if (!matchingSkills.includes(skill.name)) warnings.push(`武器“${name || `第 ${weaponRow - 31} 项`}”的技能与${skill.name}不匹配，本次未加入。`);
        else {
          const bonusInput = this._raw(CARD, `Z${weaponRow}`), damageInput = this._raw(CARD, `V${weaponRow}`);
          const bonus = numeric(bonusInput, known?.bonus ?? 0);
          const weaponDamage = numeric(damageInput, known?.damage ?? NaN);
          if (!integer(bonus) || !integer(weaponDamage) || weaponDamage < 0) return result('invalid', '选中武器的加成与伤害需为合法整数。');
          add(`武器：${name || `第 ${weaponRow - 31} 项`}`, bonus);
          damage = weaponDamage;
          weapon = { name, kind: known?.kind ?? 'unknown' };
        }
      }
    }
    const actuallyUnarmed = kind === 'skill' && action === 'attack' && skill.name === '力量' && (weapon?.kind === 'unarmed' || unarmed && weaponRow === null);
    if (unarmed && !actuallyUnarmed) warnings.push('徒手拳击或踢击使用力量且不能同时选择武器；本次未加入徒手效果。');
    if (actuallyUnarmed && weaponRow === null) { damage = 1; weapon = { name: '拳击或踢击', kind: 'unarmed' }; }
    const target = kind === 'fear' ? '恐惧' : skill.name;
    for (const name of owned) {
      const talent = this.talentMap.get(name);
      if (!talent) { if (selected.has(name)) warnings.push(`“${name}”未收录效果，需手动调整并请 GM 确认。`); continue; }
      for (const effect of talent.effects ?? []) {
        const automatic = effect.activation === 'always';
        const weaponAutomatic = effect.type === 'damageBonus' && effect.activation === 'weapon' && actuallyUnarmed;
        const active = automatic || weaponAutomatic || selected.has(name);
        if (!active) continue;
        if (selected.has(name) && !['diceBonus', 'ignoreConditions', 'damageBonus', 'replaceSkill', 'specialAttack', 'resourceBonus'].includes(effect.type)) warnings.push(`${name}改变动作或结果；本面板未自动执行该效果。`);
        if (effect.activation === 'weapon' && !weaponAutomatic && !selected.has(name)) continue;
        if (effect.weaponKind && weapon?.kind !== effect.weaponKind) { if (selected.has(name)) warnings.push(`${name}需要${effect.condition}，本次武器条件不满足。`); continue; }
        if (effect.weaponName && weapon?.name !== effect.weaponName) { if (selected.has(name)) warnings.push(`${name}需要${effect.condition}，本次武器条件不满足。`); continue; }
        if (effect.type !== 'damageBonus' && effect.target !== undefined && !this._target(effect.target, target)) continue;
        if (name === '近战训练' && action !== 'parry' || name === '逃脱大师' && action !== 'flee' || name === '神射手' && action !== 'attack') { if (selected.has(name)) warnings.push(`${name}的动作条件不满足，本次不适用。`); continue; }
        if (!automatic && !weaponAutomatic && selected.has(name)) warnings.push(`${name}：请确认${effect.condition ?? '本次适用条件'}${effect.uses ? '，并遵守使用次数限制' : ''}。`);
        if (talent.verified === false || effect.verified === false) warnings.push(`${name}来自扩展自动卡，基础规则书未核验。`);
        if (effect.ambiguity) warnings.push(`${name}：${effect.ambiguity}`);
        if (effect.type === 'diceBonus' && integer(effect.amount)) add(`天赋：${name}`, effect.amount);
        else if (effect.type === 'ignoreConditions') {
          if (effect.conditionType !== 'mental' || mental) { ignoreConditions = true; if (conditions) warnings.push(`${name}使本次检定忽略${mental ? '精神' : '物理'}状态扣骰。`); }
        } else if (effect.type === 'damageBonus' && actuallyUnarmed && integer(effect.amount)) damage = (damage ?? 1) + effect.amount;
        else if (effect.type === 'specialAttack' && kind === 'skill' && action === 'attack') damage = effect.damage;
        else if (selected.has(name) && !['replaceSkill', 'resourceBonus'].includes(effect.type)) warnings.push(`${name}改变动作或结果；本面板未自动执行该效果。`);
      }
    }
    if (!ignoreConditions) add(mental ? '精神状态' : '物理状态', -conditions);
    for (const row of equipmentRows) {
      const name = clean(this._raw(CARD, `A${row}`));
      const item = this._catalog(this.rules.equipment, name);
      if (kind !== 'skill' || !item?.skills?.includes(skill.name)) { warnings.push(`装备“${name || `第 ${row - 29} 项`}”没有匹配本次技能的已核验效果，本次未加入。`); continue; }
      const bonus = numeric(this._raw(CARD, `M${row}`), item.bonus);
      if (!integer(bonus)) return result('invalid', '选中装备的加成需为整数。');
      add(`装备：${name}`, bonus);
      warnings.push(`装备“${name}”：请确认${item.effect}的情景成立。`);
    }
    if (armor && kind === 'skill' && skill.name === '敏捷') {
      const known = this._catalog(this.rules.armor, clean(this._raw(CARD, 'O30')));
      const penalty = numeric(this._raw(CARD, 'AC30'), known?.agility ?? NaN);
      if (!integer(penalty) || penalty > 0) return result('invalid', '护甲敏捷调整应为不大于 0 的整数。');
      add('护甲敏捷', penalty);
    }
    if (exchange) {
      if (kind === 'skill' && skill.name === '操控人心') {
        const bonus = this.derived().exchangeBonus;
        if (!integer(bonus)) return result('invalid', '资源值没有对应的交易奖励。');
        add('生活标准交易奖励', bonus);
        warnings.push('交易奖励用于与 NPC 的交易对抗，不能用资产替代所需成功。');
      } else warnings.push('生活标准交易奖励只适用于操控人心交易检定，本次未加入。');
    }
    add(kind === 'fear' ? '合格同伴支持' : '有效帮助', Math.min(3, help));
    if (advantage) { add('本次优势', 2); warnings.push('优势每场游戏只能使用一次；此面板仅预览，不自动消费。'); }
    add('其他调整', manualModifier);
    const rawPool = terms.reduce((sum, term) => sum + term.value, 0);
    if (!Number.isSafeInteger(rawPool)) return result('invalid', '骰池超出安全整数范围。');
    if (rawPool < 1) add('至少一骰', 1 - rawPool);
    const extras = { pool: Math.max(1, rawPool) };
    if (damage !== undefined) extras.damage = damage;
    if (kind === 'fear' && options.fearRating !== undefined && options.successes !== undefined) extras.fearConditions = Math.max(0, options.fearRating - options.successes);
    return result('ready', '骰池已按当前输入与确认的情景计算；未掷骰。', extras);
  }
  _target(target, skill) { return target === 'any' || typeof target === 'string' && target.split('/').map(value => this._skillName(value)).includes(skill); }
  _catalog(items = [], name) {
    if (!name) return null;
    return items.find(item => item.name === name || item.aliases?.includes(name) || item.name.split(/或|\//).some(alias => clean(alias) === name)) ?? null;
  }
}
