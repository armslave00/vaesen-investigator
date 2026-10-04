import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('web');
const dist = path.join(root, 'dist');
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
for (const entry of ['index.html', 'style.css', 'app.js', 'engine.js', 'rules-engine.js', 'rules-ui.js', 'storage.js', 'rule-storage.js', 'webmcp.js', 'data', 'favicon.svg']) {
  await fs.cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
}
console.log('Built web/dist (static assets, no runtime dependencies).');
