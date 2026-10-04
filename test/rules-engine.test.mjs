import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RulesEngine, ATTRIBUTES, SKILLS, XP_CELLS, normalizeProgress } from '../web/rules-engine.js';

const workbook = JSON.parse(readFileSync(new URL('../web/data/workbook.json', import.meta.url), 'utf8'));
const rules = JSON.parse(readFileSync(new URL('../web/data/rules.json', import.meta.url), 'utf8'));
const card = '角色卡';
const initial = {
  D15: '学者', D16: 26, C18: 1, A25: '书虫',
  D20: 3, I20: 3, N20: 5, S20: 3,
  D21: 1, D22: 1, D23: 1, I21: 1, I22: 1, I23: 1,
  N21: 1, N22: 2, N23: 1, S21: 1, S22: 0, S23: 0,
};
const flat = (values) => Object.fromEntries(Object.entries(values).map(([address, value]) => [`${card}!${address}`, value]));
const actor = (values = {}, progress = {}) => {
  // Dice fixtures intentionally include already-developed characters. Import
  // them through the public adoption lifecycle so play always has a snapshot.
  const adopt = progress.phase === 'play';
  const result = new RulesEngine(workbook, rules, flat({ ...initial, ...values }), adopt ? { ...progress, phase: 'creation' } : progress);
  if (adopt) result.adoptExisting();
  return result;
};
const playing = () => { const result = actor(); result.completeCreation(); return result; };
const snapshot = (calculation) => structuredClone({ values: calculation.overrides, progress: calculation.progress });
function rejectedWithoutMutation(calculation, action) {
  const before = snapshot(calculation);
  assert.throws(action);
  assert.deepEqual(snapshot(calculation), before);
}

// All expected numbers below are independently calculated from the local book,
// recorded with primary source anchors in docs/web-dice-rules-spec.md. The rules
// JSON is an input to the system under test, never the oracle for expectations.
const resourceTiers = [
  [1, '赤贫', -1, 0], [2, '贫穷', 0, 0], [3, '挣扎', 0, 1], [4, '经济稳定', 1, 2],
  [5, '中产', 1, 3], [6, '小康', 2, 5], [7, '富有', 3, 8], [8, '大富豪', 5, 12],
];

test('rules exports identify the four attributes, twelve skills and eight XP answers', () => {
  assert.deepEqual(ATTRIBUTES.map(({ name, cell }) => [name, cell]), [['体能', 'D20'], ['精准', 'I20'], ['逻辑', 'N20'], ['共情', 'S20']]);
  assert.deepEqual(SKILLS.map(({ name, cell, attribute, attributeCell }) => [name, cell, attribute, attributeCell]), [
    ['敏捷', 'D21', '体能', 'D20'], ['近身战斗', 'D22', '体能', 'D20'], ['力量', 'D23', '体能', 'D20'],
    ['医学', 'I21', '精准', 'I20'], ['远程战斗', 'I22', '精准', 'I20'], ['隐秘行动', 'I23', '精准', 'I20'],
    ['调查', 'N21', '逻辑', 'N20'], ['学习', 'N22', '逻辑', 'N20'], ['警觉', 'N23', '逻辑', 'N20'],
    ['启迪', 'S21', '共情', 'S20'], ['操控人心', 'S22', '共情', 'S20'], ['观察', 'S23', '共情', 'S20'],
  ]);
  assert.deepEqual(XP_CELLS, ['W18', 'X18', 'Y18', 'Z18', 'AA18', 'AB18', 'AC18', 'AD18']);
});

test('a complete middle-aged scholar reconciles book budgets and corrected automatic resources', () => {
  const calculation = actor();
  const result = calculation.derived();
  assert.match(result.age.label, /中年/);
  assert.equal(result.age.attributeBudget, 14);
  assert.equal(result.age.skillBudget, 12);
  assert.equal(result.attributeRemaining, 0);
  assert.equal(result.skillRemaining, 0);
  assert.equal(result.resourceBase, 4);
  assert.equal(result.resourcePurchased, 1);
  assert.equal(result.resource, 5);
  assert.equal(result.lifestyle, '中产');
  assert.equal(result.standardAssets, 3);
  assert.equal(result.exchangeBonus, 1);
  assert.equal(calculation.get(card, 'E18'), 5);
  assert.equal(calculation.get(card, 'P19'), 0);
  assert.equal(calculation.get(card, 'T19'), 0);
  assert.deepEqual(result.validation, []);
});

