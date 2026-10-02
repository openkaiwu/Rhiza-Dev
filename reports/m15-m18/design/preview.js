/* Standalone design preview. No API, model, backup or persisted workspace writes. */
const $ = (id) => document.getElementById(id);
const icons = {
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  chat:'<path d="M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z"/><path d="M7 8h9M7 12h6"/>',
  graph:'<circle cx="5" cy="5" r="2.5"/><circle cx="18" cy="7" r="2.5"/><circle cx="9" cy="19" r="2.5"/><path d="m7 5 8 2M5 8l3 8m3 1 6-8"/>',
  compare:'<rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/><path d="M6 8h1m10 0h1M6 12h1m10 0h1"/>',
  layers:'<path d="m12 3 10 6-10 6L2 9zm-9 11 9 6 9-6"/>',
  history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v6l4 2"/>',
  activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>',
  branch:'<circle cx="6" cy="5" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-5h5a7 7 0 0 0 7-4"/>',
  archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8m-10 4h6"/>',
  settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="10" cy="18" r="2" fill="var(--surface)"/>',
  chevrons:'<path d="m9 8 3-3 3 3m-6 8 3 3 3-3"/>', down:'<path d="m6 9 6 6 6-6"/>', right:'<path d="m9 6 6 6-6 6"/>',
  context:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-8-9h4m-4 4h4"/>',
  more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  file:'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/>',
  link:'<path d="m9 15 6-6m-7 3-2 2a4 4 0 0 0 6 6l3-3m1-5 2-2a4 4 0 0 0-6-6L9 7"/>',
  replay:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  'arrow-up':'<path d="M12 19V5m-6 6 6-6 6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  pin:'<path d="m9 3 12 12m-5-9-5 5m-4-6 2 4-5 5 6 6 5-5 4 2m-9 0-7 7"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
  shield:'<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="m8 12 3 3 5-6"/>',
  filter:'<path d="M4 5h16M7 12h10m-7 7h4"/>',
  expand:'<path d="M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6"/>',
  play:'<path d="m7 3 14 9-14 9z"/>', refresh:'<path d="M20 9a8 8 0 0 0-14-5L3 7m0-5v5h5m-4 8a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/>',
  star:'<path d="m12 3 3 6 6 1-4.5 4.5 1 6.5L12 18l-5.5 3 1-6.5L3 10l6-1z"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>'
};
function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `icon ${el.className}`);
    svg.innerHTML = icons[el.dataset.icon] || icons.info;
    el.replaceWith(svg);
  });
}
renderIcons();
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let desktopContext = true;
let decision = 'pending';
let mode = 'Assisted';
let toastTimer;
let collabTimer;
let frozenSources;
let collaborationStage = 'idle';
let collaborationResults = [];
let retainedCollaboration = false;
let frozenPrompt = '';
let zoom = 1;
let thread = '信息架构方向';
const selectedNodes = new Set(['信息架构方向']);
const names = {chat:thread,graph:'讨论图谱',settings:'模型与设置',data:'数据与备份',history:'执行历史',knowledge:'知识状态',activity:'活动'};
const narrow = matchMedia('(max-width:1199px)');
const mobile = matchMedia('(max-width:760px)');
const sheets = [$('context-sheet'), $('sidebar-sheet')];
function toast(text) {clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,2800);}
function show(title, content) {$('dialog-title').textContent=title;$('dialog-body').innerHTML=content;renderIcons($('dialog-body'));if(!$('detail').open)$('detail').showModal();}
function closeSheets(){sheets.forEach((sheet)=>{if(sheet.open)sheet.close();});}
function syncContextLayout(){
  $('workspace-body').classList.toggle('context-hidden', !desktopContext || narrow.matches);
  $('context-toggle').setAttribute('aria-expanded', String(narrow.matches ? $('context-sheet').open : desktopContext));
}
function closeContext(){
  if($('context-sheet').open){$('context-sheet').close();return;}
  desktopContext=false;syncContextLayout();$('context-toggle').focus();
}
function toggleContext(){
  if(narrow.matches){if($('context-sheet').open){closeContext();return;}$('context-sheet').append($('context-panel'));$('context-sheet').showModal();}
  else desktopContext=!desktopContext;
  syncContextLayout();
}
$('context-sheet').addEventListener('close',()=>{$('workspace-body').append($('context-panel'));syncContextLayout();});
$('sidebar-sheet').addEventListener('close',()=>{$('app').prepend($('sidebar'));});
function toggleSidebar(){
  if(mobile.matches){if($('sidebar-sheet').open){$('sidebar-sheet').close();return;}$('sidebar-sheet').append($('sidebar'));$('sidebar-sheet').showModal();}
  else {$('app').classList.toggle('sidebar-hidden');if($('app').classList.contains('sidebar-hidden'))document.querySelector('.sidebar-opener').focus();else document.querySelector('.brand-row button').focus();}
}
function switchView(next){
  closeSheets();
  document.querySelectorAll('.view').forEach((el)=>el.hidden=el.id!==next);
  document.querySelectorAll('[data-view]').forEach((el)=>{if(el.dataset.view===next)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('page-title').textContent=next==='chat'?thread:names[next];$('title-status').hidden=next!=='chat';
  desktopContext=next==='chat';syncContextLayout();
  $('main').focus({preventScroll:true});
  if(next==='graph' && mobile.matches){zoom=.9;renderZoom();}
}
function contextTab(which, focus=false){
  for(const key of ['selected','recommended']){$(`${key}-panel`).hidden=key!==which;$(`${key}-tab`).setAttribute('aria-selected',String(key===which));$(`${key}-tab`).tabIndex=key===which?0:-1;}
  if(focus)$(`${which}-tab`).focus();
}
function syncSources(){
  const extra=decision==='accepted'||(decision==='pending'&&mode==='Auto');
  const count=extra?3:2;
  $('active-count').textContent=count;$('selected-count').textContent=count;
  document.querySelectorAll('.context-count').forEach(el=>{if(!frozenSources||!el.closest('.collab-config'))el.textContent=`${count} 项来源`;});
  $('confirmed-source').hidden=!extra;$('confirmed-reason').textContent=decision==='accepted'?'你已确认这一版本':'按相关性自动纳入 · v2';
  $('budget').textContent=extra?'5.4K':'4.2K';$('budget-bar').style.width=extra?'16.9%':'13.1%';
  $('recommended-count').textContent=decision==='pending'&&mode==='Assisted'?'1':'0';
  $('recommendation').hidden=decision!=='pending'||mode!=='Assisted';
  $('recommendation-empty').hidden=!$('recommendation').hidden;
  $('recommended-tab').hidden=mode!=='Assisted';
  $('composer-mode').textContent=mode;
  $('mode-copy').textContent={Assisted:'推荐经你确认后才进入下一次回答。',Auto:'按相关性与剩余预算自动纳入，标记自动选择。',Strict:'只使用显式选择的资料，不自动补充。'}[mode];
  document.querySelector('.composer-caption span').textContent={Assisted:'推荐资料需确认后才会加入本轮',Auto:'自动选择的资料可在上下文中逐项查看',Strict:'仅使用你明确选择的资料'}[mode];
}
const collaborationModes = {
  'independent-review': '各模型先独立判断，再汇总一致意见和分歧。',
  'peer-review': '先给出独立意见，再相互检查论据和遗漏。',
  debate: '围绕当前问题交换论点，汇总后保留仍未解决的分歧。',
  'second-opinion': '以上一条回答为基线，检查假设、风险和其他可行方案。'
};
function selectedParticipants(){return [...document.querySelectorAll('[data-participant]:checked')].map(el=>el.dataset.participant);}
function updateParticipants(){
  const count=selectedParticipants().length;
  $('participant-count').textContent=`已选 ${count} / 最多 4`;
  const valid=count>=2&&count<=4;
  $('participant-validation').textContent=valid?'每位参与者使用同一份冻结输入。':'请选择 2–4 个模型后开始。';
  $('participant-validation').classList.toggle('invalid',!valid);
  $('start-collab').disabled=collaborationStage!=='idle'||!valid||!$('collaboration-prompt').value.trim();
}
function setCollaborationExpanded(expanded){
  $('collaboration-body').hidden=!expanded;
  $('collapse-collab').setAttribute('aria-expanded',String(expanded));
  $('collapse-collab').setAttribute('aria-label',expanded?'收起协作详情':'展开协作详情');
}
function openCollaboration(fromComposer=false){
  if($('detail').open)$('detail').close();
  if(collaborationStage==='idle'&&fromComposer&&$('message-input').value.trim())$('collaboration-prompt').value=$('message-input').value.trim();
  $('collaboration-turn').hidden=false;setCollaborationExpanded(true);updateParticipants();
  $('collaboration-turn').scrollIntoView({block:'start',behavior:'instant'});
  (collaborationStage==='idle'?$('collaboration-prompt'):$('collapse-collab')).focus({preventScroll:true});
}
function resetCollaboration(){
  clearTimeout(collabTimer);collaborationStage='idle';collaborationResults=[];retainedCollaboration=false;frozenSources=undefined;frozenPrompt='';
  $('collaboration-turn').hidden=true;$('participant-results').hidden=true;$('participant-results').replaceChildren();
  $('collaboration-setup').hidden=false;$('collaboration-frozen').hidden=true;
  $('synthesis').hidden=true;$('stop').hidden=true;$('summarize').hidden=true;$('retain').disabled=false;
  $('collaboration-state').textContent='当前讨论';$('collab-copy').textContent='结果留在这段对话中；纳入讨论后，可基于结果继续。';
  document.querySelectorAll('.collab-config select,[data-participant]').forEach(el=>el.disabled=false);
  $('collaboration-prompt').disabled=false;
  $('message-input').placeholder='继续这段讨论，或用 @ 引用资料…';
  document.querySelectorAll('.collaboration-retained,.collaboration-followup').forEach(el=>el.remove());
  updateParticipants();syncSources();
}
function renderParticipants(){
  $('participant-results').hidden=false;
  $('participant-results').innerHTML=collaborationResults.map(result=>`<article class="participant"><div class="participant-title"><span class="model-avatar ${result.id==='b'||result.id==='d'?'violet':''}">${result.id.toUpperCase()}</span><strong>研究模型 ${result.id.toUpperCase()}</strong><span class="status-pill ${result.status==='failed'?'warning':''}">${{running:'执行中',completed:'已完成',failed:'连接中断',stopped:'已停止'}[result.status]}</span></div><p>${escapeHtml(result.text)}</p>${result.status==='failed'&&collaborationStage!=='stopped'&&!retainedCollaboration?`<button class="text-button" data-retry-participant="${result.id}">重试此模型<i data-icon="replay"></i></button>`:''}</article>`).join('');
  renderIcons($('participant-results'));
}
function synthesizeCollaboration(){
  const completed=collaborationResults.filter(result=>result.status==='completed');
  if(!completed.length)return;
  const missing=collaborationResults.filter(result=>result.status!=='completed');
  $('synthesis-copy').innerHTML=`<p><strong>综合建议：</strong>让对话成为中心任务；上下文可以收起，但始终显示来源数量。</p>${completed.length>1?`<p><strong>仍有分歧：</strong>研究模型 ${completed[0].id.toUpperCase()} 建议默认展开上下文，研究模型 ${completed[1].id.toUpperCase()} 建议首次进入时收起。需要通过实际任务验证默认布局。</p>`:'<p><strong>意见尚不完整：</strong>当前仅有一位参与者的结果，不能据此声称形成共识。</p>'}${missing.length?`<p class="muted">缺席意见：${missing.map(result=>`研究模型 ${result.id.toUpperCase()}`).join('、')}。保留结果时会同时标记。</p>`:''}<p class="muted">依据：${completed.map(result=>`研究模型 ${result.id.toUpperCase()} 的本轮意见`).join('、')} · 示例结果</p>`;
  $('synthesis').hidden=false;$('summarize').hidden=true;$('stop').hidden=true;
  $('collaboration-state').textContent=missing.length?'部分完成':'已完成';
  $('collab-copy').textContent='可将综合判断和分歧纳入当前讨论，继续对话。';
}
function finishParticipants(){
  const completed=collaborationResults.filter(result=>result.status==='completed').length;
  const failed=collaborationResults.filter(result=>result.status==='failed').length;
  collaborationStage=failed?'partial':'completed';
  $('collaboration-state').textContent=failed?'部分完成':'已完成';
  $('collab-copy').textContent=`${completed} 位完成${failed?`，${failed} 位连接中断；可只重试失败模型，或汇总已有意见。`:' · 综合判断已就绪。'}`;
  $('summarize').hidden=!failed;$('stop').hidden=!failed;renderParticipants();
  if(!failed)synthesizeCollaboration();
}
const dialogs = {
  workspace:['工作区','<div class="record-list"><button data-ui="workspace-current"><span class="workspace-avatar">R</span><span><strong>Rhiza 产品研究</strong><small>当前工作区 · 4 个讨论</small></span><i data-icon="check"></i></button></div><div class="actions"><button data-dialog="new">新建工作区</button><button data-ui="rename">重命名</button><button data-dialog="archive">归档工作区</button></div>'],
  search:['搜索或运行命令','<input type="text" id="command-search" aria-label="搜索命令" placeholder="搜索讨论、资料或操作…" autofocus><div class="record-list" id="command-results"><button data-view="chat">信息架构方向 <span class="status-pill">讨论</span></button><button data-view="graph">打开图谱</button><button data-view="history">查看执行历史</button><button data-view="settings">模型与设置</button><button data-view="data">导入、导出与备份</button></div>'],
  source:['历史来源','<p class="dialog-meta">首屏信息架构建议 · 今天 10:33 · 已冻结</p><div class="record-list"><button data-dialog="source-version"><i data-icon="file"></i><span><strong>访谈发现 · 第 02 轮</strong><small>Resource v3 · 摘要校验通过</small></span><i data-icon="right"></i></button><button data-dialog="source-version"><i data-icon="branch"></i><span><strong>信息架构方向</strong><small>回答前的历史消息 · 只读快照</small></span><i data-icon="right"></i></button></div><p>这里显示该回答实际使用的版本。修改本轮上下文不会改变历史。</p><div class="actions"><button data-dialog="replay">Replay 预检</button><button data-view="history">执行记录</button></div>'],
  'source-version':['访谈发现 · v3','<p>“希望发送前能看到到底用了哪些资料，而不是回答完才猜测。”</p><p class="dialog-meta">访谈摘录 · 版本 v3 · 历史快照 · 校验通过</p><p>当前查看的是回答生成时冻结的版本。</p>'],
  replay:['Replay 预检','<p>来源版本完整，校验通过。选择重放策略：</p><div class="record-list"><button data-ui="replay"><span><strong>Exact</strong><small>使用历史模型与生成配置</small></span></button><button data-ui="replay"><span><strong>Partial</strong><small>检查并接受配置差异后执行</small></span></button><button data-ui="replay"><span><strong>Current-model</strong><small>使用当前模型与历史输入</small></span></button></div><div class="actions"><button data-dialog="missing">查看资源缺失状态</button></div>'],
  missing:['无法 Replay','<div class="dialog-notice error">访谈发现 v3 的文件缺失，未调用模型。</div><p>三种策略都需要完整的历史输入。请先恢复这一版本的文件，再重新校验。</p><div class="actions"><button data-dialog="restore">恢复预检</button><button data-dialog="source">查看来源</button></div>'],
  discussion:['讨论操作','<div class="record-list"><button data-ui="rename">重命名讨论</button><button data-dialog="message">消息与片段管理</button><button data-view="graph">在图谱中查看</button><button data-view="history">执行历史</button><button data-dialog="archive">归档讨论</button><button data-dialog="purge">永久清除…</button></div>'],
  message:['消息操作','<div class="record-list"><button data-action="collaboration">对这一轮发起多模型协作</button><button data-dialog="source">查看本轮历史上下文</button><button data-ui="branch">创建正式支线</button><button data-ui="branch">在临时支线中讨论</button><button data-ui="edit">编辑并重发 / 重新生成</button><button data-ui="segment">保存为片段</button></div>'],
  attach:['添加到本轮上下文','<div class="record-list"><button data-ui="attach"><i data-icon="file"></i>上传文件</button><button data-ui="add-recommendation"><i data-icon="branch"></i>引用移动端导航方案 · v2</button><button data-view="graph"><i data-icon="graph"></i>从图谱中选择</button></div><p class="dialog-meta">预览不会读取或上传本机文件。</p>'],
  model:['选择模型','<div class="record-list"><button data-ui="model-a"><span><strong>研究模型 A</strong><small>当前 · 128K 上下文</small></span><i data-icon="check"></i></button><button data-ui="model-b"><span><strong>研究模型 B</strong><small>64K 上下文</small></span></button></div><div class="actions"><button data-view="settings">管理供应商</button><button data-dialog="parameters">生成参数</button></div>'],
  parameters:['生成参数','<dl class="details-list"><div><dt>温度</dt><dd>0.7</dd></div><div><dt>最大输出</dt><dd>4,096 tokens</dd></div></dl><p>参数随本次执行冻结，不会修改历史记录。</p>'],
  frozen:['冻结输入','<p>参与者共同使用同一份历史消息和来源版本。</p><dl class="details-list"><div><dt>来源</dt><dd>当前讨论、访谈发现 v3</dd></div><div><dt>总预算</dt><dd>32,000 tokens / 180 秒</dd></div></dl><p>失败重试复用原输入，已完成的模型不会重复调用。</p>'],
  filters:['图谱筛选','<label class="checkbox-label"><input type="checkbox" checked disabled>讨论</label><label class="checkbox-label"><input type="checkbox" checked disabled>资料与片段</label><label class="checkbox-label"><input id="show-relations" type="checkbox" checked>显示关系</label><p>筛选只影响当前视图，不改变领域关系或本轮上下文。</p><div class="actions"><button data-ui="clear-selection">清空选择</button></div>'],
  batch:['已选对象','<p>在图谱中选择对象后，操作结果逐项呈现。选择本身不会改变上下文。</p><div class="actions"><button data-ui="batch-archive">归档所选</button><button data-ui="link">建立关系</button><button data-ui="clear-selection">清空选择</button></div>'],
  provider:['供应商配置','<p>配置入口保留端点、模型目录与本机凭据管理。</p><div class="dialog-notice">设计预览不接收真实密钥。</div><p>目录刷新失败时保留手动模型，并提供修复凭据与重试入口。</p>'],
  restore:['恢复预检','<dl class="details-list"><div><dt>目标</dt><dd>空工作区</dd></div><div><dt>校验</dt><dd>备份内容完整 · 示例</dd></div><div><dt>凭据</dt><dd>需在目标端重新配置</dd></div></dl><p class="dialog-notice">已永久清除的正文不可恢复。正式恢复前将再次核对目标与权限。</p>'],
  export:['导出预检','<p>Rhiza 产品研究 · 4 个讨论 · 12 条消息 · 6 次执行</p><p id="export-dialog-copy"></p><p class="dialog-notice">导出不包含密钥、凭据和本机绝对路径。</p><div class="actions"><button data-ui="export">生成 Bundle（预览）</button></div>'],
  import:['导入预检','<p>在正式导入前检查 Workspace 身份、历史引用和内容校验。</p><div class="dialog-notice">示例：缺少 1 个资源文件，凭据尚未配置。当前不能激活。</div><div class="record-list"><button data-dialog="missing">补齐访谈发现 v3</button><button data-dialog="provider">映射目标模型与凭据</button></div><div class="actions"><button disabled>导入并激活</button></div>'],
  excluded:['排除原因','<p><strong>早期定价假设</strong></p><p>你已明确排除：该假设已被新版结论替代。它不会参与本轮回答。</p>'],
  stale:['需要核对来源','<div class="dialog-notice">来源已有新版本。确认前先查看差异，再选择要使用的版本。</div><p>已生成回答继续引用原来的冻结版本。</p>'],
  archive:['归档讨论','<p>归档后仍可查看历史，并可从归档列表恢复。</p><div class="actions"><button data-ui="archive">预览归档与撤销</button></div>'],
  purge:['永久清除','<div class="dialog-notice error">此操作不可撤销。正式产品会先列出受影响对象，并检查活跃执行与跨节点引用。</div><p>预览不会清除数据。</p><button disabled>需完成对象范围校验</button>'],
  new:['新建讨论','<label for="new-title">讨论名称</label><input type="text" id="new-title" value="新的研究问题"><p class="dialog-meta">在 Rhiza 产品研究中创建。</p><div class="actions"><button class="primary" data-ui="new">创建（预览）</button></div>']
};
function openDialog(key){const entry=dialogs[key];if(!entry)return;show(entry[0],entry[1]);if(key==='export')$('export-dialog-copy').textContent=$('include-files').checked?'包含附件与来源文件。':'仅保存精确版本与摘要；导入端补齐文件后才能激活。';if(key==='search')$('command-search').focus();if(key==='frozen')$('dialog-body').innerHTML=`<p>参与者共同使用同一份历史消息和来源版本。</p><p>${escapeHtml(frozenSources || '开始前尚未冻结来源。')}</p><p>重试复用原输入，已完成的参与者不会重复调用。</p>`;}
document.addEventListener('click',(event)=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.view){if($('detail').open)$('detail').close();switchView(button.dataset.view);return;}
  if(button.dataset.dialog){openDialog(button.dataset.dialog);return;}
  if(button.dataset.thread){if(thread!==button.dataset.thread)resetCollaboration();thread=button.dataset.thread;document.querySelectorAll('.thread').forEach(el=>el.classList.toggle('current',el===button));switchView('chat');if(thread!=='信息架构方向')show(thread,'<p>这是讨论切换的布局预览，正文使用同一份示例内容。</p>');return;}
  if(button.dataset.action==='collaboration'){openCollaboration(!!button.closest('.composer'));return;}
  if(button.dataset.action==='collaboration-details'){openCollaboration();return;}
  if(button.dataset.retryParticipant){
    const result=collaborationResults.find(item=>item.id===button.dataset.retryParticipant&&item.status==='failed');
    if(!result||collaborationStage==='running'||collaborationStage==='stopped'||retainedCollaboration)return;
    result.status='running';result.text='复用原始冻结输入，正在重试此模型。';collaborationStage='running';
    $('collaboration-state').textContent='执行中';$('collab-copy').textContent='正在重试失败模型；其他参与者的已完成意见保持不变。';
    $('synthesis').hidden=true;$('summarize').hidden=true;$('stop').hidden=false;renderParticipants();
    clearTimeout(collabTimer);collabTimer=setTimeout(()=>{result.status='completed';result.text='建议首次进入时收起上下文，并保留明确的来源数量。';finishParticipants();},650);return;
  }
  if(button.dataset.action==='sidebar')toggleSidebar();
  if(button.dataset.action==='context')toggleContext();
  if(button.dataset.action==='context-close')closeContext();
  if(button.dataset.action==='copy'){navigator.clipboard.writeText(document.querySelector('.answer').innerText).then(()=>toast('回答已复制'),()=>toast('复制不可用，请选择正文复制'));}
  const action=button.dataset.ui;
  if(!action)return;
  if(action==='clear-selection'){selectedNodes.clear();updateSelection();$('detail').close();return;}
  if(action==='add-recommendation'){decision='accepted';syncSources();contextTab('selected');$('detail').close();toast('已加入移动端导航方案 v2');return;}
  if(action==='replay'){show('发送前确认','<p>历史输入已就绪。此预览展示确认流程，不会调用模型。</p>');return;}
  if(action.startsWith('model-')){document.querySelector('.model-picker').firstChild.textContent=action==='model-a'?'研究模型 A':'研究模型 B';$('detail').close();return;}
  if(action==='new'){const name=$('new-title').value.trim();if(!name)return;resetCollaboration();thread=name;$('detail').close();switchView('chat');toast('已预览新讨论；未写入工作区');return;}
  if(action==='archive'||action==='batch-archive'){show('已归档 · 预览','<p>正式产品将在这里列出逐项结果，并允许撤销。</p><button data-ui="undo">撤销归档</button>');return;}
  if(action==='workspace-current'){$('detail').close();return;}
  const copies={rename:'名称编辑入口保留在对象菜单中。',branch:'新支线保留原始消息与来源引用。',edit:'编辑重发和重新生成会创建新版本，不覆盖历史。',segment:'片段保留消息范围与来源身份。',attach:'正式产品会打开文件选择；预览不读取本机文件。',link:'关系编辑与本轮上下文选择彼此独立。',export:'已展示导出完成状态；预览未生成真实归档。',undo:'已撤销归档预览。'};
  if(copies[action])show('操作预览',`<p>${copies[action]}</p>`);
});
$('dialog-close').onclick=()=> $('detail').close();$('dialog-done').onclick=()=> $('detail').close();
$('context-toggle').onclick=toggleContext;
$('selected-tab').onclick=()=>contextTab('selected');$('recommended-tab').onclick=()=>contextTab('recommended');
document.querySelector('.context-tabs').addEventListener('keydown',(event)=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();if(mode==='Assisted')contextTab(event.key==='Home'?'selected':event.key==='End'?'recommended':$('selected-panel').hidden?'selected':'recommended',true);}});
$('mode').onchange=()=>{mode=$('mode').value;contextTab('selected');syncSources();};
$('accept').onclick=()=>{decision='accepted';syncSources();contextTab('selected',true);toast('已确认移动端导航方案 v2');};
$('reject').onclick=()=>{decision='rejected';syncSources();toast('该推荐不用于本轮回答');};
$('message-input').oninput=()=>{$('send').disabled=!$('message-input').value.trim();};
$('message-input').addEventListener('keydown',(event)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!$('send').disabled)$('composer-form').requestSubmit();}});
$('composer-form').onsubmit=(event)=>{
  event.preventDefault();const text=$('message-input').value.trim();if(!text)return;
  if(!retainedCollaboration){show('发送前上下文',`<p>本轮使用 <strong>${$('active-count').textContent} 项来源</strong>，模式为 ${mode}。</p><p>未确认的 Assisted 推荐不会发送。此预览不连接模型。</p><p class="dialog-meta">消息：${escapeHtml(text)}</p>`);return;}
  const next=document.createElement('div');next.className='collaboration-followup';
  next.innerHTML=`<article class="user-message"><div class="message-meta">你 <span>继续讨论</span></div><p>${escapeHtml(text)}</p></article><article class="assistant-message"><div class="message-meta"><span class="assistant-mark" aria-hidden="true">✳</span><strong>Rhiza</strong><span>基于已纳入的协作结果 · 示例</span></div><div class="answer"><p>结合刚才的综合建议和分歧，下一步可先验证默认收起上下文的方案：保留来源数量和快捷展开入口，对照专业用户与首次使用者的完成情况，再决定默认布局。</p></div><div class="source-row"><button class="source-chip" data-action="collaboration-details"><i data-icon="compare"></i>本轮协作结果与分歧</button></div></article>`;
  document.querySelector('.conversation-inner').append(next);renderIcons(next);$('message-input').value='';$('send').disabled=true;
  next.scrollIntoView({block:'start',behavior:'instant'});toast('已演示基于协作结果继续；未调用模型或写入工作区');
};
function updateSelection(){document.querySelectorAll('[data-node]').forEach(el=>{el.classList.toggle('selected',selectedNodes.has(el.dataset.node));el.setAttribute('aria-pressed',String(selectedNodes.has(el.dataset.node)));});$('graph-count').textContent=`已选 ${selectedNodes.size} 项`;$('add-context').disabled=!selectedNodes.size;}
document.querySelectorAll('[data-node]').forEach(el=>el.onclick=()=>{if(selectedNodes.has(el.dataset.node))selectedNodes.delete(el.dataset.node);else selectedNodes.add(el.dataset.node);updateSelection();});
$('add-context').onclick=()=>show('加入上下文前校验',`<p>已选：${[...selectedNodes].map(escapeHtml).join('、')}</p><p>将检查权限、来源版本和剩余预算；重复的已选来源不会再次计入。</p><p class="dialog-meta">这里仅预览校验入口，未改变本轮来源。</p>`);
function renderZoom(){$('graph-world').style.transform=`scale(${zoom})`;$('zoom-level').textContent=`${Math.round(zoom*100)}%`;}
$('zoom-out').onclick=()=>{zoom=Math.max(.4,zoom-.1);renderZoom();};$('zoom-in').onclick=()=>{zoom=Math.min(1.5,zoom+.1);renderZoom();};$('fit-graph').onclick=()=>{zoom=Math.min(1,($('graph-canvas').clientWidth-40)/1020);renderZoom();$('graph-canvas').scrollTo(0,0);};
$('graph-search').oninput=()=>{const query=$('graph-search').value.trim();let total=0;document.querySelectorAll('[data-node]').forEach(el=>{el.hidden=!el.innerText.includes(query);if(!el.hidden)total++;});$('graph-empty').hidden=total>0;document.querySelector('.graph-edges').hidden=!!query;};
document.addEventListener('change',(event)=>{if(event.target.id==='show-relations')document.querySelector('.graph-edges').hidden=!event.target.checked;});
$('collaboration-mode').onchange=()=>{$('collaboration-mode-copy').textContent=collaborationModes[$('collaboration-mode').value];};
$('collaboration-prompt').oninput=updateParticipants;
document.querySelectorAll('[data-participant]').forEach(el=>el.onchange=updateParticipants);
$('collapse-collab').onclick=()=>setCollaborationExpanded($('collaboration-body').hidden);
$('start-collab').onclick=()=>{
  updateParticipants();if($('start-collab').disabled)return;
  frozenPrompt=$('collaboration-prompt').value.trim();
  frozenSources=`问题：${frozenPrompt}。来源：当前讨论截至本轮回答、访谈发现 v3${$('confirmed-source').hidden?'':'、移动端导航方案 v2'}。方式：${$('collaboration-mode').selectedOptions[0].textContent}，${$('collaboration-rounds').value} 轮。`;
  collaborationResults=selectedParticipants().map(id=>({id,status:'running',text:'正在基于同一份对话历史和来源版本给出意见。'}));
  frozenSources+=`参与模型：${collaborationResults.map(result=>`研究模型 ${result.id.toUpperCase()}`).join('、')}。`;
  $('collaboration-setup').hidden=true;$('collaboration-frozen').hidden=false;
  $('collaboration-frozen-prompt').textContent=frozenPrompt;
  $('collaboration-frozen-label').textContent=`${$('collaboration-mode').selectedOptions[0].textContent} · ${collaborationResults.length} 位参与者 · ${$('collaboration-rounds').value} 轮 · 已冻结`;
  collaborationStage='running';document.querySelectorAll('.collab-config select,[data-participant]').forEach(el=>el.disabled=true);$('collaboration-prompt').disabled=true;updateParticipants();
  if($('message-input').value.trim()===frozenPrompt){$('message-input').value='';$('send').disabled=true;}
  $('collaboration-state').textContent='执行中';$('collab-copy').textContent='示例执行中 · 本轮输入已冻结';$('stop').hidden=false;$('synthesis').hidden=true;renderParticipants();
  clearTimeout(collabTimer);collabTimer=setTimeout(()=>{collaborationResults.forEach((result,index)=>{result.status=index===1?'failed':'completed';result.text=index===1?'本轮未完成，可以复用原始输入重试此模型。':'建议收敛首屏入口，保持来源与历史记录随手可达。';});finishParticipants();},650);
};
$('summarize').onclick=synthesizeCollaboration;
$('stop').onclick=()=>{
  clearTimeout(collabTimer);collaborationStage='stopped';$('stop').hidden=true;
  collaborationResults.filter(result=>result.status==='running').forEach(result=>{result.status='stopped';result.text='已停止，未产生意见。';});
  renderParticipants();$('summarize').hidden=!collaborationResults.some(result=>result.status==='completed');
  $('collaboration-state').textContent='已停止';$('collab-copy').textContent='已停止。不再派发后续调用，已完成结果保留。';
};
$('retain').onclick=()=>{
  if(retainedCollaboration||$('synthesis').hidden)return;
  retainedCollaboration=true;collaborationStage='retained';$('retain').disabled=true;renderParticipants();
  const retained=document.createElement('article');retained.className='assistant-message collaboration-retained';
  retained.innerHTML=`<div class="message-meta"><span class="assistant-mark" aria-hidden="true">✳</span><strong>协作结果已纳入讨论</strong><span>示例</span></div><p class="dialog-meta">问题：${escapeHtml(frozenPrompt)}</p><div class="answer">${$('synthesis-copy').innerHTML}</div><div class="source-row"><button class="source-chip" data-action="collaboration-details"><i data-icon="compare"></i>${collaborationResults.length} 位参与者 · 查看原始协作</button><button class="source-chip" data-dialog="frozen"><i data-icon="link"></i>冻结输入</button></div>`;
  document.querySelector('.conversation-inner').append(retained);renderIcons(retained);setCollaborationExpanded(false);
  $('collaboration-state').textContent='已纳入讨论';$('collab-copy').textContent='已纳入当前讨论；后续消息继续引用综合判断、分歧与缺席意见。';
  $('message-input').placeholder='基于刚才的协作结果继续讨论…';$('message-input').focus({preventScroll:true});retained.scrollIntoView({block:'start',behavior:'instant'});
  toast('协作结果已纳入当前讨论 · 交互预览');
};
$('model-search').oninput=()=>{let count=0;document.querySelectorAll('[data-model]').forEach(el=>{el.hidden=!`${el.dataset.model} 研究供应商`.toLowerCase().includes($('model-search').value.toLowerCase());if(!el.hidden)count++;});$('model-empty').hidden=count>0;};
$('discover').onclick=()=>{$('provider-health').textContent='目录刷新失败 · 需要检查凭据';$('provider-notice').hidden=false;};
$('provider-retry').onclick=()=>{$('provider-notice').hidden=true;$('provider-health').textContent='目录刷新成功 · 示例状态';toast('已重试失败项目；其他项目保持不变');};
$('backup').onclick=()=>{$('backup-status').textContent='备份完成状态预览：保存位置、时间与读回校验将在这里显示。未创建真实备份。';};
$('include-files').onchange=()=>{$('export-help').textContent=$('include-files').checked?'包含附件和来源文件，目标端可校验完整内容。':'只保存精确版本与摘要，导入端补齐文件后才能激活。';};
document.addEventListener('input',(event)=>{if(event.target.id==='command-search')$('command-results').querySelectorAll('button').forEach(el=>el.hidden=!el.textContent.includes(event.target.value));});
document.addEventListener('keydown',(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openDialog('search');}});
narrow.addEventListener('change',()=>{closeSheets();syncContextLayout();});mobile.addEventListener('change',closeSheets);
syncContextLayout();syncSources();
