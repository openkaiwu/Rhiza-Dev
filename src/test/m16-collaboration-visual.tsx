import ReactDOM from 'react-dom/client';
import { App } from '../App';
import { api, ApiError } from '../api';
import { collaborationModes } from '../components/CollaborationCard';
import { formatLocation } from '../navigation';
import type { CollaborationAttempt, CollaborationInput, CollaborationMode, CollaborationRecord, ContextHistory, ContextManifest, ExecutionRun, Message, ProviderCatalog, WorkspaceSnapshot } from '../types';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/dm-mono/400.css';
import '../../app/static/css/tokens.css';
import '../../app/static/css/app.css';

// Fixed responses exercise the production App/Chat/Card/Form, never a backend.
// Sample actions mutate only this page's memory and are not end-to-end evidence.
const cases = ['configure', 'running', 'partial', 'stopped', 'completed', 'synthesis', 'exhausted'] as const;
type FixtureCase = typeof cases[number];
const params = new URLSearchParams(location.search);
const fixtureCase = cases.find(value => value === (params.get('case') ?? 'configure'));
const fixtureMode = (Object.keys(collaborationModes) as CollaborationMode[]).find(value => value === (params.get('mode') ?? 'independent-review'));
if (!fixtureCase || !fixtureMode) throw new Error('Unsupported M16 collaboration visual fixture.');
const at = '2026-10-02T12:00:00.000Z';
const frozenNow = Date.parse(at);
Date.now = () => frozenNow;
const workspaceId = 'm16-collaboration-visual-workspace';
const nodeId = 'm16-collaboration-visual-discussion';
const internalNodeId = 'm16-collaboration-visual-internal';
const providerId = 'm16-collaboration-visual-provider';
const collaborationId = 'm16-collaboration-visual-record';
const modelIds = ['m16-review-alpha', 'm16-review-beta', 'm16-review-gamma', 'm16-review-delta'];
const statusLabel = document.getElementById('fixture-status')!;
const releaseButton = document.getElementById('fixture-release') as HTMLButtonElement;
const streamButton = document.getElementById('fixture-stream') as HTMLButtonElement;
let blockedRequests = 0;
let phase = 'ready';
const updateLabel = () => { statusLabel.textContent = `RHIZA · 固定视觉样本 ${fixtureCase} / ${fixtureMode} · ${phase} · 已阻止 ${blockedRequests} 次非样本请求 · 非业务端到端验收`; };
const blocked = (): never => {
  blockedRequests++; updateLabel();
  throw new ApiError('固定视觉样本未启用该操作，未发送请求。', 'VISUAL_FIXTURE_UNSUPPORTED', 400, { category: 'validation' });
};
function isolatedStorage(): Storage {
  const values = new Map<string, string>([['rhiza:onboarding-seen', '1']]);
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}
Object.defineProperties(window, { localStorage: { configurable: true, value: isolatedStorage() }, sessionStorage: { configurable: true, value: isolatedStorage() } });
globalThis.fetch = async () => blocked();
XMLHttpRequest.prototype.open = () => blocked();
Object.defineProperties(window, { WebSocket: { configurable: true, value: function () { blocked(); } }, EventSource: { configurable: true, value: function () { blocked(); } } });
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => blocked() });
document.addEventListener('click', event => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const target = new URL(anchor.href, location.href);
  if (target.origin !== location.origin || target.pathname.startsWith('/api/')) { event.preventDefault(); blockedRequests++; updateLabel(); }
}, true);
Object.assign(api, Object.fromEntries(Object.keys(api).map(key => [key, async () => blocked()])));
let selectedWorkspaceId: string | undefined;
api.setWorkspace = id => { selectedWorkspaceId = id; };
api.workspaceId = () => selectedWorkspaceId;
const requireWorkspace = (id?: string) => { if ((id ?? selectedWorkspaceId) !== workspaceId) blocked(); };

