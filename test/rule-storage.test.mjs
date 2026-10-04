import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCardData } from '../web/storage.js';
import { createRuleCardData, parseRuleCardData } from '../web/rule-storage.js';

const workbook = JSON.parse(readFileSync(new URL('../web/data/workbook.json', import.meta.url), 'utf8'));
const attributes = { D20: 2, I20: 2, N20: 5, S20: 4 };
const skills = { D21: 1, D22: 1, D23: 1, I21: 1, I22: 1, I23: 1, N21: 1, N22: 3, N23: 2, S21: 0, S22: 0, S23: 0 };
const values = { '角色卡!A2': '森林调查员', '角色卡!D15': '学者', '角色卡!D16': 51, '角色卡!C18': 2, '角色卡!E25': '自定义描述\n第二行' };
const snapshot = () => ({
  kind: 'created', validated: true, archetype: '学者', age: 51,
  attributeBudget: 13, skillBudget: 14, attributes: { ...attributes }, skills: { ...skills },
  resourceBase: 4, resourcePurchased: 2, attributeRemaining: 0, skillRemaining: 0,
});
const progress = () => ({
  phase: 'play', xp: 7, assets: 3, extraTalents: ['富有', '富有', '勇敢'],
  ledger: [
    { kind: 'xp', amount: 8, balance: 8, reason: '第 1 场游戏', sessionId: 1 },
    { kind: 'xp', amount: -5, balance: 3, reason: '购买富有', sessionId: 2 },
    { kind: 'xp', amount: 4, balance: 7, reason: '第 2 场游戏', sessionId: 2 },
    { kind: 'assets', amount: -2, balance: 3, reason: '购买用品', sessionId: 2 },
  ],
  session: { id: 2, settled: true }, creation: snapshot(),
});
const archive = (state = progress()) => createRuleCardData(workbook, values, state);
const roundtrip = (data) => parseRuleCardData(JSON.parse(JSON.stringify(data)), workbook);

test('v2 archives preserve every progression field, repeated Wealthy talents and exact cell values', () => {
  const data = archive();
  assert.equal(data.format, 'vaesen-web-card');
  assert.equal(data.version, 2);
  assert.equal(data.sourceSha256, workbook.source.sha256);
  const restored = roundtrip(data);
  assert.deepEqual(restored.values, values);
  assert.deepEqual(restored.progress, progress());
  assert.equal(Object.hasOwn(restored, 'migrated'), false);
  assert.equal(Object.hasOwn(restored.progress, 'migrated'), false);
});

test('export takes an independent snapshot without mutating or retaining nested caller objects', () => {
  const state = progress();
  const before = structuredClone(state);
  const data = archive(state);
  assert.deepEqual(state, before);
  state.extraTalents.push('书虫');
  state.ledger[0].reason = '后来修改';
  state.creation.attributes.D20 = 99;
  state.session.settled = false;
  assert.deepEqual(data.progress, before);
});

test('version 1 archives are rejected instead of entering a compatibility flow', () => {
  const examples = [0, null, '', -5, 0.5, true, false, '多行\n文字', '=纯文字'];
  const allValues = Object.fromEntries(workbook.controls.map(({ sheet, cell }, index) => [sheet + '!' + cell, examples[index % examples.length]]));
  assert.throws(() => roundtrip(createCardData(workbook, allValues)));
});

test('current created archives remain readable while the retired false flag is removed from output', () => {
  const data = archive();
  data.progress.migrated = false;
  assert.deepEqual(roundtrip(data), { values, progress: progress() });
  assert.equal(Object.hasOwn(roundtrip(data).progress, 'migrated'), false);
  for (const flag of [true, 'false', null]) assert.throws(() => roundtrip({ ...data, progress: { ...data.progress, migrated: flag } }));
  assert.throws(() => archive({ ...progress(), migrated: false }));
});

test('unsupported imported and unvalidated snapshots are rejected for export and restore', () => {
  for (const patch of [{ kind: 'imported', validated: false }, { kind: 'created', validated: false }]) {
    const state = { ...progress(), creation: { ...snapshot(), ...patch } };
    assert.throws(() => archive(state));
    assert.throws(() => roundtrip({ ...archive(), progress: state }));
  }
});

test('empty progression receives safe defaults', () => {
  const restored = roundtrip(createRuleCardData(workbook, {}));
  assert.equal(restored.progress.phase, 'creation');
  assert.equal(restored.progress.xp, 0);
  assert.equal(restored.progress.assets, null);
  assert.equal(Object.hasOwn(restored.progress, 'migrated'), false);
  assert.deepEqual(restored.progress.session, { id: 1, settled: false });
});

