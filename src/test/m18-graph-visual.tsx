import ReactDOM from 'react-dom/client';
import { App } from '../App';
import { api, ApiError } from '../api';
import type { ContextSelectionPreview, GraphBatchResult, GraphProjectionResult, PersonalGraphView, WorkspaceSnapshot } from '../types';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/dm-mono/400.css';
import '../../app/static/css/tokens.css';
import '../../app/static/css/app.css';

// The production App/GraphView/Tray consume only these isolated fixed responses.
// This visual fixture is not evidence of transactional batch or Context correctness.
const cases = ['tray-ready', 'tray-over-budget', 'batch-partial', 'undo-conflict', 'personal-conflict'] as const;
const requestedCase = new URLSearchParams(location.search).get('case') ?? 'tray-ready';
const fixtureCase = cases.find(value => value === requestedCase);
if (!fixtureCase) throw new Error('Unsupported M18 Graph visual fixture.');
const workspaceId = 'm18-graph-visual-workspace', ownerId = 'm18-graph-visual-user';
const at = '2026-10-02T00:00:00.000Z';
const nodeIds = ['m18-current', 'm18-evidence', 'm18-validation'];
let phase = 'ready', blockedRequests = 0;
const updateLabel = () => { document.getElementById('fixture-status')!.textContent = `RHIZA · 固定图谱 ${fixtureCase} · ${phase} · 已阻止 ${blockedRequests} 次非样本请求；不是事务证据`; };
const blocked = (): never => {
  blockedRequests++; updateLabel();
  throw new ApiError('固定视觉样本未启用该操作，未发送请求。', 'VISUAL_FIXTURE_UNSUPPORTED', 400, { category: 'validation' });
};
function isolatedStorage(): Storage {
  const values = new Map<string, string>([['rhiza:onboarding-seen', '1']]);
  return {
    get length() { return values.size; }, clear: () => values.clear(), getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null, removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}
Object.defineProperties(window, {
  localStorage: { configurable: true, value: isolatedStorage() }, sessionStorage: { configurable: true, value: isolatedStorage() },
});
globalThis.fetch = async () => blocked();
XMLHttpRequest.prototype.open = () => blocked();
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
const requireScope = () => { if (selectedWorkspaceId !== workspaceId) blocked(); };

const workspace: WorkspaceSnapshot = {
  projectId: workspaceId, nodeId: nodeIds[0], activeNodeId: nodeIds[0], mode: 'Assisted', updatedAt: at,
  contextItems: [], messages: [], attachments: [], anchors: [], manifests: [], segments: [],
  discussionNodes: [
    { id: nodeIds[0], title: '产品交付主线', summary: '在当前讨论继续，先审阅关联来源再发送。', status: 'active', kind: 'main', x: 240, y: 220, createdAt: at, updatedAt: at },
    { id: nodeIds[1], title: '用户访谈与付款证据', summary: '证据来源已保存；版本和预算须经确认。', status: 'active', kind: 'branch', x: 650, y: 100, createdAt: at, updatedAt: at },
    { id: nodeIds[2], title: '历史引用与跨工作区验证', summary: '失败结果保留，用户选择手动继续或撤销。', status: 'draft', kind: 'branch', x: 650, y: 370, createdAt: at, updatedAt: at },
  ],
  discussionEdges: [{ id: 'm18-reference-edge', source: nodeIds[0], target: nodeIds[1], relation: 'references', label: '引用已审阅证据', createdAt: at }],
};
const cloneWorkspace = () => structuredClone(workspace);
const provider = { configured: false, name: '固定视觉验收', model: '不执行模型', baseUrl: '' };
const catalog = { providers: [], models: [], activeModelId: null };
api.getWorkspace = async () => ({ workspace: cloneWorkspace(), provider, providerCatalog: catalog });
api.getScopedWorkspace = async id => { if (id !== workspaceId) blocked(); return { workspace: cloneWorkspace() }; };
api.listWorkspaces = async () => ({ workspaces: [{ workspaceId, name: 'RHIZA · 图谱固定视觉验收', status: 'active', createdBy: ownerId, revision: 1 }] });
api.listRuns = async () => ({ runs: [] });
api.listCollaborations = async () => ({ collaborations: [] });
api.getNodeCollaboration = async id => { if (!nodeIds.includes(id)) blocked(); return { collaborations: [] }; };
api.getWorkspaceActivity = async () => ({ activity: [] });
api.listManagedBackups = async () => ({ backups: [], reminder: { due: true, nextAt: null, intervalDays: 7 } });
api.getContextPreview = async () => ({ mode: workspace.mode, items: structuredClone(workspace.contextItems), recommendations: [], omissions: [], budget: 32_000, usedTokens: 930, overBudget: false });
api.getGraphNeighborhood = async input => {
  requireScope();
  const graph: GraphProjectionResult = {
    version: 'm18-visual-graph-v1', checkpoint: 1,
    objects: workspace.discussionNodes.filter(node => !input?.objectId || node.id === input.objectId || node.id === nodeIds[0]).map(node => ({
      ref: { workspaceId, objectType: 'conversation', objectId: node.id }, revision: 1,
      lifecycle: node.status === 'archived' ? 'archived' : 'active', title: node.title, summary: node.summary, kind: node.kind,
      status: node.status, createdAt: node.createdAt, updatedAt: node.updatedAt, layout: { x: node.x, y: node.y },
    })),
    relations: workspace.discussionEdges.map(edge => ({ id: edge.id, source: { workspaceId, objectType: 'conversation', objectId: edge.source },
      target: { workspaceId, objectType: 'conversation', objectId: edge.target }, relationType: edge.relation.replaceAll('-', '_'), lifecycle: 'active', label: edge.label, createdAt: edge.createdAt })),
  };
  return { graph };
};
const personal: PersonalGraphView = {
  viewType: 'conversation', revision: 2, source: 'personal', ownerScope: { scopeType: 'user', scopeId: ownerId },
  positions: workspace.discussionNodes.map(node => ({ objectType: 'conversation', objectId: node.id, x: node.x, y: node.y, collapsed: false })),
  viewport: { x: 30, y: 15, zoom: .8 }, filters: { objectTypes: ['conversation'], relationTypes: [] },
};
let personalReadFailed = false;
api.getPersonalGraphView = async () => {
  requireScope();
  if (fixtureCase === 'personal-conflict' && !personalReadFailed) {
    personalReadFailed = true; phase = 'personal read unavailable'; updateLabel();
    throw new ApiError('固定读取中断，请重新读取个人视图。', 'GRAPH_VIEW_UNAVAILABLE', 503, { category: 'infrastructure' });
  }
  phase = 'personal view read'; updateLabel(); return structuredClone(personal);
};
api.savePersonalGraphView = async (input, revision, key) => {
  requireScope(); if (!key || revision !== personal.revision) blocked();
  if (fixtureCase === 'personal-conflict') {
    phase = 'personal revision conflict; no save'; updateLabel();
    throw new ApiError('个人视图已在其他窗口变化，请重新读取后再保存。', 'GRAPH_VIEW_REVISION_CONFLICT', 409, { category: 'conflict' });
  }
  Object.assign(personal, structuredClone(input), { revision: revision + 1 }); phase = 'fixed personal view saved'; updateLabel();
  return { viewType: personal.viewType, ownerScope: personal.ownerScope, revision: personal.revision };
};
api.previewContextSelection = async sources => {
  requireScope(); if (!sources.length || sources.some(source => source.sourceType !== 'node' || !nodeIds.includes(source.sourceId))) blocked();
  const overBudget = fixtureCase === 'tray-over-budget';
  const result: ContextSelectionPreview = { workspaceId, expectedNodeId: nodeIds[0], budget: 32_000,
    usedTokens: overBudget ? 38_000 : 1_450, overBudget, status: overBudget ? 'over_budget' : 'ready',
    sources: sources.map(source => ({ ...source, title: workspace.discussionNodes.find(node => node.id === source.sourceId)!.title,
      sourceRevision: (source.sourceId === nodeIds[1] ? 'a' : 'b').repeat(64), tokens: overBudget ? 19_000 : source.sourceId === nodeIds[1] ? 340 : 590 })),
  };
  phase = overBudget ? 'over budget; confirmation blocked' : 'exact sources previewed'; updateLabel(); return result;
};
api.confirmContextSelection = async (preview, key) => {
  requireScope(); if (fixtureCase !== 'tray-ready' || !key || preview.workspaceId !== workspaceId || preview.expectedNodeId !== nodeIds[0] || preview.overBudget) blocked();
  workspace.contextItems = preview.sources.map(source => ({ id: `selected-${source.sourceId}`, sourceType: source.sourceType, sourceId: source.sourceId,
    sourceRevision: source.sourceRevision, title: source.title, detail: '固定审阅来源', role: 'Reference', status: 'active', tokens: source.tokens, selectionMode: 'USER_SELECTED', reason: '用户已明确确认的固定视觉来源' }));
  phase = 'fixed selection confirmed; no model call'; updateLabel(); return { workspace: cloneWorkspace() };
};

type FixedBatch = GraphBatchResult & { outcomes: Array<GraphBatchResult['outcomes'][number] & { steps: Array<{ commandId: string; status: 'succeeded' | 'failed'; code?: string; retryable?: boolean }> }> };
let batch: FixedBatch | undefined, frozenBatchIdentity: string | undefined;
api.batchGraphOperations = async (items, key) => {
  requireScope(); if (!['batch-partial', 'undo-conflict'].includes(fixtureCase) || !key || items.length !== 2 || items.some(item => item.commandType !== 'ArchiveObject' || !nodeIds.slice(1).includes(item.payload.nodeId))) blocked();
  const identity = JSON.stringify([items, key]); if (frozenBatchIdentity && frozenBatchIdentity !== identity) blocked();
  frozenBatchIdentity = identity;
  const partial = fixtureCase === 'batch-partial' && !batch;
  batch = { batchId: 'm18-fixed-batch', workspaceId, status: partial ? 'incomplete' : 'completed',
    outcomes: items.map((item, index) => ({ itemId: item.itemId, status: partial && index ? 'failed' : 'succeeded', undoable: !partial || !index,
      steps: [{ commandId: `m18-fixed-child-${index}`, status: partial && index ? 'failed' : 'succeeded', ...(partial && index ? { code: 'GRAPH_BATCH_STEP_FAILED', retryable: true } : {}) }] })),
  };
  workspace.discussionNodes = workspace.discussionNodes.map(node => node.id === nodeIds[1] || (!partial && node.id === nodeIds[2]) ? { ...node, status: 'archived' } : node);
  phase = partial ? 'partial results; manual resume available' : 'fixed batch completed'; updateLabel(); return structuredClone(batch);
};
api.getGraphBatch = async id => { requireScope(); if (!batch || id !== batch.batchId) return blocked(); return structuredClone(batch); };
api.undoGraphBatch = async (id, key) => {
  requireScope(); if (fixtureCase !== 'undo-conflict' || !batch || id !== 'm18-fixed-batch' || !key) return blocked();
  batch = { batchId: 'm18-fixed-undo', workspaceId, status: 'partial', outcomes: batch.outcomes.map((item, index) => ({ itemId: item.itemId,
    status: index ? 'failed' : 'succeeded', undoable: false, steps: [{ commandId: `m18-fixed-undo-child-${index}`, status: index ? 'failed' : 'succeeded', ...(index ? { code: 'GRAPH_BATCH_ITEM_CHANGED', retryable: false } : {}) }] })),
  };
  workspace.discussionNodes = workspace.discussionNodes.map(node => node.id === nodeIds[1] ? { ...node, status: 'active' } : node);
  phase = 'Undo conflict; original per-item results retained'; updateLabel(); return structuredClone(batch);
};
document.getElementById('fixture-hide')!.addEventListener('click', () => { document.getElementById('fixture-controls')!.hidden = true; });
history.replaceState(null, '', `${location.pathname}${location.search}#/workspaces/${workspaceId}/graph`);
updateLabel();
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
