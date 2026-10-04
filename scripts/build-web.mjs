import fs from 'node:fs/promises';
import path from 'node:path';
import { bundlePdf } from './bundle-pdf.mjs';
const root = path.resolve('web');
const dist = path.join(root, 'dist');
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
for (const entry of ['index.html', 'style.css', 'app.js', 'engine.js', 'rules-engine.js', 'rules-ui.js', 'storage.js', 'rule-storage.js', 'webmcp.js', 'data', 'fonts', 'favicon.svg']) {
  await fs.cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
await bundlePdf(path.join(dist, 'pdf-export.js'));
await fs.writeFile(path.join(dist, '.nojekyll'), '');
console.log('Built web/dist (static website with bundled PDF export).');