test('corrected age budgets retain every creation boundary', () => {
  for (const [age, attributes, skills] of [[17, 15, 10], [25, 15, 10], [26, 14, 12], [50, 14, 12], [51, 13, 14]]) {
    const result = actor({ D16: age }).derived().age;
    assert.equal(result.attributeBudget, attributes);
    assert.equal(result.skillBudget, skills);
  }
  assert.ok(actor({ D16: 16 }).derived().validation.some(({ cell }) => cell === 'D16'));
});

test('every resource tier uses the rulebook lifestyle, exchange modifier and standard assets', () => {
  for (const [resource, lifestyle, exchangeBonus, standardAssets] of resourceTiers) {
    const result = actor({ D15: '神秘学家', C18: resource - 1 }, { phase: 'play' }).derived();
    assert.equal(result.resource, resource);
    assert.equal(result.lifestyle, lifestyle);
    assert.equal(result.exchangeBonus, exchangeBonus);
    assert.equal(result.standardAssets, standardAssets);
  }
});

test('priest creation allows the rulebook resource ceiling of six', () => {
  const calculation = actor({ D15: '牧师', A25: '赦免', N20: 4, S20: 4, C18: 2, S21: 0 });
  assert.equal(calculation.derived().resource, 6);
  assert.deepEqual(calculation.derived().validation, []);
  calculation.completeCreation();
  assert.equal(calculation.progress.phase, 'play');
});

test('creation validates exact ranges and full allocation without clamping inputs', () => {
  for (const [cell, badValue] of [['D20', 1], ['D20', 5], ['N20', 6], ['D21', 3], ['N22', 4], ['C18', 3], ['D21', -1], ['D21', 0.5], ['D16', 25.5]]) {
    const calculation = actor({ [cell]: badValue });
    assert.ok(calculation.derived().validation.some((issue) => issue.cell === cell), `${cell}=${badValue}`);
    assert.equal(calculation.get(card, cell), badValue);
    rejectedWithoutMutation(calculation, () => calculation.completeCreation());
  }
  const unallocated = actor({ D21: 0 });
  rejectedWithoutMutation(unallocated, () => unallocated.completeCreation());
});

test('creation requires one valid initial archetype talent and no additional talents', () => {
  for (const changes of [{ A25: null }, { A25: '勇敢' }, { A26: '军医' }]) {
    const calculation = actor(changes);
    assert.ok(calculation.derived().validation.length > 0);
    rejectedWithoutMutation(calculation, () => calculation.completeCreation());
  }
});

test('completing creation establishes a snapshot and no free experience', () => {
  const calculation = playing();
  assert.equal(calculation.progress.phase, 'play');
  assert.ok(calculation.progress.creation);
  assert.equal(calculation.derived().xp, 0);
  assert.equal(calculation.derived().currentAssets, 3);
  rejectedWithoutMutation(calculation, () => calculation.buySkill('N22'));
  rejectedWithoutMutation(calculation, () => calculation.buyTalent('富有'));
});

test('explicit creation or old-card adoption resolves the migration marker exactly once', () => {
  for (const method of ['completeCreation', 'adoptExisting']) {
    const calculation = actor({}, { migrated: true });
    calculation[method]();
    assert.equal(calculation.progress.migrated, false);
    assert.equal(calculation.progress.creation.kind, method === 'completeCreation' ? 'created' : 'imported');
    rejectedWithoutMutation(calculation, () => calculation.completeCreation());
    rejectedWithoutMutation(calculation, () => calculation.adoptExisting());
  }
});

test('growth purchases cannot bypass completion of ordinary character creation', () => {
  const calculation = actor({}, { xp: 10 });
  rejectedWithoutMutation(calculation, () => calculation.buySkill('N22'));
  rejectedWithoutMutation(calculation, () => calculation.buyTalent('富有'));
  assert.equal(calculation.derived().resource, 5);
});

