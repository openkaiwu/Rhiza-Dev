import ReactDOM from 'react-dom/client';
import { App } from '../App';
import { api, ApiError } from '../api';
import type { ProviderCatalog, ProviderStatus, SafeProvider, WorkspaceSnapshot } from '../types';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/dm-mono/400.css';
import '../../app/static/css/tokens.css';
import '../../app/static/css/app.css';

// The production App and ProviderSettings consume only these in-memory responses.
// This entry point never contacts a backend or reads the user's browser storage.
const cases = ['healthy', 'degraded', 'invalid-key', 'loading', 'empty', 'error', 'saved'] as const;
const requestedCase = new URLSearchParams(location.search).get('case') ?? 'healthy';
const fixtureCase = cases.find(value => value === requestedCase);
if (!fixtureCase) throw new Error('Unsupported M16 Provider visual fixture.');
const at = '2026-10-02T00:00:00.000Z';
const workspaceId = 'm16-provider-visual-workspace';
const nodeId = 'm16-provider-visual-discussion';
const providerId = 'm16-provider-visual-endpoint';
const statusLabel = document.getElementById('fixture-status')!;
const releaseButton = document.getElementById('fixture-release') as HTMLButtonElement;
let blockedRequests = 0;
let phase = 'ready';
const updateFixtureLabel = () => {
  statusLabel.textContent = `RHIZA · 固定视觉样本 ${fixtureCase} · ${phase} · 已阻止 ${blockedRequests} 次非样本请求`;
};
const blocked = (): never => {
  blockedRequests++;
  updateFixtureLabel();
  throw new ApiError('固定视觉样本未启用该操作，未发送请求。', 'VISUAL_FIXTURE_UNSUPPORTED', 400, { category: 'validation' });
};

function isolatedStorage(): Storage {
  const values = new Map<string, string>([['rhiza:onboarding-seen', '1']]);
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}
Object.defineProperties(window, {
  localStorage: { configurable: true, value: isolatedStorage() },
  sessionStorage: { configurable: true, value: isolatedStorage() },
});
globalThis.fetch = async () => blocked();
XMLHttpRequest.prototype.open = () => blocked();
document.addEventListener('click', event => {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const target = new URL(anchor.href, location.href);
  if (target.origin !== location.origin || target.pathname.startsWith('/api/')) {
    event.preventDefault();
    blockedRequests++;
    updateFixtureLabel();
  }
}, true);
Object.assign(api, Object.fromEntries(Object.keys(api).map(key => [key, async () => blocked()])));
let selectedWorkspaceId: string | undefined;
api.setWorkspace = id => { selectedWorkspaceId = id; };
api.workspaceId = () => selectedWorkspaceId;

const healthStatus = fixtureCase === 'degraded' ? 'degraded' : fixtureCase === 'invalid-key' ? 'invalid-key' : 'healthy';
const provider: SafeProvider = {
  id: providerId, preset: 'custom',
  name: '本机固定视觉验收 · 长名称供应商与多语言模型目录',
  baseUrl: 'https://rhiza-visual-fixture.example.test/research-and-development/model-gateway/compatible/v1',
  chatPath: '/chat/completions', allowNoKey: true, hasApiKey: false, configured: true,
  createdAt: at, updatedAt: at,
  discoveryHealth: {
    status: healthStatus, endpointVersion: at, checkedAt: at,
    code: healthStatus === 'degraded' ? 'MODEL_DISCOVERY_TIMEOUT' : healthStatus === 'invalid-key' ? 'PROVIDER_INVALID_KEY' : 'MODEL_DISCOVERY_OK',
    ...(healthStatus === 'healthy' ? { discoveredCount: fixtureCase === 'empty' ? 0 : 2 } : {}),
  },
};
const catalog: ProviderCatalog = {
  providers: [provider], activeModelId: fixtureCase === 'empty' ? null : 'm16-visual-alpha',
  models: fixtureCase === 'empty' ? [] : [
    { id: 'm16-visual-alpha', providerId, displayName: 'Alpha · 已收藏模型', modelId: 'alpha', favorite: true, pinned: false, createdAt: at },
    { id: 'm16-visual-long', providerId, displayName: '复杂研究与架构评审模型 · LongModelNameWithoutSpacesForOverflowVerification20261002', modelId: 'research/reasoning-model-with-a-very-long-unbroken-identifier-and-version-20261002', favorite: false, pinned: true, createdAt: at },
  ],
};
const snapshot = () => structuredClone(catalog);
const providerStatus = (): ProviderStatus => {
  const model = catalog.models.find(item => item.id === catalog.activeModelId);
  const endpoint = catalog.providers.find(item => item.id === model?.providerId);
  return { configured: Boolean(model && endpoint?.configured), name: endpoint?.name ?? '未配置供应商', model: model?.displayName ?? '未选择模型', baseUrl: endpoint?.baseUrl ?? '' };
};
const workspace: WorkspaceSnapshot = {
  projectId: workspaceId, nodeId, activeNodeId: nodeId,
  mode: 'Assisted', contextItems: [], messages: [], attachments: [], discussionEdges: [], anchors: [], manifests: [], segments: [], updatedAt: at,
  discussionNodes: [{ id: nodeId, title: '正式设置界面验收', summary: '固定目录状态；不执行模型、不保存真实配置。', status: 'active', kind: 'main', x: 0, y: 0, createdAt: at, updatedAt: at }],
};
const requireWorkspace = (id: string) => { if (id !== workspaceId) blocked(); };
api.getWorkspace = async () => ({ workspace: structuredClone(workspace), provider: providerStatus(), providerCatalog: snapshot() });
api.getScopedWorkspace = async id => { requireWorkspace(id); return { workspace: structuredClone(workspace) }; };
api.listWorkspaces = async () => ({ workspaces: [{ workspaceId, name: 'RHIZA · Provider 固定视觉验收', status: 'active', createdBy: 'm16-visual-user', revision: 1 }] });
api.getContextPreview = async () => ({ mode: workspace.mode, items: [], recommendations: [], omissions: [], budget: 32000, usedTokens: 0, overBudget: false });
api.listRuns = async () => ({ runs: [] });
api.listCollaborations = async () => ({ collaborations: [] });
api.getNodeCollaboration = async id => { if (id !== nodeId) blocked(); return { collaborations: [] }; };
api.getWorkspaceActivity = async () => ({ activity: [] });
api.listManagedBackups = async () => ({ backups: [], reminder: { due: true, nextAt: null, intervalDays: 7 } });
api.getProviders = async () => ({ catalog: snapshot(), presets: {
  openai: { name: 'OpenAI', baseUrl: 'https://openai.example.test/v1', allowNoKey: false },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.example.test/v1', allowNoKey: false },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://deepseek.example.test/v1', allowNoKey: false },
  siliconflow: { name: 'SiliconFlow', baseUrl: 'https://siliconflow.example.test/v1', allowNoKey: false },
  ollama: { name: 'Ollama', baseUrl: 'http://ollama.example.test/v1', allowNoKey: true },
  custom: { name: '自定义', baseUrl: provider.baseUrl, allowNoKey: true },
} });

