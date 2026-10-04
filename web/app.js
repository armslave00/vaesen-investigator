import { FormulaEngine } from './engine.js';
import { createCardData, parseCardData } from './storage.js';
import { registerCardTools } from './webmcp.js';

const CARD = '角色卡';
const STORAGE = 'vaesen-investigator-v2';
const $ = (selector) => document.querySelector(selector);
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let workbook, engine;
let toastTimer;
const key = (address) => `${CARD}!${address}`;
const value = (address) => engine.get(CARD, address);
const literal = (sheet, address) => engine.get(sheet, address);
const show = (address) => escape(value(address));
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000); }
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(createCardData(workbook, engine.overrides))); $('#save-status').textContent = '已保存于此浏览器'; }
  catch { $('#save-status').textContent = '浏览器保存失败，请导出档案'; }
}
function input(address, label, { numeric = false, placeholder = '', list = '', textarea = false, className = '' } = {}) {
  // Excel cells can contain line breaks even when their original row is short.
  // A text input strips them, so retain an imported multiline value in a textarea.
  textarea ||= typeof value(address)==='string' && /[\r\n]/.test(value(address));
  const attrs = `id="cell-${address}" data-cell="${address}" aria-label="${escape(label)}" ${numeric ? 'inputmode="decimal" data-numeric="true"' : ''} ${list ? `list="${list}"` : ''}`;
  return textarea ? `<textarea ${attrs} class="${className}" placeholder="${escape(placeholder)}">${show(address)}</textarea>` : `<input ${attrs} type="text" class="${className}" value="${show(address)}" placeholder="${escape(placeholder)}" autocomplete="off">`;
}
function field(address, label, options = {}) {
  return `<label class="field ${options.className || ''}"><span class="field-label">${escape(label)}<span class="cell-ref">${address}</span></span>${input(address, label, options)}${options.hint ? `<span class="field-hint">${escape(options.hint)}</span>` : ''}</label>`;
}
function select(address, label, values) {
  const current = value(address);
  const options = [...values];
  if (current !== null && current !== '' && !options.includes(current)) options.push(current);
  return `<label class="field"><span class="field-label">${escape(label)}<span class="cell-ref">${address}</span></span><select id="cell-${address}" data-cell="${address}" aria-label="${escape(label)}"><option value="">请选择</option>${options.map((option) => `<option value="${escape(option)}" ${current === option ? 'selected' : ''}>${escape(option)}</option>`).join('')}</select></label>`;
}
function output(address, label, hint = '') {
  return `<div class="field"><span class="field-label">${escape(label)}<span class="cell-ref">${address}</span></span><output class="calculated" data-output="${address}" aria-label="${escape(label)}">${show(address)}</output>${hint ? `<span class="field-hint">${escape(hint)}</span>` : ''}</div>`;
}
function primaryFields() {
  $('#identity-fields').innerHTML = field('A2', '姓名', { placeholder: '调查员的姓名' }) + select('D15', '泛型', engine.validationOptions(CARD, 'D15')) + field('D16', '年龄', { numeric: true, placeholder: '岁' }) + field('A4', '玩家');
  $('#summary').innerHTML = [['F16', '年龄阶段', ''], ['P19', '剩余属性点', ''], ['T19', '剩余技能点', ''], ['E18', '总资源', '']].map(([address, label]) => `<div class="summary-item"><small>${label}</small><output data-output="${address}" aria-label="${label}">${show(address)}</output></div>`).join('');
  const attributes = [
    ['体能', 'D20', [['敏捷', 'D21'], ['近身战斗', 'D22'], ['力量', 'D23']]],
    ['精准', 'I20', [['医学', 'I21'], ['远程战斗', 'I22'], ['隐秘行动', 'I23']]],
    ['逻辑', 'N20', [['调查', 'N21'], ['学习', 'N22'], ['警觉', 'N23']]],
    ['共情', 'S20', [['启迪', 'S21'], ['操控人心', 'S22'], ['观察', 'S23']]],
  ];
  $('#attribute-fields').innerHTML = attributes.map(([name, address, skills]) => `<div class="attribute-group" data-attribute="${name}"><label class="attribute-label"><span>${name}</span>${input(address, name, { numeric: true })}</label>${skills.map(([skill, cell]) => `<label class="skill-row"><span data-skill="${skill}">${skill}</span>${input(cell, skill, { numeric: true })}</label>`).join('')}</div>`).join('');
  $('#resource-fields').innerHTML = output('A18', '初始资源') + field('C18', '资源加点', { numeric: true, hint: '每投入 1 点，消耗 1 点技能预算' }) + output('E18', '总资源') + output('C17', '生活标准') + field('F18', '资产', { numeric: true, hint: '与原卡相同，由玩家手填' });
  if (!$('#resource-notice')) $('#resource-fields').insertAdjacentHTML('afterend', '<p class="validation-notice" id="resource-notice" hidden></p>');
  $('#profession-equipment').textContent = value('A36');
  update();
}
function extraFields() {
  const names = [];
  for (let row = 2; row <= 58; row++) names.push(literal('天赋表', `B${row}`));
  const list = `<datalist id="all-talents">${names.map((name) => `<option value="${escape(name)}"></option>`).join('')}</datalist>`;
  $('#talent-fields').innerHTML = [25, 26, 27, 28].map((row, index) => `<div class="talent-row">${index === 0 ? select(`A${row}`, '职业天赋', engine.validationOptions(CARD, 'A25')) : field(`A${row}`, `天赋 ${index + 1}`, { list: 'all-talents', placeholder: '选择或填写天赋' })}<div class="description-wrapper">${field(`E${row}`, `天赋 ${index + 1} 说明`, { textarea: true, className: 'talent-description', placeholder: '选择天赋后自动显示，可手动修改' })}<button type="button" class="restore-description" data-restore="E${row}" hidden>恢复自动说明</button></div></div>`).join('') + list + '<p id="talent-notice" class="validation-notice" hidden>当前首项天赋不属于所选泛型。原卡切换泛型后保留已填天赋，请按需要重新选择。</p>';
  const tableInput = (address, label, numeric = false) => `<td>${input(address, label, { numeric,textarea:address.startsWith('E'),className:address.startsWith('E')?'table-textarea':'' })}</td>`;
  $('#equipment-fields').innerHTML = `<div class="table-scroll"><table class="equipment-table"><caption class="visually-hidden">六项装备</caption><thead><tr><th>装备</th><th class="description-cell">描述</th><th class="number-cell">加成</th></tr></thead><tbody>${[30,31,32,33,34,35].map((row,index) => `<tr>${tableInput(`A${row}`,`装备 ${index+1}`)}${tableInput(`E${row}`,`装备 ${index+1} 描述`)}${tableInput(`M${row}`,`装备 ${index+1} 加成`,true)}</tr>`).join('')}</tbody></table></div><div class="armor-row">${field('O30','护甲')}${field('AA30','防护',{numeric:true})}${field('AC30','护甲敏捷',{numeric:true})}</div><h4 class="sub-heading">武器</h4><div class="table-scroll"><table class="equipment-table weapon-table"><caption class="visually-hidden">四项武器</caption><thead><tr><th>武器</th><th>伤害</th><th>范围</th><th>加成</th><th>技能</th></tr></thead><tbody>${[32,33,34,35].map((row,index)=>`<tr>${tableInput(`O${row}`,`武器 ${index+1}`)}${tableInput(`V${row}`,`武器 ${index+1} 伤害`,true)}${tableInput(`X${row}`,`武器 ${index+1} 范围`)}${tableInput(`Z${row}`,`武器 ${index+1} 加成`,true)}${tableInput(`AB${row}`,`武器 ${index+1} 技能`)}</tr>`).join('')}</tbody></table></div>`;
  const mark = (address,label,visible=true) => {
    const current=value(address),choices=['○','●'];
    if(current!==null && current!=='' && !choices.includes(current)) choices.push(current);
    return `<label class="check-field"><select class="mark-select" id="cell-${address}" data-cell="${address}" aria-label="${escape(label)}"><option value="" ${current===null || current===''?'selected':''}>留空</option>${choices.map(choice=>`<option value="${escape(choice)}" ${current===choice?'selected':''}>${escape(choice)}</option>`).join('')}</select>${visible?escape(label):''}</label>`;
  };
  $('#condition-fields').innerHTML = [['物理','Y',['力竭','伤痕累累','创伤','崩溃']],['精神','AD',['愤怒','恐惧','绝望','崩溃']]].map(([name,col,labels]) => `<div class="condition-box"><div class="condition-title">${name}</div><div class="condition-list">${labels.map((label,index)=>mark(`${col}${index+10}`, `${name}${label}`)).join('')}</div></div>`).join('');
  const experience = ['W','X','Y','Z','AA','AB','AC','AD'];
  const questions = ['U19','U21','U22','U24','U25','U26','U27','U28'];
  $('#experience-fields').innerHTML = `<div class="experience-box"><span>经验</span>${experience.map((col,index)=>mark(`${col}18`,`经验 ${index+1}`,false)).join('')}</div><ol class="experience-questions">${questions.map((address)=>`<li>${escape(value(address).replace(/^\d+、/,''))}</li>`).join('')}</ol>`;
  $('#story-fields').innerHTML = field('I2','动机',{textarea:true})+field('I5','创伤',{textarea:true})+field('I8','黑暗秘密',{textarea:true})+field('A5','外貌 / 肖像备注',{textarea:true})+
    `<div class="field"><span class="field-label">纪念物</span>${['U2','U3','U4'].map((address,index)=>select(address,`纪念物 ${index+1}`,engine.validationOptions(CARD,address))).join('')}</div>`+
    `<div class="field"><span class="field-label">优势</span>${['U6','U7','U8'].map((address,index)=>field(address,`优势 ${index+1}`)).join('')}</div>`+
    `<div class="field"><span class="field-label">洞察与缺陷</span>${['U15','U16','U17'].map((address,index)=>field(address,`洞察与缺陷 ${index+1}`)).join('')}</div>`+
    `<div class="field"><span class="field-label">关系</span>${[['K11','I12'],['K13','I14'],['K15','I16'],['K17','I18']].map(([name,description],index)=>`<div class="relationship-row">${field(name,`PC${index+1} 姓名`)}${field(description,`PC${index+1} 关系`)}</div>`).join('')}</div>`;
  $('#notes-fields').innerHTML = field('AE2','人物背景',{textarea:true,className:'notes-area'})+field('AE19','笔记',{textarea:true,className:'notes-area'});
  update();
}
function pageHeading(eyebrow,title,folio) { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><span class="folio">资料 / ${folio}</span></div>`; }
function referenceTables() {
  let category = '';
  const talentRows = [];
  for (let row=2;row<=58;row++) { const label=literal('天赋表',`A${row}`); if(label!==null)category=label; talentRows.push(`<tr><td><span class="category-chip">${escape(category)}</span></td><td>${escape(literal('天赋表',`B${row}`))}</td><td class="text-cell">${escape(literal('天赋表',`C${row}`))}</td></tr>`); }
  $('#talents').innerHTML = pageHeading('TALENTS','天赋表','02') + '<p class="lookup-intro">职业天赋与通用天赋的完整原卡资料。选择角色卡中的天赋后，说明自动填入。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>类别</th><th>天赋</th><th>说明</th></tr></thead><tbody>${talentRows.join('')}</tbody></table></div><p class="reference-caption">来源：天赋表 A2:C58 · 57 项</p>`;
  $('#assets').innerHTML = pageHeading('RESOURCES','资产表','03') + '<p class="lookup-intro">总资源按 1–8 精确查找生活标准。角色卡中的“资产”保留手填方式。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>资源</th><th>生活标准</th><th>说明</th></tr></thead><tbody>${Array.from({length:8},(_,i)=>{const row=i+2;return `<tr><td>${escape(literal('资产表',`A${row}`))}</td><td>${escape(literal('资产表',`B${row}`))}</td><td class="text-cell">${escape(literal('资产表',`C${row}`))}</td></tr>`}).join('')}</tbody></table></div><p class="reference-caption">来源：资产表 A2:C9</p>`;
  $('#mementos').innerHTML = pageHeading('MEMENTOS','纪念物表','04') + '<p class="lookup-intro">D66 纪念物表。原卡提供三个独立选择栏，均保留在角色卡的“故事与关系”中。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>D66</th><th>纪念物</th></tr></thead><tbody>${Array.from({length:36},(_,i)=>{const row=i+2;return `<tr><td>${escape(literal('纪念物表',`A${row}`))}</td><td>${escape(literal('纪念物表',`B${row}`))}</td></tr>`}).join('')}</tbody></table></div><p class="reference-caption">来源：纪念物表 A2:B37</p>`;
  $('#audit').innerHTML = pageHeading('SOURCE & RULES','核验说明','05') + `<div class="audit-callout">本网页以拂晓鵺啼 Excel 自动卡 v2.0 为计算依据。原卡公式、查表文字与空白行为保持一致；规则书用于交叉核验。</div>
    <div class="audit-item"><h3>年龄与点数</h3><table><thead><tr><th>年龄</th><th>属性预算</th><th>技能预算</th></tr></thead><tbody><tr><td>青年（17–25）</td><td>15</td><td>10</td></tr><tr><td>中年（26–50）</td><td>14</td><td>12</td></tr><tr><td>老年（51+）</td><td>13</td><td>14</td></tr></tbody></table><p>资源加点与 12 项技能共用技能预算。超支后的剩余点数保留负值。年龄留空或低于 17 时，年龄为“年龄错误”，剩余点数为 #N/A，与原表相同。规则书：原书 18、20–21 页，PDF 22、24–25 页。</p></div>
    <div class="audit-item"><h3>原卡的计算范围</h3><p>自动处理年龄阶段、剩余属性与技能点、初始及总资源、生活标准、天赋说明与职业装备提示。状态、经验、资产、护甲与武器均由玩家手填。选择“富有”只显示原卡说明，资源公式仍为初始资源 + 资源加点。天赋说明可以手动修改，再用“恢复自动说明”恢复查表。</p></div>
    <div class="audit-item"><h3>与基础规则书的差异</h3><ul class="audit-list"><li>牧师资源上限：Excel 为 5，规则书为 6（原书 31 页 / PDF 35 页）；本网页保留 5。</li><li>仆人主要技能：辅助表写“蛮力”，角色卡与规则书称“力量”；定位时对应到力量。</li><li>学者与流浪者装备中的“液体”：规则书写“烈酒”；提示文字保留原表。</li><li>资源 6、8 的生活标准保留原表“殷实”“富得流油”；规则书对应“小康”“大富豪”。</li><li>“联络人”说明：原卡省略了 GM 可以因谜题趣味否决的条件；网页保留原卡说明。</li><li>吸血鬼猎人来自《喀尔巴阡》扩展；现有基础规则书未收录，数值保留原卡，无法独立核验。</li><li>吸血鬼猎人的资源超限红字提示原表遗漏该行；本网页保留这一提示范围。全部数值仍按原公式计算。</li></ul></div>
    <div class="audit-item"><h3>范型原始资料</h3><div class="table-scroll"><table class="lookup-table"><thead><tr><th>泛型</th><th>资源范围</th><th>主要属性</th><th>主要技能（原文）</th></tr></thead><tbody>${Array.from({length:11},(_,i)=>{const row=i+2;return `<tr><td>${escape(literal('辅助表',`A${row}`))}</td><td>${literal('辅助表',`B${row}`)}–${literal('辅助表',`C${row}`)}</td><td>${escape(literal('辅助表',`G${row}`))}</td><td>${escape(literal('辅助表',`H${row}`))}</td></tr>`}).join('')}</tbody></table></div></div>
    <div class="audit-item"><h3>保存与迁移</h3><p>输入会自动保存于当前浏览器。导出档案可保留所有输入、独立圆点和天赋说明的手动覆盖，导入后继续填写。更换设备前请导出；导入只接受相同 Excel 版本的网页档案。浏览器本地预览与托管网址分别保存各自的档案。</p></div>
    <details class="audit-item"><summary>查看原卡公式与更新记录</summary><div class="table-scroll"><table><thead><tr><th>单元格</th><th>公式</th></tr></thead><tbody>${Object.entries(workbook.sheets[0].cells).filter(([,cell])=>cell.formula).map(([address,cell])=>`<tr><td>${address}</td><td class="formula-line">${escape(cell.formula)}</td></tr>`).join('')}</tbody></table></div><h4 class="sub-heading">原卡更新记录</h4><table><tbody>${Array.from({length:8},(_,i)=>`<tr>${['A','B','C'].map(col=>`<td class="text-cell">${escape(literal('更新记录',`${col}${i+1}`))}</td>`).join('')}</tr>`).join('')}</tbody></table></details><p class="reference-caption">原始工作簿：${escape(workbook.source.filename)}<br>SHA-256：${escape(workbook.source.sha256)}</p>`;
}
function renderCard() { primaryFields(); extraFields(); }
function update() {
  document.querySelectorAll('[data-output]').forEach((node) => {
    const result = value(node.dataset.output);
    node.textContent = result ?? '';
    node.classList.toggle('negative', typeof result === 'number' && result < 0);
    node.classList.toggle('formula-error', typeof result === 'string' && result.startsWith('#'));
    node.title = workbook.sheets[0].cells[node.dataset.output]?.formula || '';
  });
  $('#character-heading').textContent = value('A2') || '新调查员';
  $('#profession-equipment').textContent = value('A36');
  const formatted = engine.conditionalCells(CARD);
  const attributeLabels = {'体能':'A20','精准':'F20','逻辑':'K20','共情':'P20'};
  const skillLabels = {'敏捷':'A21','近身战斗':'A22','力量':'A23','医学':'F21','远程战斗':'F22','隐秘行动':'F23','调查':'K21','学习':'K22','警觉':'K23','启迪':'P21','操控人心':'P22','观察':'P23'};
  document.querySelectorAll('[data-attribute]').forEach((node) => node.classList.toggle('key-attribute', formatted.has(attributeLabels[node.dataset.attribute])));
  document.querySelectorAll('[data-skill]').forEach((node) => node.classList.toggle('key-skill', formatted.has(skillLabels[node.dataset.skill])));
  const notice = $('#resource-notice');
  // Reproduce the original conditional-format lookup A2:C11, including its
  // omission of the extension archetype at row 12. Never clamp the input.
  const overLimit = formatted.has('E18');
  notice.hidden = !overLimit;
  if (overLimit) notice.textContent = typeof value('E18')==='number' ? `总资源超过原卡中${value('D15')}的上限 ${engine.evaluate(CARD,'VLOOKUP($D$15,辅助表!$A$2:$C$11,3,FALSE)')}。原值保留。` : '资源输入触发了原卡的红字提示，请检查资源加点。原值保留。';
  document.querySelectorAll('[data-output="E18"]').forEach(node=>node.classList.toggle('negative',overLimit));
  if ($('#cell-A25')) {
    const node = $('#cell-A25'), current = value('A25'), options = engine.validationOptions(CARD, 'A25');
    node.innerHTML = '<option value="">请选择</option>' + [...new Set([...options, ...(current!==null && current!=='' ? [current] : [])])].map((option) => `<option value="${escape(option)}">${escape(option)}</option>`).join('');
    node.value = current ?? '';
    $('#talent-notice').hidden = !current || options.includes(current);
    for (const row of [25, 26, 27, 28]) {
      const description = $(`#cell-E${row}`);
      if (document.activeElement !== description) description.value = value(`E${row}`) ?? '';
      $(`[data-restore="E${row}"]`).hidden = !Object.hasOwn(engine.overrides, key(`E${row}`));
    }
  }
}
async function start() {
  const response = await fetch('./data/workbook.json');
  if (!response.ok) throw new Error('工作簿数据未能载入');
  workbook = await response.json();
  let saved = {};
  try { const data = JSON.parse(localStorage.getItem(STORAGE) || 'null'); if(data) saved = parseCardData(data,workbook); } catch { /* A fresh card still works when browser storage is unavailable. */ }
  engine = new FormulaEngine(workbook, saved);
  renderCard(); referenceTables();
  $('#loading').hidden = true; $('#card').hidden = false;
  const actual = new Set([...document.querySelectorAll('[data-cell]')].map(node => key(node.dataset.cell)));
  const missing = workbook.controls.filter(({sheet,cell}) => !actual.has(`${sheet}!${cell}`));
  if(missing.length) throw new Error(`缺少原卡输入栏：${missing.map(control=>control.cell).join('、')}`);
  setupArchiveActions();
  if(document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
    registerCardTools(document.modelContext, {
      read:()=>({archive:createCardData(workbook,engine.overrides),calculations:engine.calculateAll()}),
      update:(values)=>{
        const validated=parseCardData(createCardData(workbook,values),workbook);
        for(const [cell,next] of Object.entries(validated))engine.set(...cell.split('!'),next);
        renderCard();setupRestoreActions();persist();
        return {updatedCells:Object.keys(validated),calculations:engine.calculateAll()};
      },
    }, lifecycle.signal).catch(()=>{/* Unsupported registration does not affect the character card. */});
  }
}
document.addEventListener('input', (event) => {
  const node = event.target;
  if (!node.dataset.cell || node.type === 'checkbox' || node.tagName === 'SELECT') return;
  const text = node.value;
  const next = node.dataset.numeric && text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text === '' ? (workbook.sheets[0].cells[node.dataset.cell]?.formula ? '' : null) : text;
  engine.set(CARD, node.dataset.cell, next); update(); persist();
});
document.addEventListener('change', (event) => {
  const node = event.target;
  if (!node.dataset.cell) return;
  if (node.tagName === 'SELECT' || node.type === 'checkbox') {
    engine.set(CARD, node.dataset.cell, node.type === 'checkbox' ? (node.checked ? '●' : '○') : node.value || null);
    update(); persist();
  }
});
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== button.dataset.tab; });
  document.querySelectorAll('[data-tab]').forEach((item) => { item.classList.toggle('active', item === button); item === button ? item.setAttribute('aria-current', 'page') : item.removeAttribute('aria-current'); });
  window.scrollTo({ top: 0, behavior: 'instant' }); $('#main-content').focus({ preventScroll: true });
}));
function setupArchiveActions() {
  document.querySelectorAll('[data-restore]').forEach(button => button.addEventListener('click',()=>{engine.restore(CARD,button.dataset.restore);update();persist();}));
  $('#export-card').addEventListener('click',()=>{
    const data = createCardData(workbook,engine.overrides);
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href=url;link.download=`北欧奇谭-${String(value('A2') || '新调查员').replace(/[\\/:*?"<>|]/g,'_')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('档案已导出');
  });
  $('#import-card').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async(event)=>{
    const file = event.target.files[0]; if(!file)return;
    try {
      if(file.size>5000000)throw new Error('档案超过 5 MB');
      const data = JSON.parse(await file.text());const values = parseCardData(data,workbook);
      engine=new FormulaEngine(workbook,values);renderCard();setupRestoreActions();persist();notify('档案已导入');
    }catch(cause){notify(`导入失败：${cause.message}`);}finally{event.target.value='';}
  });
  $('#reset-card').addEventListener('click',()=>$('#reset-dialog').showModal());
  $('#cancel-reset').addEventListener('click',()=>$('#reset-dialog').close());
  $('#confirm-reset').addEventListener('click',()=>{engine=new FormulaEngine(workbook);renderCard();setupRestoreActions();persist();$('#reset-dialog').close();notify('当前档案已清空');});
}
function setupRestoreActions(){document.querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',()=>{engine.restore(CARD,button.dataset.restore);update();persist();}));}
start().catch((cause) => { $('#loading').textContent = `无法打开档案：${cause.message}。请重新载入页面。`; });