test('adopting an existing grown card preserves skills, talents, zero assets and XP baseline', () => {
  const calculation = actor({ N22: 5, A26: '勇敢', F18: 0, C18: 2 });
  calculation.adoptExisting();
  assert.equal(calculation.progress.phase, 'play');
  assert.equal(calculation.get(card, 'N22'), 5);
  assert.equal(calculation.derived().resource, 6);
  assert.equal(calculation.derived().currentAssets, 0);
  assert.ok(calculation.derived().ownedTalents.includes('勇敢'));
  assert.equal(calculation.derived().xp, 0);
});

test('skill growth costs five XP per level and does not consume the frozen creation budget', () => {
  const calculation = playing();
  calculation.adjustXP(20, '前期存留经验');
  for (const [level, xp] of [[3, 15], [4, 10], [5, 5]]) {
    calculation.buySkill('N22');
    assert.equal(calculation.get(card, 'N22'), level);
    assert.equal(calculation.derived().xp, xp);
    assert.equal(calculation.derived().skillRemaining, 0);
  }
  rejectedWithoutMutation(calculation, () => calculation.buySkill('N22'));
  rejectedWithoutMutation(calculation, () => calculation.buySkill('D20'));
  rejectedWithoutMutation(calculation, () => calculation.buySkill('不存在'));
});

test('other-archetype talent growth is permitted, while duplicate or unknown purchases are atomic failures', () => {
  const calculation = playing();
  calculation.adjustXP(20, '前期存留经验');
  calculation.buyTalent('军医');
  assert.equal(calculation.derived().xp, 15);
  assert.ok(calculation.derived().ownedTalents.includes('军医'));
  rejectedWithoutMutation(calculation, () => calculation.buyTalent('军医'));
  rejectedWithoutMutation(calculation, () => calculation.buyTalent('书虫'));
  rejectedWithoutMutation(calculation, () => calculation.buyTalent('不存在的天赋'));
});

test('wealthy growth repeats, changes the resource lookup and never charges skill points or replenishes spent assets', () => {
  const calculation = playing();
  calculation.adjustXP(20, '前期存留经验');
  calculation.adjustAssets(-2, '购买物品');
  assert.equal(calculation.derived().currentAssets, 1);
  for (const [count, resource, assets, exchange, xp] of [[1, 6, 5, 2, 15], [2, 7, 8, 3, 10], [3, 8, 12, 5, 5]]) {
    calculation.buyTalent('富有');
    const result = calculation.derived();
    assert.equal(result.wealthyCount, count);
    assert.equal(result.resource, resource);
    assert.equal(result.standardAssets, assets);
    assert.equal(result.exchangeBonus, exchange);
    assert.equal(result.xp, xp);
    assert.equal(result.skillRemaining, 0);
    assert.equal(result.currentAssets, 1);
  }
  // The book does not impose a maximum of eight. Its table ends at eight;
  // a legal repeat purchase retains nine without inventing a ninth-tier lookup.
  calculation.buyTalent('富有');
  const beyondTable = calculation.derived();
  assert.equal(beyondTable.resource, 9);
  assert.equal(beyondTable.xp, 0);
  assert.equal(beyondTable.lifestyle, '');
  assert.equal(beyondTable.standardAssets, null);
  assert.equal(beyondTable.exchangeBonus, null);
  assert.equal(beyondTable.currentAssets, 1);
  assert.ok(beyondTable.warnings.some((warning) => warning.includes('表未收录')));
  rejectedWithoutMutation(calculation, () => calculation.resetAssets());
  assert.equal(calculation.roll({ skill: '操控人心', exchange: true }).status, 'invalid');
});

test('a session cannot be discarded before settling its XP', () => {
  const calculation = playing();
  calculation.set(card, 'X18', '●');
  rejectedWithoutMutation(calculation, () => calculation.startSession());
  assert.equal(calculation.derived().pendingXP, 2);
});