let releasePending: (() => void) | undefined;
const waitForRelease = () => new Promise<void>(resolve => {
  releasePending = resolve;
  phase = 'loading';
  releaseButton.hidden = false;
  updateFixtureLabel();
});
releaseButton.addEventListener('click', () => {
  releasePending?.();
  releasePending = undefined;
  releaseButton.hidden = true;
  phase = 'released';
  updateFixtureLabel();
});
api.discoverModels = async id => {
  if (!catalog.providers.some(item => item.id === id)) blocked();
  if (fixtureCase === 'loading') await waitForRelease();
  if (fixtureCase === 'degraded' || fixtureCase === 'invalid-key') {
    throw new ApiError('', fixtureCase === 'degraded' ? 'MODEL_DISCOVERY_TIMEOUT' : 'PROVIDER_INVALID_KEY', fixtureCase === 'degraded' ? 504 : 502, { category: 'infrastructure' });
  }
  catalog.providers = catalog.providers.map(item => item.id === id ? { ...item, discoveryHealth: { status: 'healthy', code: 'MODEL_DISCOVERY_OK', endpointVersion: item.updatedAt, checkedAt: at, discoveredCount: catalog.models.filter(model => model.providerId === id).length } } : item);
  return { catalog: snapshot() };
};
api.discoverProviderBatch = async ids => {
  const results: import('../types').ProviderDiscoveryBatchResult['results'] = [];
  for (const id of ids) {
    try { await api.discoverModels(id); results.push({ providerId: id, status: 'succeeded' }); }
    catch (error) {
      if (!(error instanceof ApiError) || !['MODEL_DISCOVERY_TIMEOUT', 'PROVIDER_INVALID_KEY'].includes(error.code)) throw error;
      results.push({ providerId: id, status: 'failed' });
    }
  }
  return { catalog: snapshot(), results };
};
api.saveProvider = async input => {
  if (fixtureCase === 'error') {
    phase = 'error'; updateFixtureLabel();
    throw new ApiError('', 'PROVIDER_CONFIGURATION_CHANGED', 409, { category: 'conflict' });
  }
  const id = input.id ?? 'm16-visual-created';
  const previous = catalog.providers.find(item => item.id === id);
  if (input.id && !previous) blocked();
  const updatedAt = '2026-10-02T00:00:01.000Z';
  const saved: SafeProvider = { id, preset: input.preset, name: input.name, baseUrl: input.baseUrl, chatPath: '/chat/completions', allowNoKey: input.allowNoKey, hasApiKey: false, configured: input.allowNoKey, createdAt: previous?.createdAt ?? at, updatedAt, discoveryHealth: { status: 'unknown', endpointVersion: updatedAt } };
  catalog.providers = previous ? catalog.providers.map(item => item.id === id ? saved : item) : [...catalog.providers, saved];
  if (input.modelId && !catalog.models.some(item => item.providerId === id && item.modelId === input.modelId)) {
    catalog.models.push({ id: `m16-visual-manual-${catalog.models.length}`, providerId: id, modelId: input.modelId, displayName: input.displayName ?? input.modelId, favorite: false, pinned: false, createdAt: at });
  }
  phase = 'saved'; updateFixtureLabel();
  return { catalog: snapshot() };
};
api.updateModel = async (id, changes) => {
  if (!catalog.models.some(item => item.id === id)) blocked();
  catalog.models = catalog.models.map(item => item.id === id ? { ...item, ...changes } : item);
  return { catalog: snapshot() };
};
api.selectModel = async id => {
  if (!catalog.models.some(item => item.id === id)) blocked();
  catalog.activeModelId = id;
  return { catalog: snapshot(), provider: providerStatus() };
};

history.replaceState(null, '', `${location.pathname}${location.search}#/settings/providers`);
updateFixtureLabel();
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