test('invalid archive identity, missing progression and locked cell edits are rejected', () => {
  for (const patch of [
    { version: 3 }, { version: '2' }, { sourceSha256: 'another' }, { format: 'other' },
    { values: { '角色卡!P19': 15 } }, { values: null }, { progress: null },
  ]) assert.throws(() => parseRuleCardData({ ...archive(), ...patch }, workbook));
  const missing = archive();
  delete missing.progress;
  assert.throws(() => parseRuleCardData(missing, workbook));
});

test('true numeric progression fields reject booleans, strings, fractions and unsafe/nonfinite numbers', () => {
  const bad = [true, false, '2', null, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, undefined];
  for (const field of ['xp', 'assets']) {
    for (const value of bad.filter((item) => !(field === 'assets' && item === null))) {
      assert.throws(() => archive({ ...progress(), [field]: value }), undefined, field + '=' + String(value));
      assert.throws(() => parseRuleCardData({ ...archive(), progress: { ...progress(), [field]: value } }, workbook));
    }
  }
  for (const value of bad) assert.throws(() => archive({ ...progress(), session: { id: value, settled: false } }));
  assert.throws(() => archive({ ...progress(), session: { id: 0, settled: false } }));
  assert.throws(() => archive({ ...progress(), session: { id: 1, settled: 1 } }));
  assert.throws(() => archive({ ...progress(), migrated: 'false' }));
});

test('ledger fields have strict types, limits and signed amounts', () => {
  for (const patch of [
    { kind: 'unknown' }, { amount: true }, { amount: NaN }, { amount: 0.5 },
    { balance: -1 }, { balance: false }, { sessionId: 0 }, { reason: {} },
    { reason: '' }, { reason: '字'.repeat(2001) }, { unknown: 1 },
  ]) {
    const state = progress();
    state.ledger[0] = { ...state.ledger[0], ...patch };
    assert.throws(() => archive(state));
  }
  const missing = progress();
  delete missing.ledger[0].amount;
  assert.throws(() => archive(missing));
  assert.throws(() => archive({ ...progress(), ledger: Array.from({ length: 5001 }, () => progress().ledger[0]) }));
  assert.throws(() => archive({ ...progress(), ledger: new Array(2) }));
  const maximumReason = progress();
  maximumReason.ledger[0].reason = '字'.repeat(2000);
  assert.equal(roundtrip(archive(maximumReason)).progress.ledger[0].reason.length, 2000);
});

test('talent names, snapshot keys and fields cannot carry nested or oversized data', () => {
  for (const extraTalents of [[true], [''], [' '.repeat(2)], ['字'.repeat(201)], [{ name: '富有' }], new Array(2)]) {
    assert.throws(() => archive({ ...progress(), extraTalents }));
  }
  assert.throws(() => archive({ ...progress(), extraTalents: Array.from({ length: 1001 }, () => '富有') }));
  for (const patch of [
    { kind: 'bad' }, { validated: 'true' }, { archetype: true }, { age: {} },
    { attributeBudget: true }, { skillRemaining: Infinity }, { extra: 1 },
    { attributes: { ...attributes, A1: 2 } }, { skills: {} },
  ]) assert.throws(() => archive({ ...progress(), creation: { ...snapshot(), ...patch } }));
  const missing = snapshot();
  delete missing.age;
  assert.throws(() => archive({ ...progress(), creation: missing }));
});

test('object pollution, custom prototypes, symbols and accessors are rejected', () => {
  const polluted = JSON.parse('{"phase":"play","__proto__":{"polluted":true}}');
  assert.throws(() => archive(polluted));
  for (const field of ['constructor', 'prototype']) assert.throws(() => archive({ ...progress(), [field]: {} }));
  assert.throws(() => archive(Object.create({ xp: 999 })));
  assert.throws(() => archive({ ...progress(), [Symbol('hidden')]: 1 }));
  const accessor = progress();
  Object.defineProperty(accessor, 'xp', { get() { throw new Error('must not run'); }, enumerable: true });
  assert.throws(() => archive(accessor), /成长档案字段无效/);
  const pollutedLedger = progress();
  pollutedLedger.ledger[0] = JSON.parse('{"kind":"xp","amount":1,"balance":1,"reason":"x","sessionId":1,"__proto__":{}}');
  assert.throws(() => archive(pollutedLedger));
  const pollutedValues = JSON.parse('{"__proto__":{},"角色卡!A2":"调查员"}');
  assert.throws(() => createRuleCardData(workbook, pollutedValues, {}));
  assert.equal({}.polluted, undefined);
});