test('XP answers settle once; edits and recalculation never grant the same session again', () => {
  const calculation = playing();
  for (const cell of XP_CELLS) calculation.set(card, cell, '○');
  for (const cell of ['X18', 'Y18']) calculation.set(card, cell, '●');
  // Participation is always one XP; it is not max(1, selected-dot count).
  assert.equal(calculation.derived().pendingXP, 3);
  calculation.set(card, 'W18', null);
  assert.equal(calculation.derived().pendingXP, 3);
  calculation.settleExperience();
  assert.equal(calculation.derived().xp, 3);
  assert.equal(calculation.derived().sessionSettled, true);
  rejectedWithoutMutation(calculation, () => calculation.settleExperience());
  calculation.set(card, 'X18', '○');
  assert.equal(calculation.derived().xp, 3);
  calculation.startSession();
  assert.equal(calculation.derived().sessionSettled, false);
  assert.equal(calculation.derived().pendingXP, 1);
  calculation.settleExperience();
  assert.equal(calculation.derived().xp, 4);
});

test('XP and asset adjustments reject overdrafts, fractions and missing bookkeeping reasons atomically', () => {
  const calculation = playing();
  calculation.adjustXP(5, '此前积累');
  for (const action of [
    () => calculation.adjustXP(-6, '超额扣减'), () => calculation.adjustXP(0.5, '分数经验'),
    () => calculation.adjustXP(1, ''), () => calculation.adjustAssets(-4, '超额消费'),
    () => calculation.adjustAssets(0.5, '分数资产'), () => calculation.adjustAssets(1, ''),
  ]) rejectedWithoutMutation(calculation, action);
});

test('overflow and a full ledger cannot partially spend or grant balances', () => {
  const overflow = actor({}, { phase: 'play', xp: Number.MAX_SAFE_INTEGER, assets: Number.MAX_SAFE_INTEGER });
  for (const action of [() => overflow.adjustXP(1, '额外经验'), () => overflow.adjustAssets(1, '额外资产'), () => overflow.settleExperience()]) {
    rejectedWithoutMutation(overflow, action);
  }
  const ledger = Array.from({ length: 5000 }, () => ({ kind: 'xp', amount: 1, balance: 10, reason: '旧账本', sessionId: 1 }));
  const full = actor({}, { phase: 'play', xp: 10, ledger });
  for (const action of [() => full.buySkill('N22'), () => full.buyTalent('富有'), () => full.spendMemento(), () => full.adjustAssets(-1, '采购'), () => full.settleExperience()]) {
    rejectedWithoutMutation(full, action);
  }
});

test('memento repair costs one XP and does not consume a five-XP growth purchase', () => {
  const calculation = playing();
  rejectedWithoutMutation(calculation, () => calculation.spendMemento());
  calculation.adjustXP(5, '此前积累');
  calculation.spendMemento();
  assert.equal(calculation.derived().xp, 4);
  assert.equal(calculation.get(card, 'N22'), 2);
});

test('assets are independent of permanent resources and require an explicit reset to refill', () => {
  const calculation = playing();
  calculation.adjustAssets(-2, '本谜题购买');
  assert.equal(calculation.derived().currentAssets, 1);
  assert.equal(calculation.derived().resource, 5);
  calculation.settleExperience();
  calculation.startSession();
  assert.equal(calculation.derived().currentAssets, 1);
  calculation.derived();
  assert.equal(calculation.get(card, 'F18'), 1);
  calculation.resetAssets();
  assert.equal(calculation.derived().currentAssets, 3);
});

test('normalizing progress retains explicit zero and produces independent default collections', () => {
  const first = normalizeProgress({ xp: 0, assets: 0, extraTalents: [] });
  const second = normalizeProgress({});
  assert.equal(first.xp, 0);
  assert.equal(first.assets, 0);
  first.extraTalents.push('富有');
  assert.deepEqual(second.extraTalents, []);
});

