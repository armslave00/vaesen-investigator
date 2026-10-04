import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FormulaEngine } from '../web/engine.js';

const workbook = JSON.parse(readFileSync(new URL('../web/data/workbook.json', import.meta.url), 'utf8'));
// Expectations are OOXML cached results and source table literals, independently
// extracted by scripts/extract-workbook-reference.py. Never use the engine to
// generate these expectations.
const reference = JSON.parse(readFileSync(new URL('./fixtures/workbook-reference.json', import.meta.url), 'utf8'));
const card = '角色卡';
const engine = (changes = {}) => new FormulaEngine(workbook, Object.fromEntries(
  Object.entries(changes).map(([address, value]) => [`${card}!${address}`, value]),
));
const splitKey = (key) => key.split('!');
const attributes = ['D20', 'I20', 'N20', 'S20'];
const skills = ['D21', 'D22', 'D23', 'I21', 'I22', 'I23', 'N21', 'N22', 'N23', 'S21', 'S22', 'S23'];

test('recalculates every original formula to its independently extracted saved result', () => {
  const actual = engine().calculateAll();
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(reference.cachedFormulas).sort());
  for (const [key, expected] of Object.entries(reference.cachedFormulas)) {
    assert.equal(actual[key], expected, `${key}: original cached formula result`);
  }
});

test('retains all original literal data including reference tables and bookkeeping text', () => {
  const calculation = engine();
  for (const [key, expected] of Object.entries(reference.literalCells)) {
    assert.equal(calculation.get(...splitKey(key)), expected, `${key}: original literal`);
  }
});

for (const [age, groupIndex] of [[16, -1], [17, 0], [25, 0], [26, 1], [50, 1], [51, 2], [125, 2]]) {
  test(`age ${age} uses the original age band and point budgets`, () => {
    const calculation = engine({ D16: age });
    const group = reference.ageGroups[groupIndex];
    assert.equal(calculation.get(card, 'F16'), group?.name ?? '年龄错误');
    assert.equal(calculation.get(card, 'P19'), group?.attributes ?? '#N/A');
    assert.equal(calculation.get(card, 'T19'), group?.skills ?? '#N/A');
  });
}

test('fractional ages retain the original comparison boundaries', () => {
  for (const [age, groupIndex] of [[16.999, -1], [25.999, 0], [50.999, 1], [51.001, 2]]) {
    assert.equal(engine({ D16: age }).get(card, 'F16'), reference.ageGroups[groupIndex]?.name ?? '年龄错误');
  }
});

for (const profession of reference.professions) {
  test(`${profession.name}: original resource minimum, equipment, talents and metadata`, () => {
    const calculation = engine({ D15: profession.name, C18: 0 });
    assert.equal(calculation.get(card, 'A18'), profession.minimum);
    assert.equal(calculation.get(card, 'E18'), profession.minimum);
    assert.equal(calculation.get(card, 'A36'), `职业装备:${profession.equipment}`);
    assert.deepEqual(calculation.validationOptions(card, 'A25'), profession.talents);
    assert.equal(calculation.get('辅助表', `B${profession.row}`), profession.minimum);
    assert.equal(calculation.get('辅助表', `C${profession.row}`), profession.maximum);
    assert.equal(calculation.get('辅助表', `G${profession.row}`), profession.attribute);
    assert.equal(calculation.get('辅助表', `H${profession.row}`), profession.skill);
    for (const [index, column] of ['D', 'E', 'F'].entries()) {
      assert.equal(calculation.get('辅助表', `${column}${profession.row}`), profession.talents[index]);
    }
  });

  test(`${profession.name}: resource increments are preserved across and beyond the source limits`, () => {
    for (const increment of [null, '', 0, 1, profession.maximum - profession.minimum, 8, -1]) {
      const total = profession.minimum + (typeof increment === 'number' ? increment : 0);
      const calculation = engine({ D15: profession.name, C18: increment });
      assert.equal(calculation.get(card, 'E18'), total, `increment ${String(increment)}`);
      assert.equal(calculation.get(card, 'C17'), reference.assets.find((asset) => asset.value === total)?.name ?? '');
    }
  });
}

