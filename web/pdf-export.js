import { snapshotCharacter, createCharacterPdf } from './pdf-card.js';

let fontPromise;
async function loadFont() {
  if (!fontPromise) fontPromise = fetch(new URL('./fonts/NotoSansSC-Regular.ttf', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('PDF 中文字体加载失败，请检查网络后重试。');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { fontPromise = null; throw error; });
  return fontPromise;
}

export async function exportCharacterPdf(engine, rules) {
  const snapshot = snapshotCharacter(engine, rules);
  const result = await createCharacterPdf(snapshot, await loadFont());
  const blob = new Blob([result.bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `北欧奇谭-${String(snapshot.name ?? '').replace(/[\u0000-\u001f/\\:*?"<>|]/g, '').trim().slice(0, 80) || '新调查员'}-${snapshot.exportedDate}.pdf`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to finish handing off the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { pageCount: result.pageCount, warnings: result.warnings };
}