test('skill dice add the matching attribute and ignore unrelated condition categories', () => {
  const calculation = actor({ D20: 3, D21: 2, Y10: '●', Y11: '●', AD10: '●' }, { phase: 'play' });
  const result = calculation.roll({ skill: '敏捷' });
  assert.equal(result.status, 'ready');
  assert.equal(result.pool, 3);
  assert.equal(actor({ I20: 4, I22: 0, Y10: '●' }, { phase: 'play' }).roll({ skill: '远程战斗' }).pool, 3);
  assert.equal(actor({ N20: 4, N21: 2, Y10: '●', Y11: '●', Y12: '●', AD10: '●', AD11: '●' }, { phase: 'play' }).roll({ skill: '调查' }).pool, 4);
});

test('a roll retains one die after normal penalties, while a blank attribute is invalid', () => {
  assert.equal(actor({ D20: 2, D21: 0, Y10: '●', Y11: '●', Y12: '●' }, { phase: 'play' }).roll({ skill: '敏捷' }).pool, 1);
  assert.equal(actor({ D20: null }, { phase: 'play' }).roll({ skill: '敏捷' }).status, 'invalid');
});

test('owned passive talents exempt only their named skill from matching ordinary conditions', () => {
  const cases = [
    ['知识是可靠的', '学习', 'N20', 'N22', 'AD10', 'AD11'],
    ['应急医学', '医学', 'I20', 'I21', 'Y10', 'Y11'],
    ['绅士', '操控人心', 'S20', 'S22', 'AD10', 'AD11'],
    ['专注', '调查', 'N20', 'N21', 'AD10', 'AD11'],
    ['疑心', '警觉', 'N20', 'N23', 'AD10', 'AD11'],
    ['墨客', '启迪', 'S20', 'S21', 'AD10', 'AD11'],
    ['同理心', '观察', 'S20', 'S23', 'AD10', 'AD11'],
  ];
  for (const [talent, skill, attributeCell, skillCell, condition1, condition2] of cases) {
    const values = { [attributeCell]: 4, [skillCell]: 2, [condition1]: '●', [condition2]: '●' };
    assert.equal(actor(values, { phase: 'play', extraTalents: [talent] }).roll({ skill }).pool, 6, talent);
    assert.equal(actor(values, { phase: 'play' }).roll({ skill }).pool, 4, talent);
  }
});

test('situational bonuses require an owned talent and explicit applicability for this roll', () => {
  const calculation = actor({ N20: 4, N22: 2 }, { phase: 'play' });
  // Initial 书虫 is owned, but finding clues in books must be explicitly selected.
  assert.equal(calculation.roll({ skill: '学习' }).pool, 6);
  assert.equal(calculation.roll({ skill: '学习', talents: ['书虫'] }).pool, 8);
  const before = snapshot(calculation);
  const result = calculation.roll({ skill: '学习', talents: ['短跑选手'] });
  assert.equal(result.status, 'invalid');
  assert.equal(result.pool, null);
  assert.deepEqual(snapshot(calculation), before);
});

test('armor penalizes agility only and weapon bonus changes attack dice separately from damage', () => {
  const armored = actor({ D20: 3, D21: 2, D22: 2, AC30: -1, AA30: 2 }, { phase: 'play' });
  assert.equal(armored.roll({ skill: '敏捷', armor: true }).pool, 4);
  assert.equal(armored.roll({ skill: '近身战斗', armor: true }).pool, 5);
  const armed = actor({ D20: 3, D22: 2, O32: '剑', V32: 2, Z32: 2, AB32: '近身战斗', Y10: '●', Y11: '●' }, { phase: 'play' });
  const result = armed.roll({ skill: '近身战斗', action: 'attack', weaponRow: 32 });
  assert.equal(result.pool, 5);
  assert.equal(result.damage, 2);
  assert.equal(armed.roll({ skill: '近身战斗', action: 'normal', weaponRow: 32 }).pool, 3);
});

test('equipment, advantage, help and manual modifiers combine only for selected applicable inputs', () => {
  const calculation = actor({ D20: 3, D22: 2, O32: '剑', V32: 2, Z32: 2, AB32: '近身战斗', A30: '宠物狗', A31: '看门狗', M30: 1, M31: 2, Y10: '●', Y11: '●' }, { phase: 'play' });
  assert.equal(calculation.roll({ skill: '近身战斗', action: 'attack', weaponRow: 32, equipmentRows: [30], advantage: true, help: 1, manualModifier: 2 }).pool, 11);
  assert.equal(calculation.roll({ skill: '近身战斗', equipmentRows: [30, 30] }).status, 'invalid');
  assert.equal(calculation.roll({ skill: '近身战斗', help: 4 }).pool, 6);
});

