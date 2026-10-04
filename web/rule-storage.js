import { CARD_FORMAT, createCardData, parseCardData } from './storage.js';
import { normalizeProgress } from './rules-engine.js';

export const RULE_CARD_VERSION = 2;
const MAX_LEDGER_ENTRIES = 5000;
const MAX_EXTRA_TALENTS = 1000;
const MAX_SHORT_TEXT = 2000;
const MAX_NAME_TEXT = 200;
const MAX_SOURCE_TEXT = 200000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PROGRESS_KEYS = ['phase', 'xp', 'assets', 'extraTalents', 'ledger', 'session', 'creation', 'migrated'];
const SNAPSHOT_KEYS = ['kind', 'validated', 'archetype', 'age', 'attributeBudget', 'skillBudget', 'attributes', 'skills', 'resourceBase', 'resourcePurchased', 'attributeRemaining', 'skillRemaining'];
const ATTRIBUTE_KEYS = ['D20', 'I20', 'N20', 'S20'];
const SKILL_KEYS = ['D21', 'D22', 'D23', 'I21', 'I22', 'I23', 'N21', 'N22', 'N23', 'S21', 'S22', 'S23'];

function fail(field) {
  throw new Error('成长档案字段无效：' + field);
}

function record(value, field, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(field);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key) || (allowed && !allowed.includes(key))) fail(field + '.' + String(key));
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(field + '.' + key);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(field + '.' + key);
}

function list(value, field, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail(field);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) fail(field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(field);
  }
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(field);
}

function text(value, field, maximum = MAX_SHORT_TEXT, nonempty = false) {
  if (typeof value !== 'string' || value.length > maximum || (nonempty && !value.trim())) fail(field);
}

function integer(value, field, minimum = Number.MIN_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(field);
}

function bool(value, field) {
  if (typeof value !== 'boolean') fail(field);
}

function scalar(value, field) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') return text(value, field, MAX_SOURCE_TEXT);
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field);
}

function nullableNumber(value, field) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) fail(field);
}

function validateSnapshot(snapshot) {
  if (snapshot === null) return;
  record(snapshot, 'creation', SNAPSHOT_KEYS, SNAPSHOT_KEYS);
  if (!['created', 'imported'].includes(snapshot.kind)) fail('creation.kind');
  bool(snapshot.validated, 'creation.validated');
  if (snapshot.archetype !== null) text(snapshot.archetype, 'creation.archetype', MAX_NAME_TEXT);
  scalar(snapshot.age, 'creation.age');
  scalar(snapshot.resourcePurchased, 'creation.resourcePurchased');
  for (const key of ['attributeBudget', 'skillBudget', 'resourceBase', 'attributeRemaining', 'skillRemaining']) {
    nullableNumber(snapshot[key], 'creation.' + key);
  }
  for (const [key, coordinates] of [['attributes', ATTRIBUTE_KEYS], ['skills', SKILL_KEYS]]) {
    record(snapshot[key], 'creation.' + key, coordinates, coordinates);
    for (const coordinate of coordinates) scalar(snapshot[key][coordinate], 'creation.' + key + '.' + coordinate);
  }
}

export function validateRuleProgress(progress) {
  record(progress, 'progress', PROGRESS_KEYS);
  if (Object.hasOwn(progress, 'phase') && !['creation', 'play'].includes(progress.phase)) fail('phase');
  if (Object.hasOwn(progress, 'xp')) integer(progress.xp, 'xp', 0);
  if (Object.hasOwn(progress, 'assets') && progress.assets !== null) integer(progress.assets, 'assets', 0);
  if (Object.hasOwn(progress, 'migrated')) bool(progress.migrated, 'migrated');
  if (Object.hasOwn(progress, 'extraTalents')) {
    list(progress.extraTalents, 'extraTalents', MAX_EXTRA_TALENTS);
    progress.extraTalents.forEach((name, index) => text(name, 'extraTalents.' + index, MAX_NAME_TEXT, true));
  }
  if (Object.hasOwn(progress, 'ledger')) {
    list(progress.ledger, 'ledger', MAX_LEDGER_ENTRIES);
    progress.ledger.forEach((entry, index) => {
      const field = 'ledger.' + index;
      const keys = ['kind', 'amount', 'balance', 'reason', 'sessionId'];
      record(entry, field, keys, keys);
      if (!['xp', 'assets'].includes(entry.kind)) fail(field + '.kind');
      integer(entry.amount, field + '.amount');
      integer(entry.balance, field + '.balance', 0);
      text(entry.reason, field + '.reason', MAX_SHORT_TEXT, true);
      integer(entry.sessionId, field + '.sessionId', 1);
    });
  }
  if (Object.hasOwn(progress, 'session')) {
    record(progress.session, 'session', ['id', 'settled']);
    if (Object.hasOwn(progress.session, 'id')) integer(progress.session.id, 'session.id', 1);
    if (Object.hasOwn(progress.session, 'settled')) bool(progress.session.settled, 'session.settled');
  }
  if (Object.hasOwn(progress, 'creation')) validateSnapshot(progress.creation);
  return progress;
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}

function normalized(progress) {
  validateRuleProgress(progress);
  const result = normalizeProgress(copy(progress));
  validateRuleProgress(result);
  return copy(result);
}

function legacyValues(workbook, values) {
  record(values, 'values');
  return parseCardData(createCardData(workbook, values), workbook);
}

export function createRuleCardData(workbook, values, progress = {}) {
  return {
    format: CARD_FORMAT, version: RULE_CARD_VERSION, sourceSha256: workbook.source.sha256,
    values: legacyValues(workbook, values), progress: normalized(progress),
  };
}

export function parseRuleCardData(data, workbook) {
  record(data, 'archive', ['format', 'version', 'sourceSha256', 'values', 'progress']);
  if (data.version === 1) {
    if (Object.hasOwn(data, 'progress')) fail('archive.progress');
    record(data.values, 'values');
    const values = legacyValues(workbook, parseCardData(data, workbook));
    const progress = normalized({ phase: 'creation', xp: 0, assets: null, extraTalents: [], ledger: [], session: { id: 1, settled: false }, creation: null, migrated: true });
    return { values, progress, migrated: true };
  }
  if (data.version !== RULE_CARD_VERSION || data.format !== CARD_FORMAT) throw new Error('请选择本网页导出的调查员档案');
  if (data.sourceSha256 !== workbook.source.sha256) throw new Error('档案对应的 Excel 版本不同，无法直接导入');
  if (!Object.hasOwn(data, 'progress')) throw new Error('档案缺少成长记录');
  const values = legacyValues(workbook, data.values);
  const progress = normalized(data.progress);
  return { values, progress, migrated: progress.migrated };
}
