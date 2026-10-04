import { ATTRIBUTES, SKILLS } from './rules-engine.js';
const CARD = '角色卡';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const option = (value,label=value) => `<option value="${escape(value)}">${escape(label)}</option>`;
const stat = (id,label) => `<div><small>${label}</small><output id="${id}">—</output></div>`;
const numberField = (id,label,value=0) => `<label class="field"><span>${label}</span><input id="${id}" type="number" step="1" value="${value}"></label>`;
const toggle = (id,label) => `<label class="rule-toggle"><input id="${id}" type="checkbox"><span>${label}</span></label>`;
const manualTypes = new Set(['diceBonus','ignoreConditions','damageBonus','specialAttack']);

// The controls delegate all character mutations and arithmetic to RulesEngine.
export class RulesUI {
  constructor({rules,getEngine,changed,notify}) {
    Object.assign(this,{rules,getEngine,changed,notify});
    this.editOriginal = false;
    this.rollSettings = {kind:'skill',skill:'敏捷',action:'normal',fearAttribute:'逻辑',help:0,manualModifier:0,armor:false,unarmed:false,advantage:false,exchange:false,weaponRow:null,equipmentRows:[],talents:[]};
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-rule-action]');
      if(action) this.act(action.dataset.ruleAction);
    });
    document.addEventListener('input', event => {
      if(event.target.closest('#roll-fields') && event.target.tagName !== 'SELECT') this.readRoll();
    });
    document.addEventListener('change', event => {
      if(event.target.id === 'edit-original') {this.editOriginal=event.target.checked;this.updateLocks();}
      if(event.target.closest('#roll-fields')) this.readRoll();
      if(event.target.id === 'preset-kind') this.updatePreset();
    });
  }
  get engine(){return this.getEngine();}
  mount() {
    $('#creation-tools').innerHTML = `<div class="rules-status"><strong id="phase-label">建卡中</strong><span id="creation-budget"></span></div><div id="creation-validation" role="status"></div><div class="rule-actions"><button data-rule-action="complete">完成建卡</button><button class="quiet-action" data-rule-action="adopt">将旧角色转为成长档</button>${toggle('edit-original','修订原始数值')}</div><p class="field-hint" id="phase-hint"></p>`;
    $('#asset-tools').innerHTML = `<div class="rule-stats">${stat('standard-assets','规则标准资产')}${stat('current-assets','当前可用资产')}${stat('exchange-bonus','交易奖励')}${stat('resource-dice','资源检定骰数')}</div><div class="compact-form">${numberField('asset-amount','资产点数',1)}<label class="field"><span>记账原因</span><input id="asset-reason" placeholder="购买装备 / 资源检定收入"></label><button data-rule-action="asset-spend">支出资产</button><button data-rule-action="asset-add">增加资产</button><button data-rule-action="asset-reset">按标准恢复资产</button></div><p class="field-hint">支出只改变当前资产。标准资产和永久资源不会扣减；新谜题的恢复需明确点击。对抗交易不能直接使用资产。</p>`;
    $('#equipment-fields').insertAdjacentHTML('beforeend', `<details class="preset-panel"><summary>从规则表套用装备、武器或护甲</summary><p class="field-hint">选择要填入的栏位；套用会替换该栏已有内容。装备的情景效果需在检定助手中确认。</p><div class="compact-form"><label class="field"><span>类型</span><select id="preset-kind">${option('equipment','装备')}${option('weapon','武器')}${option('armor','护甲')}</select></label><label class="field"><span>规则条目</span><select id="preset-name"></select></label><label class="field"><span>填入栏位</span><select id="preset-row"></select></label><button data-rule-action="preset">套用条目</button></div><p id="preset-source" class="field-hint"></p></details>`);
    $('#roll-fields').innerHTML = `<div class="roll-grid"><label class="field"><span>检定类型</span><select id="roll-kind">${option('skill','技能检定')}${option('fear','恐惧检定')}</select></label><label class="field" id="skill-choice"><span>本次使用技能</span><select id="roll-skill">${SKILLS.map(skill=>option(skill.name)).join('')}</select></label><label class="field" id="fear-choice" hidden><span>恐惧属性</span><select id="roll-fear-attribute">${option('逻辑')}${option('共情')}</select></label><label class="field"><span>行动</span><select id="roll-action">${[['normal','一般行动'],['attack','攻击'],['ritual','仪式'],['flee','受攻击时逃跑'],['parry','受攻击时格挡'],['dodge','受攻击时闪避'],['move','移动']].map(([v,l])=>option(v,l)).join('')}</select></label>${numberField('roll-help','有效帮助 / 合格支持者',0)}${numberField('roll-modifier','其他调整（可为负）',0)}<label class="field" id="weapon-choice"><span>本次武器</span><select id="roll-weapon">${option('','未使用武器')}</select></label></div><div class="rule-checks">${toggle('roll-armor','已穿戴护甲（仅敏捷扣骰）')}${toggle('roll-unarmed','本次徒手攻击')}${toggle('roll-advantage','使用已获得的优势 +2')}${toggle('roll-exchange','操控人心交易：加入生活标准奖励')}</div><details class="roll-options"><summary>本次使用的装备与情境天赋</summary><div id="roll-equipment" class="rule-checks"></div><div id="roll-talents" class="rule-checks"></div><p class="field-hint">只勾选本次动作实际使用且满足文字条件的项。替代技能需在上方直接选择替代后的技能；次数、目标和 GM 裁定由玩家确认。</p></details><div class="roll-result" aria-live="polite"><strong id="roll-pool">—</strong><div><p id="roll-reason"></p><div id="roll-terms"></div><p id="roll-damage"></p></div></div><div id="roll-warnings" class="field-hint"></div><div class="roll-grid fear-result" id="fear-result" hidden>${numberField('fear-rating','恐惧值',1)}${numberField('fear-successes','已骰成功数',0)}<p id="fear-conditions"></p></div><p class="field-hint">每枚 D6 的 6 是成功。这里只预览，不自动消耗优势或更改状态。优势每场可用一次；孤注一掷每行动一次，保留 6，新状态在重投后生效。防护另投保护值数量的骰，每个成功抵消 1 伤害；不适用于爆炸或坠落。</p>`;
    $('#growth-fields').innerHTML = `<div class="rule-stats">${stat('xp-balance','可用经验')}${stat('xp-pending','本场待结算')}${stat('session-id','场次')}</div><div class="rule-actions"><button data-rule-action="settle">结算本场经验</button><button data-rule-action="session">开始下一场</button></div><p id="xp-hint" class="field-hint"></p><div class="growth-grid"><div><h4>提升技能 · 5 XP</h4><div class="compact-form"><label class="field"><span>技能</span><select id="buy-skill">${SKILLS.map(s=>option(s.cell,s.name)).join('')}</select></label><button data-rule-action="buy-skill">提升一级</button></div></div><div><h4>购买天赋 · 5 XP</h4><div class="compact-form"><label class="field"><span>天赋</span><select id="buy-talent">${this.rules.talents.map(t=>option(t.name,`${t.name}${t.verified?'':'（扩展未核验）'}`)).join('')}</select></label><button data-rule-action="buy-talent">购买天赋</button></div></div></div><details class="ledger-panel"><summary>经验调整、纪念物与记账记录</summary><p class="field-hint">旧档案没有总经验余额；请在这里记录其已有经验。修复或重获旧纪念物消耗 1 XP。</p><div class="compact-form">${numberField('xp-adjustment','经验增减（正负整数）',0)}<label class="field"><span>原因</span><input id="xp-reason" placeholder="导入已有经验 / 其他规则支出"></label><button data-rule-action="xp-adjust">记录经验调整</button><button data-rule-action="memento">修复纪念物 · 1 XP</button></div><ol id="ledger-list"></ol></details>`;
    this.updatePreset();
    this.restoreRoll();
    this.update();
  }
  updatePreset() {
    const kind=$('#preset-kind').value;
    const items=kind==='weapon'?this.rules.weapons:kind==='armor'?this.rules.armor:this.rules.equipment;
    $('#preset-name').innerHTML=items.map(item=>option(item.name)).join('');
    const rows=kind==='weapon'?[32,33,34,35]:kind==='armor'?[30]:[30,31,32,33,34,35];
    $('#preset-row').innerHTML=rows.map((row,i)=>option(row,kind==='armor'?'护甲栏':`${i+1} 号栏`)).join('');
    $('#preset-source').textContent='来源：规则书原书 73–77 页 / PDF 77–81 页。可得性是购买所需成功数，不能加进骰池。';
  }
  updateLocks() {
    const play=this.engine.derived().phase==='play';
    const cells=['D15','D16','C18',...ATTRIBUTES.map(a=>a.cell),...SKILLS.map(s=>s.cell),'A25','A26','A27','A28'];
    for(const cell of cells){const node=$(`#cell-${cell}`);if(!node)continue; const locked=play&&!this.editOriginal; if(node.tagName==='SELECT')node.disabled=locked;else node.readOnly=locked;node.classList.toggle('locked-field',locked);}
    $('#edit-original').closest('label').hidden=!play;
    $('#edit-original').checked=this.editOriginal;
  }
  update() {
    if(!$('#phase-label'))return;
    const d=this.engine.derived();
    $('#phase-label').textContent=d.phase==='play'?'成长档案':'常规建卡';
    $('#creation-budget').textContent=`主要属性：${d.archetype?.mainAttribute??'—'} · 主要技能：${d.archetype?.mainSkill??'—'}`;
    $('#phase-hint').textContent=d.phase==='creation'?'按年龄分配全部点数：属性至少 2、通常至多 4（主要属性 5）；技能通常至多 2（主要技能 3）。选好一项职业天赋后完成建卡。已成长或使用可选人生轨迹规则的旧角色可直接转为成长档。':this.engine.progress.creation?.validated?'建卡分配已留档。后续技能和天赋通过经验购买；成长不会再消耗初始技能点。修订原始数值可用于 GM 批准的调整。':'这是显式采纳的旧成长角色，保留原值；其原始分配未被宣称符合常规建卡。';
    $('#creation-validation').innerHTML=(d.validation.length?`<details ${d.phase==='creation'?'open':''}><summary>待核对 ${d.validation.length} 项</summary><ul>${d.validation.map(v=>`<li>${escape(v.message)}</li>`).join('')}</ul></details>`:'<p class="valid-message">当前数值校验通过</p>')+d.warnings.map(w=>`<p class="field-hint">${escape(w)}</p>`).join('');
    $('[data-rule-action="complete"]').hidden=d.phase!=='creation';
    $('[data-rule-action="adopt"]').hidden=d.phase!=='creation';
    const format=n=>Number.isFinite(n)?n:'—';
    $('#standard-assets').textContent=format(d.standardAssets);
    $('#current-assets').textContent=format(d.currentAssets);
    $('#exchange-bonus').textContent=Number.isFinite(d.exchangeBonus)?`${d.exchangeBonus>0?'+':''}${d.exchangeBonus}`:'—';
    $('#resource-dice').textContent=Number.isInteger(d.resource)&&d.resource>0?`${d.resource} D6`:'—';
    $('#xp-balance').textContent=d.xp;
    $('#xp-pending').textContent=d.sessionSettled?'已结算':`${d.pendingXP} XP`;
    $('#session-id').textContent=this.engine.progress.session.id;
    $('#xp-hint').textContent=d.sessionSettled?'本场已经入账，不能重复结算。开始下一场会清除本场回答；经验余额保留。':'圆点代表本场八题的回答。每个“是”给 1 XP，参与至少计 1 XP；结算后才能用于成长。';
    $('[data-rule-action="settle"]').disabled=d.phase!=='play'||d.sessionSettled;
    $('[data-rule-action="session"]').disabled=d.phase!=='play'||!d.sessionSettled;
    for(const action of ['buy-skill','buy-talent','memento'])$(`[data-rule-action="${action}"]`).disabled=d.phase!=='play'||d.xp<(action==='memento'?1:5);
    for(const col of ['W','X','Y','Z','AA','AB','AC','AD'])$(`#cell-${col}18`).disabled=d.sessionSettled;
    $('#extra-talents').innerHTML=d.extraTalents.map((name,i)=>{const t=this.rules.talents.find(t=>t.name===name);return `<div class="purchased-talent"><strong>${escape(name)} <small>成长购买 ${i+1}${t?.verified?'':' · 扩展未核验'}</small></strong><p>${escape(t?.description??'')}</p></div>`;}).join('');
    const ledger=this.engine.progress.ledger;
    $('#ledger-list').innerHTML=ledger.length?[...ledger].reverse().map(item=>`<li><span>第 ${item.sessionId} 场 · ${item.kind==='xp'?'经验':'资产'} ${item.amount>0?'+':''}${item.amount}</span> ${escape(item.reason)} <small>余额 ${item.balance}</small></li>`).join(''):'<li class="field-hint">尚无记账记录</li>';
    this.updateLocks();
    this.updateRollOptions();
    this.previewRoll();
  }
  updateRollOptions() {
    const settings=this.rollSettings;
    const weapons=[32,33,34,35].filter(row=>this.engine.get(CARD,`O${row}`));
    $('#roll-weapon').innerHTML=option('','未使用武器')+weapons.map((row,i)=>option(row,`${i+1} · ${this.engine.get(CARD,`O${row}`)}`)).join('');
    if(!weapons.includes(settings.weaponRow))settings.weaponRow=null;
    $('#roll-weapon').value=settings.weaponRow??'';
    const equipment=[30,31,32,33,34,35].filter(row=>this.engine.get(CARD,`A${row}`));
    settings.equipmentRows=settings.equipmentRows.filter(row=>equipment.includes(row));
    $('#roll-equipment').innerHTML=equipment.length?equipment.map(row=>`<label class="rule-toggle"><input type="checkbox" data-roll-equipment="${row}" ${settings.equipmentRows.includes(row)?'checked':''}><span>${escape(this.engine.get(CARD,`A${row}`))} <small>${escape(this.engine.get(CARD,`E${row}`))}</small></span></label>`).join(''):'<p class="field-hint">填入装备后可在这里选择本次使用项。</p>';
    const owned=new Set(this.engine.derived().ownedTalents);
    const talents=this.rules.talents.filter(t=>owned.has(t.name)&&t.effects.some(e=>manualTypes.has(e.type)&&e.activation!=='always'));
    settings.talents=settings.talents.filter(name=>talents.some(t=>t.name===name));
    $('#roll-talents').innerHTML=talents.length?talents.map(t=>`<label class="rule-toggle"><input type="checkbox" data-roll-talent="${escape(t.name)}" ${settings.talents.includes(t.name)?'checked':''}><span>${escape(t.name)}<small>${escape(t.description)}</small></span></label>`).join(''):'<p class="field-hint">拥有情境数值天赋后，这里会显示可确认的效果。常驻的勇敢和技能状态豁免自动生效。</p>';
  }
  restoreRoll() {
    const s=this.rollSettings;
    $('#roll-kind').value=s.kind;$('#roll-skill').value=s.skill;$('#roll-action').value=s.action;$('#roll-fear-attribute').value=s.fearAttribute;$('#roll-help').value=s.help;$('#roll-modifier').value=s.manualModifier;
    for(const flag of ['armor','unarmed','advantage','exchange'])$(`#roll-${flag}`).checked=s[flag];
  }
  readRoll() {
    const previous=this.rollSettings;
    this.rollSettings={kind:$('#roll-kind').value,skill:$('#roll-skill').value,action:$('#roll-action').value,fearAttribute:$('#roll-fear-attribute').value,help:Number($('#roll-help').value),manualModifier:Number($('#roll-modifier').value),armor:$('#roll-armor').checked,unarmed:$('#roll-unarmed').checked,advantage:$('#roll-advantage').checked,exchange:$('#roll-exchange').checked,weaponRow:$('#roll-weapon').value?Number($('#roll-weapon').value):null,equipmentRows:[...document.querySelectorAll('[data-roll-equipment]:checked')].map(n=>Number(n.dataset.rollEquipment)),talents:[...document.querySelectorAll('[data-roll-talent]:checked')].map(n=>n.dataset.rollTalent)};
    if(this.rollSettings.unarmed && !previous.unarmed){this.rollSettings.weaponRow=null;$('#roll-weapon').value='';this.rollSettings.action='attack';$('#roll-action').value='attack';this.rollSettings.skill='力量';$('#roll-skill').value='力量';}
    if(this.rollSettings.weaponRow!==null && this.rollSettings.weaponRow!==previous.weaponRow){this.rollSettings.unarmed=false;$('#roll-unarmed').checked=false;this.rollSettings.action='attack';$('#roll-action').value='attack';const skill=this.engine.get(CARD,`AB${this.rollSettings.weaponRow}`);if(SKILLS.some(s=>s.name===skill)){this.rollSettings.skill=skill;$('#roll-skill').value=skill;}}
    this.previewRoll();
  }
  previewRoll() {
    const fear=this.rollSettings.kind==='fear';
    $('#skill-choice').hidden=fear;$('#fear-choice').hidden=!fear;$('#weapon-choice').hidden=fear;$('#fear-result').hidden=!fear;
    let result;
    try{result=this.engine.roll({...this.rollSettings,...(fear?{fearRating:Number($('#fear-rating').value),successes:Number($('#fear-successes').value)}:{})});}catch(error){result={status:'invalid',pool:null,reason:error.message,terms:[],warnings:[]};}
    $('#roll-pool').textContent=result.status==='ready'?`${result.pool} D6`:result.status==='blocked'?'无法检定':'待核对';
    $('#roll-pool').classList.toggle('negative',result.status!=='ready');
    $('#roll-reason').textContent=result.reason||'检定可进行';
    $('#roll-terms').innerHTML=(result.terms??[]).map(term=>`<span class="dice-term">${escape(term.label)} <b>${term.value>0?'+':''}${escape(term.value)}</b></span>`).join('');
    const protection=this.engine.get(CARD,'AA30');
    $('#roll-damage').textContent=[Number.isFinite(result.damage)?`基础伤害 ${result.damage}（额外成功的用途由玩家选择）`:'',this.rollSettings.armor?`护甲防护独立投 ${Number.isInteger(protection)&&protection>=0?protection:'待填写'} D6`:''].filter(Boolean).join(' · ');
    $('#roll-warnings').textContent=(result.warnings??[]).join('；');
    $('#fear-conditions').textContent=fear&&Number.isInteger(result.fearConditions)?`本次新增 ${result.fearConditions} 个精神状态；失败恐慌的持续回合另投 D6。`:'请填入有效的恐惧值与成功数。';
  }
  act(action) {
    try{
      const engine=this.engine;
      let render=false;
      if(action==='complete'){engine.completeCreation();render=true;}
      else if(action==='adopt'){engine.adoptExisting();render=true;}
      else if(action==='settle')engine.settleExperience();
      else if(action==='session'){engine.startSession();render=true;}
      else if(action==='buy-skill'){engine.buySkill($('#buy-skill').value);render=true;}
      else if(action==='buy-talent')engine.buyTalent($('#buy-talent').value);
      else if(action==='xp-adjust')engine.adjustXP(Number($('#xp-adjustment').value),$('#xp-reason').value.trim()||'手动经验调整');
      else if(action==='memento')engine.spendMemento();
      else if(action==='asset-spend'||action==='asset-add'){const amount=Number($('#asset-amount').value);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('资产点数须为正整数');engine.adjustAssets(action==='asset-spend'?-amount:amount,$('#asset-reason').value.trim()||(action==='asset-spend'?'支出资产':'增加资产'));render=true;}
      else if(action==='asset-reset'){engine.resetAssets();render=true;}
      else if(action==='preset'){
        const kind=$('#preset-kind').value,row=Number($('#preset-row').value),name=$('#preset-name').value;
        const items=kind==='weapon'?this.rules.weapons:kind==='armor'?this.rules.armor:this.rules.equipment;
        const item=items.find(i=>i.name===name);if(!item)throw new Error('请选择有效条目');
        const cells=kind==='weapon'?{[`O${row}`]:item.name,[`V${row}`]:item.damage,[`X${row}`]:item.range,[`Z${row}`]:item.bonus,[`AB${row}`]:item.skill??item.skills.join(' / ')}:kind==='armor'?{O30:item.name,AA30:item.protection,AC30:item.agility}:{[`A${row}`]:item.name,[`E${row}`]:item.effect,[`M${row}`]:item.bonus};
        for(const [cell,v] of Object.entries(cells))engine.set(CARD,cell,v);
        render=true;
      }
      this.changed(render);this.notify('已记录');
    }catch(error){this.notify(error.message);}
  }
}
