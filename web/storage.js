export const CARD_FORMAT = 'vaesen-web-card';
export function createCardData(workbook, values) {
  return { format: CARD_FORMAT, version: 1, sourceSha256: workbook.source.sha256, values: { ...values } };
}
export function parseCardData(data, workbook) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('档案格式不正确');
  if (data.format !== CARD_FORMAT || data.version !== 1) throw new Error('请选择本网页导出的调查员档案');
  if (data.sourceSha256 !== workbook.source.sha256) throw new Error('档案对应的 Excel 版本不同，无法直接导入');
  if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values)) throw new Error('档案缺少角色信息');
  const allowed = new Set(workbook.controls.map(({ sheet, cell }) => `${sheet}!${cell}`));
  const values = {};
  for (const [key, value] of Object.entries(data.values)) {
    if (!allowed.has(key)) throw new Error(`档案包含不可编辑的单元格：${key}`);
    if (!(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))) throw new Error(`单元格 ${key} 的值无效`);
    if (typeof value === 'string' && value.length > 200000) throw new Error('单项文字超过允许长度');
    values[key] = value;
  }
  return values;
}