test('unarmed strength talent bonus and boxer damage bonus are different terms', () => {
  const calculation = actor({ D20: 3, D23: 2, Y10: '●' }, { phase: 'play', extraTalents: ['强硬如钉', '拳击手'] });
  const result = calculation.roll({ skill: '力量', action: 'attack', unarmed: true, talents: ['强硬如钉'] });
  assert.equal(result.pool, 6);
  assert.equal(result.damage, 2);
  assert.equal(calculation.roll({ skill: '力量', action: 'normal', talents: ['强硬如钉'] }).pool, 4);
});

test('the weapon table unarmed row receives boxer damage but only selected strength talents add dice', () => {
  const calculation = actor({ D20: 3, D23: 2, O32: '拳击或踢击', V32: 1, Z32: 0, AB32: '力量' }, { phase: 'play', extraTalents: ['强硬如钉', '拳击手'] });
  const ordinary = calculation.roll({ skill: '力量', action: 'attack', weaponRow: 32 });
  assert.equal(ordinary.pool, 5);
  assert.equal(ordinary.damage, 2);
  const strong = calculation.roll({ skill: '力量', action: 'attack', weaponRow: 32, talents: ['强硬如钉'] });
  assert.equal(strong.pool, 7);
  assert.equal(strong.damage, 2);
});

test('fear uses only the selected mental attribute, matching states, capped help and brave', () => {
  const calculation = actor({ N20: 4, S20: 3, N21: 5, S21: 5, AD10: '●', AD11: '●', Y10: '●' }, { phase: 'play', extraTalents: ['勇敢'] });
  assert.equal(calculation.roll({ kind: 'fear', fearAttribute: '逻辑', help: 4 }).pool, 6);
  assert.equal(calculation.roll({ kind: 'fear', fearAttribute: '共情', help: 4 }).pool, 5);
  const result = calculation.roll({ kind: 'fear', fearAttribute: '逻辑', fearRating: 3, successes: 1 });
  assert.equal(result.fearConditions, 2);
  assert.equal(calculation.roll({ kind: 'fear', fearAttribute: '逻辑', fearRating: 1, successes: 3 }).fearConditions, 0);
  assert.equal(calculation.roll({ kind: 'fear', fearAttribute: '体能' }).status, 'invalid');
});

test('physical collapse blocks every active roll and passive condition immunity does not lift it', () => {
  const calculation = actor({ Y13: '●' }, { phase: 'play', extraTalents: ['专注'] });
  for (const options of [{ skill: '调查' }, { skill: '敏捷', action: 'dodge' }, { kind: 'fear', fearAttribute: '逻辑' }]) {
    const result = calculation.roll(options);
    assert.equal(result.status, 'blocked');
    assert.equal(result.pool, null);
  }
});

test('mental collapse allows defensive escape, parry and dodge while blocking normal, attack and ritual rolls', () => {
  const calculation = actor({ AD13: '●' }, { phase: 'play' });
  for (const action of ['normal', 'attack', 'ritual']) assert.equal(calculation.roll({ skill: '近身战斗', action }).status, 'blocked');
  for (const [action, skill] of [['flee', '敏捷'], ['dodge', '敏捷'], ['parry', '近身战斗']]) {
    assert.equal(calculation.roll({ skill, action }).status, 'ready', action);
  }
});

test('roll calculations are read-only and do not spend XP, assets, advantages or talent uses', () => {
  const calculation = actor({ N20: 4, N22: 2 }, { phase: 'play', xp: 10, assets: 2 });
  const before = snapshot(calculation);
  calculation.roll({ skill: '学习', talents: ['书虫'], advantage: true, manualModifier: 1 });
  calculation.roll({ kind: 'fear', fearAttribute: '逻辑', help: 3 });
  assert.deepEqual(snapshot(calculation), before);
});
