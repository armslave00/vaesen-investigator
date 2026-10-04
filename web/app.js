import { RulesEngine } from './rules-engine.js';
import { RulesUI } from './rules-ui.js';
import { createRuleCardData, parseRuleCardData } from './rule-storage.js';
import { createCardData, parseCardData } from './storage.js';
import { registerCardTools } from './webmcp.js';

const CARD = '角色卡';
const STORAGE = 'vaesen-investigator-v2';
const $ = (selector) => document.querySelector(selector);
const escape = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let workbook, rules, engine, rulesUI;
let toastTimer;
const key = (address) => `${CARD}!${address}`;
const value = (address) => engine.get(CARD, address);
const literal = (sheet, address) => engine.get(sheet, address);
const show = (address) => escape(value(address));
function notify(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000); }
function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(createRuleCardData(workbook, engine.overrides, engine.progress))); $('#save-status').textContent = '已保存于此浏览器'; }
  catch { $('#save-status').textContent = '浏览器保存失败，请导出档案'; }
}
function input(address, label, { numeric = false, placeholder = '', list = '', textarea = false, className = '' } = {}) {
  // Excel cells can contain line breaks even when their original row is short.
  // A text input strips them, so retain an imported multiline value in a textarea.
  textarea ||= typeof value(address)==='string' && /[\r\n]/.test(value(address));
  const attrs = `id="cell-${address}" data-cell="${address}" maxlength="200000" aria-label="${escape(label)}" ${numeric ? 'inputmode="decimal" data-numeric="true"' : ''} ${list ? `list="${list}"` : ''}`;
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
  $('#resource-fields').innerHTML = output('A18', '初始资源') + field('C18', '资源加点', { numeric: true, hint: '每投入 1 点，消耗 1 点技能预算' }) + output('E18', '总资源') + output('C17', '生活标准') + field('F18', '资产余额覆盖', { numeric: true, hint: '可填已有余额；留空使用下方记账余额或规则标准资产' });
  if (!$('#resource-notice')) $('#resource-fields').insertAdjacentHTML('afterend', '<p class="validation-notice" id="resource-notice" hidden></p>');
  $('#profession-equipment').textContent = value('A36');
  update();
}
function extraFields() {
  const names = rules.talents.map(talent=>talent.name);
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
  $('#experience-fields').innerHTML = `<div class="experience-answer-list">${experience.map((col,index)=>`<div>${mark(`${col}18`,`经验 ${index+1}`,false)}<span>${index+1}. ${escape(rules.rules.xpQuestions.questions[index])}</span></div>`).join('')}</div>`;
  $('#story-fields').innerHTML = field('I2','动机',{textarea:true})+field('I5','创伤',{textarea:true})+field('I8','黑暗秘密',{textarea:true})+field('A5','外貌 / 肖像备注',{textarea:true})+
    `<div class="field"><span class="field-label">纪念物</span>${['U2','U3','U4'].map((address,index)=>select(address,`纪念物 ${index+1}`,engine.validationOptions(CARD,address))).join('')}</div>`+
    `<div class="field"><span class="field-label">优势</span>${['U6','U7','U8'].map((address,index)=>field(address,`优势 ${index+1}`)).join('')}</div>`+
    `<div class="field"><span class="field-label">洞察与缺陷</span>${['U15','U16','U17'].map((address,index)=>field(address,`洞察与缺陷 ${index+1}`)).join('')}</div>`+
    `<div class="field"><span class="field-label">关系</span>${[['K11','I12'],['K13','I14'],['K15','I16'],['K17','I18']].map(([name,description],index)=>`<div class="relationship-row">${field(name,`PC${index+1} 姓名`)}${field(description,`PC${index+1} 关系`)}</div>`).join('')}</div>`;
  $('#notes-fields').innerHTML = field('AE2','人物背景',{textarea:true,className:'notes-area'})+field('AE19','笔记',{textarea:true,className:'notes-area'});
  update();
}
function pageHeading(eyebrow,title,folio) { return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><span class="folio">资料 / ${folio}</span></div>`; }
function sourceLabel(item) { return escape(item.source?.label ?? ''); }
function referenceTables() {
  $('#talents').innerHTML = pageHeading('TALENTS','天赋表','02') + '<p class="lookup-intro">54 项基础天赋按本地中文规则书修正，另保留 3 项未核验扩展。情境加成只有本次满足条件时才适用。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>类别</th><th>天赋</th><th>说明与来源</th></tr></thead><tbody>${rules.talents.map(t=>`<tr><td><span class="category-chip">${escape(t.category)}</span></td><td>${escape(t.name)}${t.verified?'':'<small>扩展未核验</small>'}</td><td class="text-cell">${escape(t.description)}<small class="reference-caption">${sourceLabel(t)}</small>${(t.warnings??[]).map(w=>`<small class="validation-notice">${escape(w)}</small>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
  $('#assets').innerHTML = pageHeading('RESOURCES & EQUIPMENT','资源与装备表','03') + '<p class="lookup-intro">交易使用操控人心加生活标准奖励；常规购买投资源数量的骰子。资产是另行记账的可用余额。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>资源</th><th>生活标准</th><th>交易奖励</th><th>标准资产</th><th>说明</th></tr></thead><tbody>${rules.resources.map(r=>`<tr><td>${r.value}</td><td>${escape(r.name)}</td><td>${r.exchangeBonus>0?'+':''}${r.exchangeBonus}</td><td>${r.assets}</td><td class="text-cell">${escape(r.description)}</td></tr>`).join('')}</tbody></table></div><p class="reference-caption">原书 22、73 页 / PDF 26、77 页。资源表仅列出 1–8；超出表域不推造生活标准或资产数值。</p><h3 class="sub-heading">护甲</h3><table><thead><tr><th>护甲</th><th>防护骰</th><th>敏捷调整</th><th>可得性</th></tr></thead><tbody>${rules.armor.map(r=>`<tr><td>${escape(r.name)}</td><td>${r.protection}</td><td>${r.agility}</td><td>${r.availability}</td></tr>`).join('')}</tbody></table><h3 class="sub-heading">武器</h3><div class="table-scroll"><table class="lookup-table"><thead><tr><th>名称</th><th>伤害</th><th>范围</th><th>奖励骰</th><th>可得性</th><th>技能 / 来源</th></tr></thead><tbody>${rules.weapons.map(r=>`<tr><td>${escape(r.name)}</td><td>${r.damage}</td><td>${escape(r.range)}</td><td>${r.bonus}</td><td>${r.availability}</td><td>${escape(r.skills.join(' / '))}<small>${sourceLabel(r)}</small></td></tr>`).join('')}</tbody></table></div><h3 class="sub-heading">装备</h3><div class="table-scroll"><table class="lookup-table"><thead><tr><th>名称</th><th>奖励骰</th><th>可得性</th><th>效果 / 来源</th></tr></thead><tbody>${rules.equipment.map(r=>`<tr><td>${escape(r.name)}</td><td>${r.bonus}</td><td>${r.availability}</td><td class="text-cell">${escape(r.effect)}<small>${sourceLabel(r)}</small></td></tr>`).join('')}</tbody></table></div>`;
  $('#mementos').innerHTML = pageHeading('MEMENTOS','纪念物表','04') + '<p class="lookup-intro">D66 纪念物表。使用纪念物恢复一个状态需 GM 认可；修复或重获旧物可在经验面板花费 1 XP。</p>' + `<div class="table-scroll"><table class="lookup-table"><thead><tr><th>D66</th><th>纪念物</th></tr></thead><tbody>${Array.from({length:36},(_,i)=>{const row=i+2;return `<tr><td>${escape(literal('纪念物表',`A${row}`))}</td><td>${escape(literal('纪念物表',`B${row}`))}</td></tr>`}).join('')}</tbody></table></div><p class="reference-caption">纪念物表：原卡 A2:B37；使用与修复规则：原书 22 页 / PDF 26 页。</p>`;
  $('#audit').innerHTML = pageHeading('SOURCE & RULES','核验说明','05') + `<div class="audit-callout">此版本以仓库内《北欧奇谭规则书》中文文本为计算依据。原 Excel 自动卡及忠实复刻基线（Git ff4de6f）保留作对照。原卡 110 个输入栏与旧网页档案继续兼容。</div>
    <div class="audit-item"><h3>建卡与成长</h3><table><thead><tr><th>年龄</th><th>属性预算</th><th>技能预算</th></tr></thead><tbody><tr><td>青年（17–25）</td><td>15</td><td>10</td></tr><tr><td>中年（26–50）</td><td>14</td><td>12</td></tr><tr><td>老年（51+）</td><td>13</td><td>14</td></tr></tbody></table><p>常规建卡属性 2–4、主要属性至多 5；技能 0–2、主要技能至多 3。资源加点每点消耗 1 技能点，初始资源受泛型范围限制。完成建卡保存分配快照；5 XP 可使技能 +1（最多 5）或买一项天赋。富有每次增加 1 资源，允许重复购买，不再扣初始技能点。原书 18、20–25 页 / PDF 22、24–29 页。</p><p>旧成长角色或可选人生轨迹建卡的角色可显式转为成长档，原值保留；不会假定它们符合常规建卡下限。属性不提供 XP 升级按钮。</p></div>
    <div class="audit-item"><h3>骰池与状态</h3><p>技能骰池 = 属性 + 技能 + 本次适用奖励 − 对应普通状态，仍可行动时至少 1 骰。体能、精准扣物理状态，逻辑、共情扣精神状态；崩溃不作为第四个普通扣骰。物理崩溃所有检定自动失败；精神崩溃只允许受攻击时逃跑、格挡、闪避等获准行动，不能攻击或仪式。恐惧仅选逻辑或共情，加最多 3 名合格支持者，扣精神状态。勇敢 +1；其他天赋按文字条件确认。原书 38–43、63–64、68 页 / PDF 42–47、67–68、72 页。</p><p>武器奖励加入攻击骰池，伤害独立显示。护甲只对敏捷施加对应负调整，防护骰独立投掷。徒手力量攻击基础伤害 1，拳击手增伤 1，强硬如钉在适用时增加 2 骰。原书 73–77 页 / PDF 77–81 页。</p></div>
    <div class="audit-item"><h3>修正的资料差异</h3><ul class="audit-list">${rules.warnings.map(w=>`<li>${escape(w.message)} <small>${sourceLabel(w)}</small></li>`).join('')}<li>生活标准使用规则书的“小康”“大富豪”；“人多胆壮”旧名称作为“人多壮胆”的兼容别名。</li><li>联络人恢复 GM 可为谜题趣味否决的条件；情境奖励不会永久改写技能值。</li></ul></div>
    <div class="audit-item"><h3>译文与扩展边界</h3><p>应急医学按中文正文“医学检定无视状态”免除医学对应的物理状态；译注说明英文原文留下精神状态的矛盾且官方未勘误，这不是官方勘误。双手武器专精按正文“使用双武器”的条件，由玩家确认。吸血鬼猎人及三个天赋沿用 Excel 扩展数据，基础规则书无法核验。</p><p>资源表只有 1–8，未把 8 推定为规则硬上限；更高资源保留真实数值，生活标准、交易奖励和标准资产显示为未收录。资产消耗持续到下一谜题，中文恢复流程不完全明确，因此恢复标准资产必须显式执行。</p></div>
    <div class="audit-item"><h3>泛型资料</h3><div class="table-scroll"><table class="lookup-table"><thead><tr><th>泛型</th><th>建卡资源</th><th>主要属性</th><th>主要技能</th><th>来源</th></tr></thead><tbody>${rules.archetypes.map(r=>`<tr><td>${escape(r.name)}</td><td>${r.resourceMin}–${r.resourceMax}</td><td>${escape(r.mainAttribute)}</td><td>${escape(r.mainSkill)}</td><td>${sourceLabel(r)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="audit-item"><h3>保存与迁移</h3><p>自动保存于当前浏览器；导出 v2 档案保留所有原卡输入、成长快照、经验与资产账本、本场结算状态和新增天赋。v1 档案导入时保留输入和圆点，初始 XP 余额为 0；已有 XP 可在经验调整中记入。确认旧角色已成长后点击“将旧角色转为成长档”。本地预览与托管网址分别保存各自档案。</p></div>
    <details class="audit-item"><summary>查看原 Excel 公式（历史对照）</summary><div class="table-scroll"><table><thead><tr><th>单元格</th><th>原始公式</th></tr></thead><tbody>${Object.entries(workbook.sheets[0].cells).filter(([,cell])=>cell.formula).map(([address,cell])=>`<tr><td>${address}</td><td class="formula-line">${escape(cell.formula)}</td></tr>`).join('')}</tbody></table></div></details><p class="reference-caption">原始工作簿：${escape(workbook.source.filename)}<br>SHA-256：${escape(workbook.source.sha256)}</p>`;
}
function renderCard() { primaryFields(); extraFields(); rulesUI?.mount(); }
function update() {
  document.querySelectorAll('[data-output]').forEach((node) => {
    const result = value(node.dataset.output);
    node.textContent = result ?? '';
    node.classList.toggle('negative', typeof result === 'number' && result < 0);
    node.classList.toggle('formula-error', typeof result === 'string' && result.startsWith('#'));
    node.title = '按规则书核算；历史 Excel 公式可在核验说明中查看';
  });
  $('#character-heading').textContent = value('A2') || '新调查员';
  $('#profession-equipment').textContent = value('A36');
  const derived=engine.derived();
  document.querySelectorAll('[data-attribute]').forEach(node=>node.classList.toggle('key-attribute',node.dataset.attribute===derived.archetype?.mainAttribute));
  document.querySelectorAll('[data-skill]').forEach(node=>node.classList.toggle('key-skill',node.dataset.skill===derived.archetype?.mainSkill));
  const notice=$('#resource-notice');
  const resourceIssue=derived.validation.find(item=>['C18','E18'].includes(item.cell));
  notice.hidden=!resourceIssue;
  notice.textContent=resourceIssue?.message??'';
  document.querySelectorAll('[data-cell]').forEach(node=>{const issue=derived.validation.find(item=>item.cell===node.dataset.cell);node.setAttribute('aria-invalid',Boolean(issue));if(issue)node.title=issue.message;else node.removeAttribute('title');});
  if ($('#cell-A25')) {
    const node = $('#cell-A25'), current = value('A25'), options = engine.validationOptions(CARD, 'A25');
    node.innerHTML = '<option value="">请选择</option>' + [...new Set([...options, ...(current!==null && current!=='' ? [current] : [])])].map((option) => `<option value="${escape(option)}">${escape(option)}</option>`).join('');
    node.value = current ?? '';
    $('#talent-notice').hidden = derived.phase==='play' || !current || options.includes(current);
    for (const row of [25, 26, 27, 28]) {
      const description = $(`#cell-E${row}`);
      if (document.activeElement !== description) description.value = value(`E${row}`) ?? '';
      $(`[data-restore="E${row}"]`).hidden = !Object.hasOwn(engine.overrides, key(`E${row}`));
    }
  }
  rulesUI?.update();
}
async function start() {
  const responses=await Promise.all([fetch('./data/workbook.json'),fetch('./data/rules.json')]);
  if(responses.some(r=>!r.ok))throw new Error('角色或规则数据未能载入');
  [workbook,rules]=await Promise.all(responses.map(r=>r.json()));
  let saved={values:{},progress:{}},saveError=false;
  try {const data=JSON.parse(localStorage.getItem(STORAGE)||'null');if(data)saved=parseRuleCardData(data,workbook);}catch{saveError=true;}
  engine=new RulesEngine(workbook,rules,saved.values,saved.progress);
  rulesUI=new RulesUI({rules,getEngine:()=>engine,changed:(render)=>{if(render){renderCard();setupRestoreActions();}else update();persist();},notify});
  renderCard(); referenceTables();
  $('#loading').hidden = true; $('#card').hidden = false;
  const actual = new Set([...document.querySelectorAll('[data-cell]')].map(node => key(node.dataset.cell)));
  const missing = workbook.controls.filter(({sheet,cell}) => !actual.has(`${sheet}!${cell}`));
  if(missing.length) throw new Error(`缺少原卡输入栏：${missing.map(control=>control.cell).join('、')}`);
  setupArchiveActions();
  if(saveError)notify('保存的档案无法读取，请用已导出的档案导入；当前新卡尚未覆盖原保存。');
  else if(saved.migrated)notify('旧档案已载入：经验余额从 0 开始；已有经验可手动记入。');
  if(document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
    registerCardTools(document.modelContext, {
      read:()=>({archive:createRuleCardData(workbook,engine.overrides,engine.progress),calculations:engine.derived()}),
      update:(values)=>{
        const validated=parseCardData(createCardData(workbook,values),workbook);
        for(const [cell,next] of Object.entries(validated))engine.set(...cell.split('!'),next);
        renderCard();setupRestoreActions();persist();
        return {updatedCells:Object.keys(validated),calculations:engine.derived()};
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
    const data = createRuleCardData(workbook,engine.overrides,engine.progress);
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href=url;link.download=`北欧奇谭-${String(value('A2') || '新调查员').replace(/[\\/:*?"<>|]/g,'_')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('档案已导出');
  });
  $('#import-card').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async(event)=>{
    const file = event.target.files[0]; if(!file)return;
    try {
      const data = JSON.parse(await file.text());const saved = parseRuleCardData(data,workbook);
      engine=new RulesEngine(workbook,rules,saved.values,saved.progress);rulesUI.editOriginal=false;renderCard();setupRestoreActions();persist();notify('档案已导入');
    }catch(cause){notify(`导入失败：${cause.message}`);}finally{event.target.value='';}
  });
  $('#reset-card').addEventListener('click',()=>$('#reset-dialog').showModal());
  $('#cancel-reset').addEventListener('click',()=>$('#reset-dialog').close());
  $('#confirm-reset').addEventListener('click',()=>{engine=new RulesEngine(workbook,rules);rulesUI.editOriginal=false;renderCard();setupRestoreActions();persist();$('#reset-dialog').close();notify('当前档案已清空');});
}
function setupRestoreActions(){document.querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',()=>{engine.restore(CARD,button.dataset.restore);update();persist();}));}
start().catch((cause) => { $('#loading').textContent = `无法打开档案：${cause.message}。请重新载入页面。`; });