test('profession validation includes every source profession, including the extension validation', () => {
  assert.deepEqual(engine().validationOptions(card, 'D15'), reference.professions.map((profession) => profession.name));
});

test('an unset or unknown profession preserves lookup fallbacks', () => {
  for (const profession of [null, '', '不存在的泛型']) {
    const calculation = engine({ D15: profession, C18: 2 });
    assert.equal(calculation.get(card, 'A18'), '');
    assert.equal(calculation.get(card, 'E18'), '');
    assert.equal(calculation.get(card, 'C17'), '');
    assert.equal(calculation.get(card, 'A36'), ' ');
    assert.deepEqual(calculation.validationOptions(card, 'A25'), []);
  }
});

test('the dynamic first talent list changes when the profession changes', () => {
  const first = reference.professions[0];
  const second = reference.professions.at(-1);
  assert.deepEqual(engine({ D15: first.name }).validationOptions(card, 'A25'), first.talents);
  assert.deepEqual(engine({ D15: second.name }).validationOptions(card, 'A25'), second.talents);
  // Validation applies to the original merged input range, not just its anchor.
  assert.deepEqual(engine({ D15: second.name }).validationOptions(card, 'D25'), second.talents);
});

test('later talent fields retain the workbook’s unrestricted entry behavior', () => {
  const calculation = engine({ D15: '学者', A26: '富有' });
  for (const address of ['A26', 'A27', 'A28']) assert.deepEqual(calculation.validationOptions(card, address), []);
  assert.equal(calculation.get(card, 'E26'), reference.talents.find((talent) => talent.name === '富有').description);
});

test('all source talents populate every one of the four description formulas exactly', () => {
  for (const talent of reference.talents) {
    const calculation = engine(Object.fromEntries([25, 26, 27, 28].map((row) => [`A${row}`, talent.name])));
    for (const row of [25, 26, 27, 28]) {
      assert.equal(calculation.get(card, `E${row}`), talent.description, `${talent.name} at E${row}`);
    }
  }
});

test('empty and unknown talent names retain the original empty-string fallback', () => {
  for (const talent of [null, '', '不存在的天赋']) {
    const calculation = engine({ A25: talent, A26: talent, A27: talent, A28: talent });
    for (const row of [25, 26, 27, 28]) assert.equal(calculation.get(card, `E${row}`), '');
  }
});

test('exact VLOOKUP retains Excel wildcard and escape behavior for free-text names', () => {
  // Excel FALSE lookup still permits text wildcards. See Microsoft’s primary
  // reference: https://support.microsoft.com/en-us/excel/functions/vlookup-function?faq=5
  const bookworm = reference.talents.find((talent) => talent.name === '书虫').description;
  for (const pattern of ['书*', '??', '*']) {
    assert.equal(engine({ A26: pattern }).get(card, 'E26'), bookworm, pattern);
  }
  for (const pattern of ['~*', '~?', '书~*']) assert.equal(engine({ A26: pattern }).get(card, 'E26'), '', pattern);
  const scholar = reference.professions.find((profession) => profession.name === '学者');
  const calculation = engine({ D15: '学*' });
  assert.equal(calculation.get(card, 'A18'), scholar.minimum);
  assert.equal(calculation.get(card, 'A36'), `职业装备:${scholar.equipment}`);
  // INDIRECT requires the real defined name, unlike VLOOKUP.
  assert.deepEqual(calculation.validationOptions(card, 'A25'), []);
});

test('the source permits independent manual edits to unlocked talent descriptions', () => {
  const calculation = engine({ A25: '书虫', E25: '自定义说明', E26: '', E27: 0 });
  assert.equal(calculation.get(card, 'E25'), '自定义说明');
  assert.equal(calculation.get(card, 'E26'), '');
  assert.equal(calculation.get(card, 'E27'), 0);
  const sheet = workbook.sheets.find((entry) => entry.name === card);
  for (const row of [25, 26, 27, 28]) assert.equal(sheet.cells[`E${row}`].locked, false);
});

