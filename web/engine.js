// Evaluate the formulas extracted from the source workbook. The UI never owns
// point budgets or lookup values, and saved formula caches are not used here.
class ExcelError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const error = (code) => { throw new ExcelError(code); };
const number = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return error('#VALUE!');
};
const column = (text) => [...text.replaceAll('$', '').toUpperCase()].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
const letters = (n) => { let text = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) text = String.fromCharCode(65 + (n - 1) % 26) + text; return text; };
const addressParts = (address) => {
  const match = address.replaceAll('$', '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return error('#REF!');
  return { col: column(match[1]), row: Number(match[2]) };
};
export function rangeAddresses(range) {
  const [first, last = first] = range.replaceAll('$', '').split(':');
  const start = addressParts(first), end = addressParts(last), result = [];
  for (let row = start.row; row <= end.row; row++) {
    const cells = [];
    for (let col = start.col; col <= end.col; col++) cells.push(letters(col) + row);
    result.push(cells);
  }
  return result;
}
const normalized = (value) => typeof value === 'string' ? value.toLocaleLowerCase('en-US') : value;
function compare(left, right) {
  if (left === null) left = typeof right === 'string' ? '' : 0;
  if (right === null) right = typeof left === 'string' ? '' : 0;
  const order = (x) => typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2;
  if (typeof left !== typeof right) return order(left) - order(right);
  left = normalized(left); right = normalized(right);
  return left === right ? 0 : left > right ? 1 : -1;
}

// A small closed parser, deliberately limited to the workbook's Excel syntax.
// No eval / Function: arbitrary saved text can never execute JavaScript.
function parseFormula(formula) {
  const source = formula.replace(/^=/, '');
  let position = 0;
  const tokens = [];
  while (position < source.length) {
    const rest = source.slice(position);
    let match;
    if ((match = rest.match(/^\s+/))) { position += match[0].length; continue; }
    if ((match = rest.match(/^"((?:[^"]|"")*)"/))) tokens.push({ type: 'literal', value: match[1].replaceAll('""', '"') });
    else if ((match = rest.match(/^(?:(?:'((?:[^']|'')+)'|([^!(),+\-*/<>=:\s]+))!)?(\$?[A-Z]+\$?\d+)(?::(\$?[A-Z]+\$?\d+))?(?![A-Za-z0-9_])/i))) tokens.push({ type: 'ref', sheet: match[1]?.replaceAll("''", "'") ?? match[2], address: match[3], end: match[4] });
    else if ((match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?/))) tokens.push({ type: 'literal', value: Number(match[0]) });
    else if ((match = rest.match(/^(>=|<=|<>|[=><+\-*/(),])/))) tokens.push({ type: match[0] });
    else if ((match = rest.match(/^[^\s(),+\-*/<>=!:"]+/))) tokens.push({ type: 'name', value: match[0] });
    else throw new Error(`Unsupported formula token: ${rest}`);
    position += match[0].length;
  }
  tokens.push({ type: 'eof' });
  let index = 0;
  const peek = () => tokens[index];
  const take = (type) => { const token = tokens[index++]; if (type && token.type !== type) throw new Error(`Expected ${type} in ${formula}`); return token; };
  function atom() {
    if (peek().type === '-' || peek().type === '+') return { type: 'unary', op: take().type, child: atom() };
    if (peek().type === '(') { take('('); const result = expression(); take(')'); return result; }
    if (peek().type === 'literal' || peek().type === 'ref') return take();
    if (peek().type === 'name') {
      const name = take().value;
      if (peek().type !== '(') return { type: 'name', value: name };
      take('('); const args = [];
      if (peek().type !== ')') { args.push(expression()); while (peek().type === ',') { take(','); args.push(expression()); } }
      take(')'); return { type: 'call', name: name.replace(/^_xlfn\./i, '').toUpperCase(), args };
    }
    throw new Error(`Invalid formula: ${formula}`);
  }
  const level = (next, ops) => () => { let node = next(); while (ops.includes(peek().type)) node = { type: 'binary', op: take().type, left: node, right: next() }; return node; };
  const product = level(atom, ['*', '/']);
  const sum = level(product, ['+', '-']);
  const expression = level(sum, ['=', '<>', '>', '<', '>=', '<=']);
  const result = expression(); take('eof'); return result;
}

export class FormulaEngine {
  constructor(workbook, overrides = {}) {
    this.workbook = workbook;
    this.sheets = new Map(workbook.sheets.map((sheet) => [sheet.name, sheet]));
    this.names = new Map(workbook.definedNames.map(({ name, formula }) => [name, formula]));
    this.overrides = { ...overrides };
    this.cache = new Map(); this.ast = new Map(); this.active = new Set();
  }
  set(sheet, address, value) {
    this.overrides[`${sheet}!${address}`] = value;
    this.cache.clear();
  }
  restore(sheet, address) { delete this.overrides[`${sheet}!${address}`]; this.cache.clear(); }
  _read(sheet, address) {
    address = address.replaceAll('$', '').toUpperCase();
    const key = `${sheet}!${address}`;
    if (this.cache.has(key)) { const value = this.cache.get(key); if (value instanceof ExcelError) throw value; return value; }
    const cells = this.sheets.get(sheet)?.cells;
    if (!cells) return error('#REF!');
    if (Object.hasOwn(this.overrides, key)) {
      const value = this.overrides[key];
      // Clearing an ordinary input makes it an empty cell. An explicit override
      // of a description formula remains an intentionally empty string.
      return value === '' && !cells[address]?.formula ? null : value;
    }
    const cell = cells[address];
    if (!cell) return null;
    if (!cell.formula) { if (cell.type === 'e') return error(cell.value); return cell.value; }
    if (this.active.has(key)) return error('#REF!');
    this.active.add(key);
    try {
      const node = this._parse(cell.formula);
      let value = this._eval(node, sheet);
      if (value === null) value = 0; // Excel's direct reference to an empty cell.
      this.cache.set(key, value); return value;
    } catch (cause) {
      if (cause instanceof ExcelError) this.cache.set(key, cause);
      throw cause;
    } finally { this.active.delete(key); }
  }
  _parse(formula) { if (!this.ast.has(formula)) this.ast.set(formula, parseFormula(formula)); return this.ast.get(formula); }
  _eval(node, sheet) {
    if (node.type === 'literal') return node.value;
    if (node.type === 'ref') {
      const owner = node.sheet || sheet;
      if (!node.end) return this._read(owner, node.address);
      return rangeAddresses(`${node.address}:${node.end}`).map((row) => row.map((address) => this._read(owner, address)));
    }
    if (node.type === 'name') {
      if (node.value.toUpperCase() === 'TRUE') return true;
      if (node.value.toUpperCase() === 'FALSE') return false;
      const formula = this.names.get(node.value);
      if (!formula) return error('#NAME?');
      return this._eval(this._parse(formula), sheet);
    }
    if (node.type === 'unary') return number(this._eval(node.child, sheet)) * (node.op === '-' ? -1 : 1);
    if (node.type === 'binary') {
      const left = this._eval(node.left, sheet), right = this._eval(node.right, sheet);
      if (['=', '<>', '>', '<', '>=', '<='].includes(node.op)) {
        const diff = compare(left, right);
        return { '=': diff === 0, '<>': diff !== 0, '>': diff > 0, '<': diff < 0, '>=': diff >= 0, '<=': diff <= 0 }[node.op];
      }
      const a = number(left), b = number(right);
      if (node.op === '+') return a + b;
      if (node.op === '-') return a - b;
      if (node.op === '*') return a * b;
      if (node.op === '/') return b === 0 ? error('#DIV/0!') : a / b;
    }
    if (node.type === 'call') {
      const { args, name } = node;
      const evaluate = (index) => this._eval(args[index], sheet);
      if (name === 'IF') return evaluate(0) ? evaluate(1) : args.length > 2 ? evaluate(2) : false;
      if (name === 'IFERROR') { try { return evaluate(0); } catch (cause) { if (!(cause instanceof ExcelError)) throw cause; return evaluate(1); } }
      if (name === 'VLOOKUP') {
        const lookup = evaluate(0), rows = evaluate(1), index = number(evaluate(2));
        if (!Array.isArray(rows) || index < 1 || index > rows[0]?.length) return error('#REF!');
        if (args.length < 4 || evaluate(3) !== false) throw new Error('Only exact VLOOKUP is used in this workbook');
        const wildcard = typeof lookup === 'string' && /(?<!~)[*?]/.test(lookup);
        const pattern = wildcard ? new RegExp('^' + lookup.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~([*?~])|([*?])/g, (_, escaped, any) => escaped ? '\\' + escaped : any === '*' ? '.*' : '.') + '$', 'i') : null;
        const row = rows.find(([key]) => pattern ? typeof key === 'string' && pattern.test(key) : typeof key === typeof lookup && normalized(key) === normalized(lookup));
        if (!row) return error('#N/A');
        return row[index - 1] ?? 0;
      }
      if (name === 'SUM') {
        let total = 0;
        args.forEach((arg) => {
          const value = this._eval(arg, sheet);
          if (Array.isArray(value)) for (const item of value.flat()) { if (typeof item === 'number') total += item; }
          else if (arg.type === 'ref' || arg.type === 'name') { if (typeof value === 'number') total += value; }
          else total += number(value);
        });
        return total;
      }
      if (name === 'CONCAT') return args.map((arg) => this._eval(arg, sheet)).flat(Infinity).map((value) => value === null ? '' : typeof value === 'boolean' ? String(value).toUpperCase() : String(value)).join('');
      if (name === 'INDIRECT') {
        const target = evaluate(0);
        if (typeof target !== 'string' || !target) return error('#REF!');
        const named = this.names.get(target);
        if (named) return this._eval(this._parse(named), sheet);
        let reference;
        try { reference = this._parse(target); } catch { return error('#REF!'); }
        if (reference.type !== 'ref') return error('#REF!');
        return this._eval(reference, sheet);
      }
      throw new Error(`Unsupported function: ${name}`);
    }
    throw new Error('Unsupported expression');
  }
  get(sheet, address) { try { return this._read(sheet, address); } catch (cause) { if (cause instanceof ExcelError) return cause.code; throw cause; } }
  evaluate(sheet, formula) { try { return this._eval(this._parse(formula), sheet); } catch (cause) { if (cause instanceof ExcelError) return cause.code; throw cause; } }
  conditionalCells(sheet) {
    const result = new Set();
    for (const group of this.sheets.get(sheet)?.conditionalFormats || []) {
      if (group.rules.some(rule => rule.type === 'expression' && rule.formulas.some(formula => this.evaluate(sheet, formula) === true))) {
        for (const range of group.ranges) for (const row of rangeAddresses(range)) for (const address of row) result.add(address);
      }
    }
    return result;
  }
  calculateAll() {
    const result = {};
    for (const sheet of this.workbook.sheets) for (const [address, cell] of Object.entries(sheet.cells)) if (cell.formula) result[`${sheet.name}!${address}`] = this.get(sheet.name, address);
    return result;
  }
  validationOptions(sheet, address) {
    const point = addressParts(address);
    const validation = this.sheets.get(sheet)?.validations.find((rule) => rule.ranges.some((range) => {
      const [first, last = first] = range.split(':');
      const start = addressParts(first), end = addressParts(last);
      return point.row >= start.row && point.row <= end.row && point.col >= start.col && point.col <= end.col;
    }));
    if (!validation || validation.type !== 'list') return [];
    const formula = validation.formula1;
    if (formula.startsWith('"')) return formula.slice(1, -1).split(',');
    try {
      const value = this._eval(this._parse(formula), sheet);
      return (Array.isArray(value) ? value.flat() : [value]).filter((item) => item !== null && item !== '');
    } catch (cause) { if (cause instanceof ExcelError) return []; throw cause; }
  }
}
