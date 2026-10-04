import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

// Inspect the real build under a project-site URL. Module resolution is parsed
// by esbuild; literal fetch/font/HTML/CSS URLs must resolve inside the artifact.
const dist = path.resolve(process.argv[2] ?? 'web/dist');
const prefix = '/vaesen-investigator/';
const page = new URL(`https://example.invalid${prefix}`);
const checked = new Set();
const entries = [];

async function resource(reference, base) {
  if (!reference || reference.startsWith('#') || /^(?:https?:|data:|blob:|mailto:|tel:)/i.test(reference)) return;
  const url = new URL(reference, base);
  assert.equal(url.origin, page.origin, `Unexpected asset origin: ${reference}`);
  assert.ok(url.pathname.startsWith(prefix), `Asset escapes the project path: ${reference}`);
  const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(dist, relative);
  assert.ok(file.startsWith(`${dist}${path.sep}`), `Asset escapes the build: ${reference}`);
  assert.ok((await fs.stat(file)).isFile(), `Missing built resource: ${reference}`);
  checked.add(file);
  return file;
}

const html = await fs.readFile(path.join(dist, 'index.html'), 'utf8');
assert.ok(!/<base\b/i.test(html), 'Project-path inspection expects relative page URLs without a base element');
for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
  const file = await resource(match[1], page);
  if (file && /\.(?:js|css)$/i.test(file)) entries.push(file);
}
assert.ok(entries.length > 0, 'The built HTML has no script or stylesheet entry');

const analysis = await build({
  entryPoints: entries, bundle: true, platform: 'browser', format: 'esm',
  target: 'es2022', write: false, metafile: true, outdir: 'unused-pages-inspection',
  absWorkingDir: dist, logLevel: 'silent',
});
for (const output of Object.values(analysis.metafile.outputs)) {
  for (const dependency of output.imports) assert.ok(!dependency.external, `Built entry still needs an external import: ${dependency.path}`);
}
for (const input of Object.keys(analysis.metafile.inputs)) {
  const file = path.resolve(dist, input);
  assert.ok(file.startsWith(`${dist}${path.sep}`), `Browser module requires a file outside the artifact: ${input}`);
  const base = new URL(path.relative(dist, file).split(path.sep).join('/'), page);
  const source = await fs.readFile(file, 'utf8');
  if (/\.js$/i.test(file)) {
    for (const match of source.matchAll(/\bfetch\(\s*["']([^"']+)["']/g)) await resource(match[1], page);
    for (const match of source.matchAll(/\bnew\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) await resource(match[1], base);
  } else if (/\.css$/i.test(file)) {
    for (const match of source.matchAll(/\burl\(\s*["']?([^\s"')]+)["']?\s*\)/g)) await resource(match[1], base);
  }
  checked.add(file);
}
await fs.access(path.join(dist, '.nojekyll'));
console.log(`Pages build verified: ${checked.size} linked resources resolve under ${prefix}, with no module dependencies outside the artifact.`);