for (const asset of reference.assets) {
  test(`resource total ${asset.value} selects the original asset tier ${asset.name}`, () => {
    const calculation = engine({ D15: '学者', C18: asset.value - 4 });
    assert.equal(calculation.get(card, 'E18'), asset.value);
    assert.equal(calculation.get(card, 'C17'), asset.name);
    assert.equal(calculation.get('资产表', `C${asset.value + 1}`), asset.description);
  });
}

test('asset lookup remains exact and does not clamp or round out-of-table resources', () => {
  for (const total of [0, -1, 9, 3.5]) {
    const calculation = engine({ D15: '学者', C18: total - 4 });
    assert.equal(calculation.get(card, 'E18'), total);
    assert.equal(calculation.get(card, 'C17'), '');
  }
});

test('point balances independently subtract all four attributes, twelve skills, and resource increment', () => {
  const attributeValues = [4, 3, 2, 1];
  const skillValues = [3, 1, 0, 2, 0, 1, 2, 0, 1, 2, 1, 0];
  const changes = {
    ...Object.fromEntries(attributes.map((address, index) => [address, attributeValues[index]])),
    ...Object.fromEntries(skills.map((address, index) => [address, skillValues[index]])),
    C18: 2,
  };
  const attributeSum = attributeValues.reduce((sum, value) => sum + value, 0);
  const skillSum = skillValues.reduce((sum, value) => sum + value, 0) + 2;
  for (const [age, group] of [[17, reference.ageGroups[0]], [26, reference.ageGroups[1]], [51, reference.ageGroups[2]]]) {
    const calculation = engine({ ...changes, D16: age });
    assert.equal(calculation.get(card, 'P19'), group.attributes - attributeSum);
    assert.equal(calculation.get(card, 'T19'), group.skills - skillSum);
    // Hidden helpers also recalculate for all age bands, independent of selection.
    for (const band of reference.ageGroups) {
      assert.equal(calculation.get('辅助表', `D${band.row}`), band.attributes - attributeSum);
      assert.equal(calculation.get('辅助表', `E${band.row}`), band.skills - skillSum);
    }
  }
});

test('zero, cleared inputs, numeric text and ordinary text retain SUM range behavior', () => {
  const cases = [
    { value: 0, contribution: 0 },
    { value: null, contribution: 0 },
    { value: '', contribution: 0 },
    { value: '2', contribution: 0 },
    { value: '备注', contribution: 0 },
    { value: -2, contribution: -2 },
    { value: 1.5, contribution: 1.5 },
  ];
  for (const { value, contribution } of cases) {
    const calculation = engine({
      D16: 17,
      ...Object.fromEntries([...attributes, ...skills, 'C18'].map((address) => [address, value])),
    });
    assert.equal(calculation.get(card, 'P19'), 15 - 4 * contribution, `attribute value ${String(value)}`);
    assert.equal(calculation.get(card, 'T19'), 10 - 13 * contribution, `skill value ${String(value)}`);
  }
});

test('resource numeric text is coerced by addition but ignored by range SUM', () => {
  const calculation = engine({ D15: '学者', D16: 17, C18: '2' });
  assert.equal(calculation.get(card, 'E18'), 6);
  assert.equal(calculation.get(card, 'C17'), '殷实');
  assert.equal(calculation.get(card, 'T19'), 10);
});

test('nonnumeric resource input preserves the arithmetic error fallback without changing SUM totals', () => {
  const calculation = engine({ D15: '学者', D16: 17, C18: '备注' });
  assert.equal(calculation.get(card, 'A18'), 4);
  assert.equal(calculation.get(card, 'E18'), '');
  assert.equal(calculation.get(card, 'C17'), '');
  assert.equal(calculation.get(card, 'T19'), 10);
});

test('overspending retains negative point balances without clamping', () => {
  const calculation = engine({
    D16: 51,
    C18: 5,
    ...Object.fromEntries(attributes.map((address) => [address, 5])),
    ...Object.fromEntries(skills.map((address) => [address, 3])),
  });
  assert.equal(calculation.get(card, 'P19'), -7);
  assert.equal(calculation.get(card, 'T19'), -27);
});

