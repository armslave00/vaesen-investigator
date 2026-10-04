import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FormulaEngine } from '../web/engine.js';
import { createCardData, parseCardData } from '../web/storage.js';

const workbook = JSON.parse(readFileSync(new URL('../web/data/workbook.json', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(new URL('./fixtures/workbook-reference.json', import.meta.url), 'utf8'));
const archive = (values = {}) => createCardData(workbook, values);
const roundtrip = (values) => parseCardData(JSON.parse(JSON.stringify(archive(values))), workbook);

test('editable control keys match the independently extracted source protection and merged-cell anchors', () => {
  assert.deepEqual(workbook.controls.map(({ sheet, cell }) => `${sheet}!${cell}`).sort(), [...reference.editableControls].sort());
});

test('all source controls survive JSON export/import with exact scalar values', () => {
  const sampleValues = [0, null, '', -2, 1.5, true, false, '姓名与传说\n第二行', '=原样保存的文字', '<script>普通文字</script>'];
  const values = Object.fromEntries(reference.editableControls.map((key, index) => [key, sampleValues[index % sampleValues.length]]));
  assert.deepEqual(roundtrip(values), values);
});

test('export has the documented version and workbook identity, and snapshots the supplied values', () => {
  const values = { '角色卡!A2': '爱琳', '角色卡!D20': 0 };
  const data = archive(values);
  assert.equal(data.format, 'vaesen-web-card');
  assert.equal(data.version, 1);
  assert.equal(data.sourceSha256, workbook.source.sha256);
  values['角色卡!A2'] = '此后修改';
  assert.equal(data.values['角色卡!A2'], '爱琳');
});

test('roundtrip preserves numerical zero, cleared cells, multiline prose and description overrides', () => {
  const values = {
    '角色卡!A2': '林间调查员',
    '角色卡!D15': '学者',
    '角色卡!D16': 17,
    '角色卡!C18': 2,
    '角色卡!D20': 0,
    '角色卡!I20': null,
    '角色卡!D21': 0,
    '角色卡!A25': '书虫',
    '角色卡!E25': '手写说明\n保留第二行',
    '角色卡!E26': '',
    '角色卡!E27': 0,
    '角色卡!AE2': '北方的森林\n不为人知的往事',
    '角色卡!Y10': '●',
    '角色卡!W18': '○',
  };
  const restored = roundtrip(values);
  assert.deepEqual(restored, values);
  const calculation = new FormulaEngine(workbook, restored);
  assert.equal(calculation.get('角色卡', 'P19'), 15);
  assert.equal(calculation.get('角色卡', 'T19'), 8);
  assert.equal(calculation.get('角色卡', 'E18'), 6);
  assert.equal(calculation.get('角色卡', 'C17'), '殷实');
  assert.equal(calculation.get('角色卡', 'E25'), '手写说明\n保留第二行');
  assert.equal(calculation.get('角色卡', 'E26'), '');
  assert.equal(calculation.get('角色卡', 'E27'), 0);
});

test('imports keep overspending, fractional inputs and out-of-range totals without normalization', () => {
  const values = {
    '角色卡!D15': '学者',
    '角色卡!D16': 51.5,
    '角色卡!C18': 9,
    '角色卡!D20': 20,
    '角色卡!D21': -2.5,
    '角色卡!I21': 40,
    '角色卡!F18': -1,
  };
  const restored = roundtrip(values);
  assert.deepEqual(restored, values);
  const calculation = new FormulaEngine(workbook, restored);
  assert.equal(calculation.get('角色卡', 'P19'), -7);
  assert.equal(calculation.get('角色卡', 'T19'), -32.5);
  assert.equal(calculation.get('角色卡', 'E18'), 13);
  assert.equal(calculation.get('角色卡', 'C17'), '');
  assert.equal(calculation.get('角色卡', 'F18'), -1);
});

test('imports retain numeric strings and text that resemble formulas as plain source input', () => {
  const values = { '角色卡!D15': '学者', '角色卡!D16': 17, '角色卡!C18': '2', '角色卡!E25': '=alert("原样")' };
  const restored = roundtrip(values);
  assert.deepEqual(restored, values);
  const calculation = new FormulaEngine(workbook, restored);
  assert.equal(calculation.get('角色卡', 'E18'), 6);
  assert.equal(calculation.get('角色卡', 'T19'), 10);
  assert.equal(calculation.get('角色卡', 'E25'), '=alert("原样")');
});

test('empty exported cards are valid, while malformed top-level data and missing values are rejected', () => {
  assert.deepEqual(roundtrip({}), {});
  for (const data of [null, undefined, [], '', 0, false, {}]) assert.throws(() => parseCardData(data, workbook));
  for (const values of [undefined, null, [], 0, false, '文字']) {
    assert.throws(() => parseCardData({ ...archive(), values }, workbook));
  }
});

test('imports reject a different source workbook, format or archive version', () => {
  for (const patch of [
    { sourceSha256: 'another-workbook' },
    { sourceSha256: undefined },
    { format: 'other-card' },
    { version: 2 },
    { version: '1' },
  ]) assert.throws(() => parseCardData({ ...archive(), ...patch }, workbook));
});

test('imports reject locked formulas, labels, merged placeholders and unknown sheet/cell keys', () => {
  for (const key of [
    '角色卡!P19', '角色卡!T19', '角色卡!E18', '角色卡!C17', '角色卡!A18', '角色卡!A36',
    '角色卡!A1', '角色卡!B2', '角色卡!ZZ999', '辅助表!B16', '不存在!A2', '__proto__',
  ]) {
    assert.throws(() => parseCardData(archive({ [key]: 0 }), workbook), undefined, key);
  }
});

test('imports reject nested values and nonfinite numbers before constructing a calculation engine', () => {
  for (const value of [[], {}, { formula: '=1+1' }, NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => parseCardData(archive({ '角色卡!A2': value }), workbook));
  }
});

test('import validation does not mutate supplied saved data', () => {
  const values = Object.freeze({ '角色卡!A2': '旧档案', '角色卡!E25': null, '角色卡!D20': 0 });
  const data = Object.freeze({ ...archive(values), values });
  const restored = parseCardData(data, workbook);
  assert.deepEqual(restored, values);
  assert.notEqual(restored, values);
});