const catalog: ProviderCatalog = {
  providers: [{ id: providerId, preset: 'custom', name: '固定视觉样本供应商 · 无密钥、无网络', baseUrl: 'https://rhiza-collaboration-fixture.example.test/v1', chatPath: '/chat/completions', allowNoKey: true, hasApiKey: false, configured: true, createdAt: at, updatedAt: at }],
  activeModelId: modelIds[0],
  models: modelIds.map((id, index) => ({ id, providerId, modelId: `fixed-review-${index + 1}`, displayName: ['产品与交互评审 · Alpha', '风险与可靠性第二意见 · LongModelNameWithoutSpacesForOverflowVerification20261002', '架构与信息层级审查 · Gamma', '可访问性与窄屏使用评审 · Delta'][index], favorite: index < 2, pinned: index === 2, createdAt: at })),
};
const provider = { configured: true, name: catalog.providers[0].name, model: catalog.models[0].displayName, baseUrl: catalog.providers[0].baseUrl };
const contextItems: WorkspaceSnapshot['contextItems'] = [
  { id: 'm16-frozen-decision', title: '已批准的紧凑对话工作台与历史证据入口', detail: '将协作保留在发起轮次，先看结果，再按需查看固定输入。', content: '协作是对话流的一部分。部分证据必须显式呈现，历史版本不能覆盖。', role: 'Decision', status: 'active', pinned: true, tokens: 120, sourceType: 'reference', sourceId: 'm16-frozen-decision', selectionMode: 'USER_SELECTED', contentVersion: 1 },
  { id: 'm16-frozen-research', title: '真实用户任务 · 长标题来源样本，用于核对文字换行与空间利用率', detail: '用户需要比较不同观点、了解限制、保留结论并继续当前讨论。', content: '固定样本的验收只证明界面展示。真实 Provider、事务与持久化通过独立证据验收。', role: 'Reference', status: 'active', tokens: 160, sourceType: 'reference', sourceId: 'm16-frozen-research', selectionMode: 'CURRENT', contentVersion: 1 },
];
const question = '请评审当前紧凑对话工作台：如何在成熟产品的效率、来源可追溯性和窄屏可操作性之间作出明确取舍？请给出不同意见与可执行的下一步。';
const initialMessages: Message[] = [
  { id: 'm16-visual-user', nodeId, kind: 'user', text: '把多模型协作放在当前对话里，汇总结果后继续这段讨论。', createdAt: at },
  { id: 'm16-visual-assistant', nodeId, kind: 'assistant', text: '建议以当前讨论为中心：在同一轮发起评审、比较模型意见并纳入综合建议。来源与执行记录保持可追溯，失败时由用户明确选择重试。', manifestId: 'm16-original-manifest', replyToMessageId: 'm16-visual-user', createdAt: at },
];
const longOpinion = '### 评审意见\n\n保留清晰的对话阅读宽度，把低频管理操作收进披露菜单。协作应先展示结果与状态，再展示固定来源。\n\n- 当前讨论、参与模型和截止时间必须可识别。\n- 失败模型不能被呈现为共识；重试继续使用原来的固定输入。\n- 窄屏保留可达的操作，不把长模型名截成无法区分的标签。\n\n**下一步：** 对主要任务完成一次桌面和窄屏检查，再收口实际接口与事务证据。';
const manifestFor = (id: string, requestId: string, ownerNodeId = internalNodeId): ContextManifest => ({ id, projectId: workspaceId, nodeId: ownerNodeId, requestId, createdAt: at, mode: 'Assisted', contextItemIds: contextItems.map(item => item.id), excludedItemIds: [], contextItems: contextItems.map(item => ({ sourceType: item.sourceType!, sourceId: item.sourceId!, title: item.title, detail: item.detail, role: item.role, selectionMode: item.selectionMode!, pinned: Boolean(item.pinned), reason: '发起协作时固定的原始来源。', tokenCount: item.tokens, contentVersion: 1, resourceVersionId: `${item.id}-version-1`, digest: 'a'.repeat(64) })), model: 'fixed-review-1', provider: provider.name, runtime: 'provider-adapter', estimatedTokens: 280, generation: { temperature: 0.4, topP: 1, maxTokens: 1024 }, operation: 'send', attachmentIds: [] });
function makeRecord(state: FixtureCase, input?: CollaborationInput): CollaborationRecord {
  const participants = input?.modelIds ?? modelIds.slice(0, 3);
  const mode = input?.mode ?? fixtureMode!;
  const maxRounds = input?.maxRounds ?? (['peer-review', 'debate'].includes(mode) ? 3 : 1);
  const attempts: CollaborationAttempt[] = participants.filter((_id, index) => state !== 'exhausted' || index < participants.length - 1).map((participantId, index) => ({ id: `m16-attempt-${index}`, participantId, round: maxRounds, attempt: 1, status: state === 'stopped' ? 'canceled' : index === 1 && ['partial', 'exhausted'].includes(state) ? 'failed' : index === participants.length - 1 && state === 'running' ? 'running' : 'completed', runRef: `m16-run-${index}`, manifestRef: `m16-manifest-${index}`, ...(state === 'stopped' || index === 1 && ['partial', 'exhausted'].includes(state) || index === participants.length - 1 && state === 'running' ? {} : { outputRef: `m16-output-${index}`, text: `${longOpinion}\n\n观点 ${index + 1}：${index === 1 ? '建议保留关键操作的明确文字，避免只靠图标。' : '建议先减少视觉噪音，再检验任务效率。'}` }), ...(index === 1 && ['partial', 'exhausted'].includes(state) ? { errorCode: 'PROVIDER_TIMEOUT' } : {}) }));
  const outputRefs = attempts.flatMap(attempt => attempt.outputRef ? [attempt.outputRef] : []);
  const record: CollaborationRecord = { id: collaborationId, workspaceId, nodeId: internalNodeId, revision: 7, mode, participants, synthesisModelId: input?.synthesisModelId ?? participants[0], base: { workspaceId, nodeId, contextBaseHash: 'b'.repeat(64), prompt: input?.prompt ?? question, contextItems: structuredClone(contextItems), history: initialMessages.map(({ id, text, kind }) => ({ id, text, kind })), attachmentIds: [], manifest: manifestFor('m16-base-manifest', 'm16-base-request', nodeId) }, status: ({ configure: 'running', running: 'running', partial: 'partial', stopped: 'canceled', completed: 'completed', synthesis: 'synthesizing', exhausted: 'budget-exhausted' } as const)[state], createdAt: at, ...(state === 'stopped' ? { cancelRequestedAt: at } : {}), budget: { tokenLimit: input?.tokenLimit ?? 32000, synthesisTokens: 0, usedTokens: state === 'exhausted' ? 32000 : 2460, reservedTokens: ['running', 'synthesis'].includes(state) ? 1024 : 0, deadlineAt: new Date(frozenNow + (['stopped', 'exhausted'].includes(state) ? -1000 : input?.timeLimitMs ?? 180000)).toISOString(), maxRounds }, attempts, models: catalog.models.map(model => ({ id: model.id, displayName: model.displayName, model: model.modelId, provider: provider.name, active: true })) };
  if (['partial', 'completed', 'synthesis'].includes(state)) record.attempts.push({ id: 'm16-synthesis-attempt', participantId: '@synthesis', round: maxRounds, attempt: 1, status: state === 'synthesis' ? 'running' : 'completed', runRef: 'm16-synthesis-run', manifestRef: 'm16-synthesis-manifest', ...(state === 'synthesis' ? {} : { outputRef: 'm16-synthesis-output' }) });
  if (state === 'partial' || state === 'completed') record.synthesis = { recommendation: '**建议采用紧凑的对话工作台。**\n\n先保留当前任务的阅读空间与明确操作，再按需披露来源和运行详情。协作汇总纳入当前讨论之后，后续回答继续使用可追溯的结论。', rationale: '参与模型在对话连续性上达成一致，但对低频操作的可见程度存在分歧。这里保留各方限制，不把缺失意见当成一致结论。', alternatives: [{ option: '保持主操作文字可见，其余按需展开', pros: ['降低首次使用成本', '保留关键动作辨识度'], cons: ['占用少量阅读空间'], applicability: '适合主要任务尚未形成习惯的新用户。' }, { option: '紧凑图标与披露菜单', pros: ['提高空间利用率', '减少重复操作行'], cons: ['需要明确标签与可发现的入口'], applicability: '适合重复处理长对话和来源的熟练用户。' }], risks: ['没有取得全部意见时，需要用户判断缺失证据的影响。', '长模型名、窄屏菜单和键盘焦点须通过实际渲染检查。'], disagreements: [{ summary: '交互评审倾向精简可见操作；风险评审认为关键恢复动作仍应保留文字，避免重试含义被隐藏。', sourceOutputRefs: outputRefs }], sourceOutputRefs: outputRefs, missingParticipants: attempts.filter(attempt => attempt.status === 'failed').map(attempt => ({ participantId: attempt.participantId, status: attempt.status, errorCode: attempt.errorCode })) };
  return record;
}
let record = fixtureCase === 'configure' ? undefined : makeRecord(fixtureCase);
const workspace: WorkspaceSnapshot = { projectId: workspaceId, nodeId, activeNodeId: nodeId, mode: 'Assisted', contextItems, messages: structuredClone(initialMessages), attachments: [], discussionEdges: [], anchors: [], manifests: [manifestFor('m16-original-manifest', 'm16-original-run', nodeId)], segments: [], updatedAt: at, discussionNodes: [{ id: nodeId, title: '多模型协作 · 当前产品讨论', summary: '固定视觉样本：围绕这段对话比较意见，保留综合建议并继续。', status: 'active', kind: 'main', x: 0, y: 0, createdAt: at, updatedAt: at }, { id: internalNodeId, title: '协作内部证据', summary: '只从发起轮次检查来源与执行记录。', status: 'active', kind: 'branch', sourceNodeId: nodeId, x: 0, y: 0, createdAt: at, updatedAt: at }] };
const currentRecord = (id: string) => { requireWorkspace(); if (!record || id !== record.id) blocked(); return record!; };
const manifestById = (id: string): ContextManifest => {
  if (id === 'm16-original-manifest') return workspace.manifests[0];
  if (id === 'm16-base-manifest') return manifestFor(id, 'm16-base-request', nodeId);
  const attempt = record?.attempts.find(item => item.manifestRef === id);
  if (!attempt) blocked();
  return manifestFor(id, attempt!.runRef);
};
const historyFor = (id: string): ContextHistory => ({ manifest: manifestById(id), sources: contextItems.map(item => ({ sourceId: item.sourceId!, status: 'resolved', content: item.content!, resourceVersion: { id: `${item.id}-version-1`, version: 1, digest: 'a'.repeat(64) } })) });
const runFor = (attempt: CollaborationAttempt): ExecutionRun => ({ id: attempt.runRef, commandId: `fixed:${attempt.id}`, workspaceId, nodeId: internalNodeId, status: attempt.status, attempt: attempt.attempt, inputHash: 'c'.repeat(64), createdAt: at, ...(attempt.status === 'running' ? {} : { terminalAt: at }), input: { executor: { runtime: 'provider-adapter', modelSpecRef: attempt.participantId, providerEndpointRef: providerId, model: attempt.participantId === '@synthesis' ? '综合意见 · 固定模型' : catalog.models.find(model => model.id === attempt.participantId)!.displayName, provider: provider.name }, request: { prompt: question, manifestId: attempt.manifestRef } }, ...(attempt.errorCode ? { error: { code: attempt.errorCode, class: 'timeout', message: '固定失败样本，不代表真实 Provider 状态。' } } : {}), telemetry: { traceCount: 2, durationMs: 1250, usage: { promptTokens: 500, completionTokens: 320, totalTokens: 820 } } });
api.getWorkspace = async () => { requireWorkspace(); return { workspace: structuredClone(workspace), provider: structuredClone(provider), providerCatalog: structuredClone(catalog) }; };
api.getScopedWorkspace = async id => { requireWorkspace(id); return { workspace: structuredClone(workspace) }; };
api.listWorkspaces = async () => ({ workspaces: [{ workspaceId, name: 'RHIZA · 协作固定视觉验收', status: 'active', createdBy: 'm16-visual-user', revision: 1 }] });
api.getProviders = async () => ({ catalog: structuredClone(catalog), presets: {} });
api.getContextPreview = async () => { requireWorkspace(); return { mode: workspace.mode, items: structuredClone(contextItems), recommendations: [], omissions: [], budget: 32000, usedTokens: 280, overBudget: false }; };
api.listCollaborations = async () => { requireWorkspace(); return { collaborations: record ? [structuredClone(record)] : [] }; };
api.getCollaboration = async id => ({ collaboration: structuredClone(currentRecord(id)) });
api.getNodeCollaboration = async id => { requireWorkspace(); if (![nodeId, internalNodeId].includes(id)) blocked(); return { collaborations: id === internalNodeId && record ? [structuredClone(record)] : [] }; };
api.listRuns = async () => { requireWorkspace(); return { runs: record?.attempts.map(runFor) ?? [] }; };
api.getRun = async id => { requireWorkspace(); if (id === 'm16-original-run') return { run: { ...runFor({ id: 'm16-original-attempt', participantId: modelIds[0], round: 1, attempt: 1, status: 'completed', runRef: id, manifestRef: 'm16-original-manifest' }), nodeId } }; const attempt = record?.attempts.find(item => item.runRef === id); if (!attempt) blocked(); return { run: runFor(attempt!) }; };
api.getWorkspaceActivity = async () => ({ activity: [] });
api.getManifestContext = async id => { requireWorkspace(); return historyFor(id); };
api.getMessageContext = async id => { requireWorkspace(); const message = workspace.messages.find(item => item.id === id); if (!message?.manifestId) blocked(); return historyFor(message!.manifestId!); };
api.getProvenance = async id => { requireWorkspace(); const message = workspace.messages.find(item => item.id === id); if (!message?.manifestId) blocked(); const manifest = manifestById(message!.manifestId!); return { id: `fixed-provenance-${id}`, outputRef: id, inputRefs: ['m16-visual-user'], contextManifestRef: manifest.id, runRef: manifest.requestId, modelSpecRef: modelIds[0], providerEndpointRef: providerId, runtimeSnapshotRef: 'fixed-offline-runtime', status: 'recorded', missingRefs: [] }; };