test('talents, conditions, experience and advantage prose do not add calculations absent from the source', () => {
  const calculation = engine({
    D15: '学者',
    D16: 26,
    C18: 1,
    A26: '富有',
    U6: '祝福 +2',
    U15: '洞察 +1',
    ...Object.fromEntries(attributes.map((address, index) => [address, [4, 4, 3, 3][index]])),
    ...Object.fromEntries(skills.map((address) => [address, 1])),
    ...Object.fromEntries(['Y10', 'Y11', 'Y12', 'Y13', 'AD10', 'AD11', 'AD12', 'AD13', 'W18', 'X18', 'Y18', 'Z18', 'AA18', 'AB18', 'AC18', 'AD18'].map((address) => [address, '●'])),
  });
  assert.equal(calculation.get(card, 'E18'), 5);
  assert.equal(calculation.get(card, 'C17'), reference.assets.find((asset) => asset.value === 5).name);
  assert.equal(calculation.get(card, 'P19'), 0);
  assert.equal(calculation.get(card, 'T19'), -1);
  assert.equal(calculation.get(card, 'E26'), reference.talents.find((talent) => talent.name === '富有').description);
});

test('editing and restoring an input invalidates all dependent memoized results', () => {
  const calculation = engine({ D15: '学者', D16: 17 });
  assert.equal(calculation.get(card, 'E18'), 4);
  assert.equal(calculation.get(card, 'T19'), 10);
  calculation.set(card, 'C18', 2);
  assert.equal(calculation.get(card, 'E18'), 6);
  assert.equal(calculation.get(card, 'T19'), 8);
  calculation.set(card, 'D16', 51);
  assert.equal(calculation.get(card, 'P19'), 13);
  assert.equal(calculation.get(card, 'T19'), 12);
  calculation.restore(card, 'C18');
  assert.equal(calculation.get(card, 'E18'), 4);
  assert.equal(calculation.get(card, 'T19'), 14);
  calculation.restore(card, 'D16');
  assert.equal(calculation.get(card, 'F16'), '年龄错误');
  assert.equal(calculation.get(card, 'P19'), '#N/A');
});

test('SUM covers both columns of every original skill range', () => {
  const calculation = engine({ D16: 17, E21: 1, J22: 2, O23: 3, T21: 4 });
  assert.equal(calculation.get(card, 'T19'), 0);
});

test('souvenir dropdown and status/experience symbols match the workbook validations', () => {
  const calculation = engine();
  for (const address of ['U2', 'U3', 'U4']) {
    assert.deepEqual(calculation.validationOptions(card, address), reference.keepsakes);
  }
  for (const address of ['Y10', 'Y11', 'Y12', 'Y13', 'AD10', 'AD11', 'AD12', 'AD13', 'W18', 'AD18']) {
    assert.deepEqual(calculation.validationOptions(card, address), ['●', '○']);
  }
});

test('all professions reproduce the actual source conditional-format cells for primary attributes and skills', () => {
  for (const profession of reference.professions) {
    const calculation = engine({ D15: profession.name, C18: 0 });
    assert.deepEqual([...calculation.conditionalCells(card)].sort(), reference.conditionalHighlights[profession.name], profession.name);
  }
});

test('resource conditional formatting preserves the source limit boundaries and omitted vampire-hunter row', () => {
  const sourceRule = reference.resourceLimitRule;
  for (const profession of reference.professions) {
    for (const [total, exceeds] of [[profession.maximum, false], [profession.maximum + 1, true]]) {
      const calculation = engine({ D15: profession.name, C18: total - profession.minimum });
      const expected = new Set(reference.conditionalHighlights[profession.name]);
      if (exceeds && sourceRule.professionRows.includes(profession.row)) {
        for (const address of sourceRule.addresses) expected.add(address);
      }
      assert.deepEqual([...calculation.conditionalCells(card)].sort(), [...expected].sort(), `${profession.name}: total ${total}`);
    }
  }
});

test('unselected or unknown professions do not activate source conditional formatting', () => {
  for (const profession of [null, '', '不存在的泛型']) {
    assert.deepEqual([...engine({ D15: profession, C18: 9 }).conditionalCells(card)], []);
  }
});