let releasePending: (() => void) | undefined;
releaseButton.addEventListener('click', () => { releasePending?.(); releasePending = undefined; releaseButton.hidden = true; });
api.createCollaboration = async input => { requireWorkspace(); record = makeRecord(fixtureCase === 'synthesis' ? 'synthesis' : 'running', input); return { collaboration: structuredClone(record) }; };
api.streamCollaboration = async (id, onEvent, _key, signal) => {
  const sample = currentRecord(id);
  phase = 'fixed-stream'; updateLabel(); streamButton.hidden = true; releaseButton.hidden = false;
  onEvent({ type: 'COLLABORATION_STATE', collaborationId: id, revision: sample.revision, status: sample.status, budget: structuredClone(sample.budget), attempts: structuredClone(sample.attempts) });
  const attempt = sample.attempts.at(-1)!;
  onEvent({ type: 'CONTENT_DELTA', collaborationId: id, participantId: attempt.participantId, round: attempt.round, requestId: attempt.runRef, delta: attempt.participantId === '@synthesis' ? '正在比较意见：共同建议保持对话连续性；分歧集中在操作的可见程度。\n\n这是固定流式片段，不触发任何模型调用。' : longOpinion });
  await new Promise<void>((resolve, reject) => {
    const abort = () => { releasePending = undefined; releaseButton.hidden = true; reject(new ApiError('固定流已停止。', 'GENERATION_STOPPED', 499)); };
    releasePending = () => { signal.removeEventListener('abort', abort); resolve(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  record = makeRecord('completed', { prompt: sample.base.prompt, mode: sample.mode, modelIds: sample.participants, synthesisModelId: sample.synthesisModelId, attachmentIds: [], maxRounds: sample.budget.maxRounds, tokenLimit: sample.budget.tokenLimit });
  phase = 'released'; updateLabel();
  return { collaboration: structuredClone(record) };
};
api.stopCollaboration = async id => { const current = currentRecord(id); record = { ...current, status: 'canceled', cancelRequestedAt: at, revision: current.revision + 1, budget: { ...current.budget, reservedTokens: 0 }, attempts: current.attempts.map(attempt => attempt.status === 'running' ? { ...attempt, status: 'canceled' as const } : attempt) }; phase = 'stopped-in-memory'; updateLabel(); return { collaboration: structuredClone(record) }; };
api.retryCollaborationParticipant = async (id, attemptId) => { const current = currentRecord(id); if (!current.attempts.some(attempt => attempt.id === attemptId && ['failed', 'interrupted'].includes(attempt.status))) blocked(); phase = 'retry-unchanged-fixed-sample'; updateLabel(); return { collaboration: structuredClone(current) }; };
api.synthesizeCollaboration = async id => { const current = currentRecord(id); phase = 'synthesis-unchanged-fixed-sample'; updateLabel(); return { collaboration: structuredClone(current) }; };
api.retainCollaboration = async (id, targetNodeId) => {
  const current = currentRecord(id); if (!current.synthesis || targetNodeId !== nodeId) blocked();
  const source = current.attempts.find(attempt => attempt.participantId === '@synthesis' && attempt.status === 'completed')?.outputRef;
  if (!source) blocked();
  const message: Message = { id: 'm16-retained-output', nodeId, kind: 'assistant', text: `${current.synthesis!.recommendation}\n\n${current.synthesis!.rationale}`, sourceMessageId: source, createdAt: at };
  if (!workspace.messages.some(item => item.id === message.id)) workspace.messages.push(message);
  phase = 'retained-in-memory'; updateLabel();
  return { message: structuredClone(message) };
};

function selectFixture() {
  const next = new URL(location.href);
  next.searchParams.set('case', (document.getElementById('fixture-case') as HTMLSelectElement).value);
  next.searchParams.set('mode', (document.getElementById('fixture-mode') as HTMLSelectElement).value);
  next.hash = '';
  location.assign(next.href);
}
const caseSelector = document.getElementById('fixture-case') as HTMLSelectElement;
for (const value of cases) caseSelector.add(new Option(value, value));
caseSelector.value = fixtureCase; caseSelector.addEventListener('change', selectFixture);
const modeSelector = document.getElementById('fixture-mode') as HTMLSelectElement;
for (const [value, label] of Object.entries(collaborationModes)) modeSelector.add(new Option(label, value));
modeSelector.value = fixtureMode; modeSelector.addEventListener('change', selectFixture);
let setupPending = fixtureCase === 'configure';
let startPending = false;
let modePending = false;
const observer = new MutationObserver(() => {
  if (setupPending) {
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="发起多模型协作"]');
    if (button && !button.disabled) { setupPending = false; modePending = true; button.click(); }
  }
  if (modePending) {
    const mode = document.querySelector<HTMLSelectElement>('.collaboration-form select[aria-label="协作方式"]');
    if (mode) { modePending = false; mode.value = fixtureMode; mode.dispatchEvent(new Event('change', { bubbles: true })); queueMicrotask(() => { if (!startPending) return; const button = [...document.querySelectorAll<HTMLButtonElement>('.collaboration-form button')].find(item => item.textContent === '开始协作'); if (button && !button.disabled) { startPending = false; button.click(); } }); return; }
  }
  if (startPending && !modePending) {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.collaboration-form button')].find(item => item.textContent === '开始协作');
    if (button && !button.disabled) { startPending = false; button.click(); }
  }
});
observer.observe(document.getElementById('root')!, { childList: true, subtree: true });
streamButton.hidden = !['running', 'synthesis'].includes(fixtureCase);
streamButton.addEventListener('click', () => { setupPending = true; startPending = true; observer.takeRecords(); const button = document.querySelector<HTMLButtonElement>('button[aria-label="发起多模型协作"]'); if (button && !button.disabled) { setupPending = false; modePending = true; button.click(); } });
history.replaceState(null, '', `${location.pathname}${location.search}${formatLocation({ kind: 'conversation', workspaceId, nodeId })}`);
updateLabel();
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
