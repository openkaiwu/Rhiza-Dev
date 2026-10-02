import ReactDOM from 'react-dom/client';
import { App } from '../App';
import { api, ApiError } from '../api';
import type { BundleExecutionConfiguration, BundleMappingChoice, BundlePreview, ManagedBackup, ManagedBackupList, ProviderCatalog, WorkspaceSnapshot } from '../types';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/newsreader/500.css';
import '@fontsource/dm-mono/400.css';
import '../../app/static/css/tokens.css';
import '../../app/static/css/app.css';

// Production App/BundleControls, fixed responses only. These marker files are
// visual samples, not ZIP archives or evidence of backend recovery correctness.
const cases = ['warnings', 'missing', 'preflight-error', 'imported', 'backup-loading', 'backup-ready', 'backup-failed'] as const;
const requestedCase = new URLSearchParams(location.search).get('case') ?? 'warnings';
const fixtureCase = cases.find(value => value === requestedCase);
if (!fixtureCase) throw new Error('Unsupported M16 data visual fixture.');
const at = '2026-10-02T00:00:00.000Z';
const sourceId = 'm16-data-visual-source-workspace';
const targetId = 'm16-data-visual-imported-workspace-with-preserved-historical-identity-20261002';
const providerId = 'm16-data-visual-local-endpoint';
const sourceNodeId = 'm16-data-visual-source-discussion';
const targetNodeId = 'm16-data-visual-imported-discussion';
const resourceVersionId = 'resource-version-frozen-historical-attachment-with-a-long-identifier-20261002';
const resourceText = 'RHIZA fixed historical resource version 2026-10-02.\n';
const statusLabel = document.getElementById('fixture-status')!;
const releaseButton = document.getElementById('fixture-release') as HTMLButtonElement;
const archiveButton = document.getElementById('fixture-archive') as HTMLButtonElement;
const resourceButton = document.getElementById('fixture-resource') as HTMLButtonElement;
const wrongResourceButton = document.getElementById('fixture-wrong-resource') as HTMLButtonElement;
let blockedRequests = 0;
let phase = 'ready';
let imports = 0;
let preferenceCommits = 0;
let backupCommits = 0;
const updateLabel = () => {
  statusLabel.textContent = `RHIZA · ${fixtureCase} · ${phase} · 导入 ${imports} / 偏好 ${preferenceCommits} / 备份 ${backupCommits} · 阻止请求 ${blockedRequests} · 固定响应，非 ZIP/恢复验证`;
};
const blocked = (): never => {
  blockedRequests++; updateLabel();
  throw new ApiError('固定视觉样本未启用该操作，未发送请求。', 'VISUAL_FIXTURE_UNSUPPORTED', 400, { category: 'validation' });
};
function isolatedStorage(): Storage {
  const values = new Map<string, string>([['rhiza:onboarding-seen', '1']]);
  return {
    get length() { return values.size; }, clear: () => values.clear(),
    getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); },
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
    event.preventDefault(); blockedRequests++; phase = 'download/external navigation blocked'; updateLabel();
  }
}, true);
Object.assign(api, Object.fromEntries(Object.keys(api).map(key => [key, async () => blocked()])));
let selectedWorkspaceId: string | undefined;
api.setWorkspace = id => { selectedWorkspaceId = id; };
api.workspaceId = () => selectedWorkspaceId;

const catalog: ProviderCatalog = {
  providers: [{ id: providerId, preset: 'custom', name: '本机固定模型目录 · 研究与架构评审长名称供应商', baseUrl: 'https://rhiza-data-visual.example.test/compatible/v1', chatPath: '/chat/completions', allowNoKey: true, hasApiKey: false, configured: true, createdAt: at, updatedAt: at }],
  models: [
    { id: 'm16-data-visual-model-alpha', providerId, modelId: 'alpha', displayName: '本机 Alpha · 后续对话', favorite: true, pinned: false, createdAt: at },
    { id: 'm16-data-visual-model-long', providerId, modelId: 'research/long-model-identifier-without-truncating-historical-model-reference-20261002', displayName: '研究与架构评审模型 · LongModelNameForOverflowVerification20261002', favorite: false, pinned: true, createdAt: at },
  ], activeModelId: 'm16-data-visual-model-alpha',
};
const makeWorkspace = (projectId: string, nodeId: string, title: string): WorkspaceSnapshot => ({
  projectId, nodeId, activeNodeId: nodeId, mode: 'Assisted', contextItems: [], attachments: [], discussionEdges: [], anchors: [], manifests: [], segments: [], updatedAt: at,
  discussionNodes: [{ id: nodeId, title, summary: '固定视觉样本；不执行模型、不读取凭据、不持久化业务数据。', status: 'active', kind: 'main', x: 0, y: 0, createdAt: at, updatedAt: at }],
  messages: [{ id: `${nodeId}-history`, nodeId, kind: 'user', text: '历史已保留；后续对话的模型需单独确认。', createdAt: at }],
});
const workspaces = new Map<string, WorkspaceSnapshot>([[sourceId, makeWorkspace(sourceId, sourceNodeId, '数据与备份 · 正式界面验收')]]);
const getWorkspace = (id: string) => { const workspace = workspaces.get(id); if (!workspace) return blocked(); return structuredClone(workspace); };
api.getWorkspace = async () => ({ workspace: getWorkspace(selectedWorkspaceId ?? sourceId), provider: { configured: true, name: catalog.providers[0].name, model: catalog.models[0].displayName, baseUrl: catalog.providers[0].baseUrl }, providerCatalog: structuredClone(catalog) });
let targetReadFailed = false;
api.getScopedWorkspace = async id => {
  if (fixtureCase === 'imported' && id === targetId && workspaces.has(id) && !targetReadFailed) {
    targetReadFailed = true; phase = 'imported; target read interrupted'; updateLabel();
    throw new ApiError('', 'WORKSPACE_READ_UNAVAILABLE', 503, { category: 'infrastructure' });
  }
  return { workspace: getWorkspace(id) };
};
api.listWorkspaces = async () => ({ workspaces: [...workspaces.keys()].map(workspaceId => ({ workspaceId, name: workspaceId === sourceId ? 'RHIZA · 数据与备份固定视觉验收' : '恢复的历史研究工作区', status: 'active' as const, createdBy: 'm16-visual-user', revision: 1 })) });
api.getContextPreview = async () => ({ mode: 'Assisted', items: [], recommendations: [], omissions: [], budget: 32000, usedTokens: 0, overBudget: false });
api.listRuns = async () => ({ runs: [] });
api.listCollaborations = async () => ({ collaborations: [] });
api.getNodeCollaboration = async id => { if (![sourceNodeId, targetNodeId].includes(id)) blocked(); return { collaborations: [] }; };
api.getWorkspaceActivity = async () => ({ activity: [] });
api.getProviders = async () => ({ catalog: structuredClone(catalog), presets: {} });

type ArchiveSample = { kind: 'full' | 'thin' | 'corrupt'; workspaceId: string };
const archives = new WeakMap<File, ArchiveSample>();
function archive(sample: ArchiveSample): File {
  const file = new File(['RHIZA visual marker; not a ZIP archive.'], '研究工作区-历史附件与执行记录-20261002.rhiza', { type: 'application/vnd.rhiza.workspace+zip' });
  archives.set(file, sample); return file;
}
const sha256 = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const resourceFile = () => new File([resourceText], '精确历史文件-20261002.txt', { type: 'text/plain' });
const configuration = (mappings: BundleMappingChoice[] = []): BundleExecutionConfiguration => {
  const pairs = fixtureCase === 'warnings' ? [
    { modelSpecRef: 'historical/model-reference-with-a-long-unbroken-identifier-and-version-20261002', providerEndpointRef: 'historical-endpoint-reference-credential-required', runCount: 12 },
    { modelSpecRef: 'historical/review-model', providerEndpointRef: 'historical-secondary-endpoint', runCount: 4 },
  ] : [{ modelSpecRef: 'historical/research-model-20261002', providerEndpointRef: 'historical-research-endpoint', runCount: 8 }];
  const rows: BundleExecutionConfiguration['mappings'] = pairs.map((pair, index) => {
    const target = mappings.find(item => item.modelSpecRef === pair.modelSpecRef && item.providerEndpointRef === pair.providerEndpointRef) ?? null;
    if (target && (target.targetProviderEndpointRef !== providerId || target.targetEndpointVersion !== at || !catalog.models.some(model => model.id === target.targetModelId))) blocked();
    return { ...pair, target, currentEndpointVersion: target ? at : null, status: target ? 'ready' : 'unresolved', ...(target ? {} : { reason: fixtureCase === 'warnings' && index === 0 ? 'credential_required' : 'mapping_required' }), credentialStatus: target ? 'not-required' : 'required', discoveryStatus: target ? 'unknown' : 'unconfigured' };
  });
  return { ready: rows.every(item => item.status === 'ready'), mappingCount: rows.length, truncated: false, mappings: rows };
};
api.previewWorkspaceBundle = async (file, mappings) => {
  const sample = archives.get(file); if (!sample) return blocked();
  if (sample.kind === 'corrupt') {
    phase = 'preflight rejected'; updateLabel();
    throw new ApiError('归档摘要与历史内容不一致。', 'BUNDLE_HISTORY_MISMATCH', 400, { category: 'validation', recovery: '请重新导出完整归档后预检。' });
  }
  const missing = sample.kind === 'thin';
  const preview: BundlePreview = {
    workspaceId: sample.workspaceId, name: '长期研究与产品决策 · 历史附件、来源与执行归档', archiveDigest: await sha256(file), messages: 128, runs: 16, resourceVersions: 5, documentVersion: '3.0.0',
    canImport: !missing, reasons: missing ? ['external_content_required'] : [], missingResourceCount: missing ? 1 : 0,
    missingResources: missing ? [{ resourceId: 'historical-attachment-research-notes', resourceVersionId, digest: await sha256(resourceFile()), size: resourceFile().size, mediaType: 'text/plain' }] : [],
    missingResourcesTruncated: false, executionRequirementCount: 2, executionRequirementsTruncated: false, executionConfiguration: configuration(mappings),
  };
  phase = missing ? 'missing resource; import blocked' : 'preflight complete'; updateLabel(); return preview;
};
api.hydrateWorkspaceBundle = async (file, resources) => {
  const sample = archives.get(file); if (!sample || sample.kind !== 'thin' || Object.keys(resources).some(id => id !== resourceVersionId)) return blocked();
  const supplied = resources[resourceVersionId];
  if (!supplied || supplied.size !== resourceFile().size || await sha256(supplied) !== await sha256(resourceFile())) {
    phase = 'historical bytes rejected'; updateLabel();
    throw new ApiError('历史文件的摘要或大小不匹配，不能替代指定版本。', 'BUNDLE_EXTERNAL_CONTENT_MISMATCH', 400, { category: 'validation', recovery: '请选择完全一致的历史文件。' });
  }
  phase = 'exact fixed bytes hydrated'; updateLabel(); return archive({ ...sample, kind: 'full' });
};
const importReceipts = new Map<string, { workspaceId: string; importId: string; executionConfiguration: BundleExecutionConfiguration }>();
api.importWorkspaceBundle = async (file, key, mappings) => {
  if (importReceipts.has(key)) return structuredClone(importReceipts.get(key)!);
  const sample = archives.get(file); if (!sample || !key || sample.kind === 'corrupt') return blocked();
  if (sample.kind === 'thin') throw new ApiError('', 'BUNDLE_EXTERNAL_CONTENT_REQUIRED', 400, { category: 'validation' });
  if (workspaces.has(sample.workspaceId)) throw new ApiError('', 'BUNDLE_TARGET_EXISTS', 409, { category: 'conflict' });
  const result = { workspaceId: sample.workspaceId, importId: 'm16-visual-import-receipt', executionConfiguration: configuration(mappings) };
  workspaces.set(sample.workspaceId, makeWorkspace(sample.workspaceId, targetNodeId, '恢复的历史讨论 · 单独确认后续模型'));
  importReceipts.set(key, result); imports++; phase = 'history imported once'; updateLabel(); return structuredClone(result);
};
const preferenceReceipts = new Map<string, { identity: string; workspace: WorkspaceSnapshot }>();
let preferenceResponseLost = false;
const applyPreference = (modelId: string | null, options: { workspaceId: string; idempotencyKey: string } | undefined, nodeId?: string) => {
  if (!options || options.workspaceId !== targetId || !options.idempotencyKey || !workspaces.has(targetId) || !catalog.models.some(model => model.id === modelId) || (nodeId && nodeId !== targetNodeId)) return blocked();
  const identity = `${options.workspaceId}:${nodeId ?? 'workspace'}:${modelId}`;
  const receipt = preferenceReceipts.get(options.idempotencyKey);
  if (receipt) { if (receipt.identity !== identity) return blocked(); phase = 'preference receipt recovered'; updateLabel(); return { workspace: structuredClone(receipt.workspace) }; }
  const workspace = workspaces.get(targetId)!;
  if (nodeId) workspace.discussionNodes = workspace.discussionNodes.map(node => node.id === nodeId ? { ...node, preferredModelId: modelId! } : node);
  else workspace.defaultModelId = modelId!;
  const snapshot = structuredClone(workspace);
  preferenceReceipts.set(options.idempotencyKey, { identity, workspace: snapshot }); preferenceCommits++; updateLabel();
  if (nodeId && fixtureCase === 'imported' && !preferenceResponseLost) {
    preferenceResponseLost = true; phase = 'discussion committed; response interrupted'; updateLabel(); throw new TypeError('Fixed transport interruption.');
  }
  return { workspace: snapshot };
};
api.setWorkspaceModel = async (modelId, options) => applyPreference(modelId, options);
api.setConversationModel = async (nodeId, modelId, options) => applyPreference(modelId, options, nodeId);

const backup = (backupId: string, status: ManagedBackup['status'], extra: Partial<ManagedBackup> = {}): ManagedBackup => ({
  backupId, workspaceId: sourceId, ownerId: 'm16-visual-user', status, location: `managed://encrypted-workspace-archives/${sourceId}/long-logical-backup-location-for-overflow-verification/${backupId}`,
  startedAt: at, updatedAt: at, ...(status === 'ready' ? { completedAt: at, sizeBytes: 12 * 1024 ** 2 } : {}), ...extra,
});
let backupRows: ManagedBackup[] = fixtureCase === 'backup-ready' ? [backup('m16-backup-ready', 'ready'), backup('m16-backup-running', 'running')]
  : fixtureCase === 'backup-failed' ? [backup('m16-backup-failed', 'failed', { errorCode: 'BACKUP_LOCATION_UNAVAILABLE' }), backup('m16-backup-interrupted', 'interrupted')]
    : [];
let releasePending: (() => void) | undefined;
const waitForRelease = (label: string) => new Promise<void>(resolve => { releasePending = resolve; releaseButton.hidden = false; phase = label; updateLabel(); });
releaseButton.addEventListener('click', () => { releasePending?.(); releasePending = undefined; releaseButton.hidden = true; phase = 'fixed loading released'; updateLabel(); });
let listReleased = false;
api.listManagedBackups = async () => {
  if (selectedWorkspaceId !== sourceId) return { backups: [], reminder: { due: true, nextAt: null, intervalDays: 7 } };
  if (fixtureCase === 'backup-loading' && !listReleased) { listReleased = true; await waitForRelease('reading backups'); }
  const ready = backupRows.some(item => item.status === 'ready');
  const result: ManagedBackupList = { backups: structuredClone(backupRows), reminder: { due: !ready, nextAt: ready ? '2026-10-09T00:00:00.000Z' : null, intervalDays: 7 } };
  return result;
};
const backupReceipts = new Map<string, { retryOf?: string; result: ManagedBackup }>();
let backupResponseLost = false;
api.createManagedBackup = async (key, retryOf) => {
  if (selectedWorkspaceId !== sourceId || !key) return blocked();
  const receipt = backupReceipts.get(key);
  if (receipt) { if (receipt.retryOf !== retryOf) return blocked(); phase = 'backup receipt recovered'; updateLabel(); return structuredClone(receipt.result); }
  if (retryOf && !backupRows.some(item => item.backupId === retryOf && ['failed', 'interrupted'].includes(item.status))) return blocked();
  if (fixtureCase === 'backup-loading') await waitForRelease('creating backup');
  const result = backup(`m16-backup-created-${backupCommits + 1}`, 'ready', retryOf ? { retryOf } : {});
  backupRows = [result, ...backupRows]; backupReceipts.set(key, { retryOf, result }); backupCommits++; phase = 'backup ready'; updateLabel();
  if (fixtureCase === 'backup-failed' && !backupResponseLost) { backupResponseLost = true; phase = 'backup committed; response interrupted'; updateLabel(); throw new TypeError('Fixed transport interruption.'); }
  return structuredClone(result);
};
api.getManagedBackupArchive = async id => {
  if (selectedWorkspaceId !== sourceId || !backupRows.some(item => item.backupId === id && item.status === 'ready')) return blocked();
  return archive({ kind: 'full', workspaceId: sourceId });
};

const setFile = (input: HTMLInputElement, file: File) => {
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
};
archiveButton.hidden = fixtureCase.startsWith('backup-');
resourceButton.hidden = wrongResourceButton.hidden = fixtureCase !== 'missing';
archiveButton.addEventListener('click', async () => {
  document.querySelector<HTMLButtonElement>('.data-tabs [role="tab"]:nth-child(2)')?.click();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const input = document.querySelector<HTMLInputElement>('.workspace-data-controls input[type="file"][accept=".rhiza"]');
  if (!input) { phase = 'open data import first'; updateLabel(); return; }
  setFile(input, archive({ kind: fixtureCase === 'missing' ? 'thin' : fixtureCase === 'preflight-error' ? 'corrupt' : 'full', workspaceId: targetId }));
  phase = 'fixed archive selected; use product preflight'; updateLabel();
});
const selectResource = (wrong: boolean) => {
  const input = document.querySelector<HTMLInputElement>('.data-resource-list input[type="file"]');
  if (!input) { phase = 'preflight missing resources first'; updateLabel(); return; }
  setFile(input, wrong ? new File(['Current file cannot replace history.'], '同名但内容已变化.txt', { type: 'text/plain' }) : resourceFile());
  phase = wrong ? 'wrong historical file selected' : 'exact historical file selected'; updateLabel();
};
resourceButton.addEventListener('click', () => selectResource(false));
wrongResourceButton.addEventListener('click', () => selectResource(true));
const fixtureControls = document.getElementById('fixture-controls')!;
let toolsHidden = false;
// Keep fixture actions inside the production modal's focus boundary. A remount
// can detach this node; the observer reattaches the same controls and handlers.
const placeFixtureControls = () => {
  const modal = document.querySelector<HTMLElement>('.workspace-data-dialog, .provider-settings');
  if (modal) {
    if (fixtureControls.parentElement !== modal) modal.append(fixtureControls);
    // Clear only this fixture node's former background state after moving it.
    fixtureControls.inert = false;
    fixtureControls.hidden = toolsHidden;
  } else {
    fixtureControls.hidden = true;
    if (fixtureControls.parentElement !== document.body) document.body.append(fixtureControls);
  }
};
document.getElementById('fixture-hide')!.addEventListener('click', () => { toolsHidden = true; fixtureControls.hidden = true; });
new MutationObserver(placeFixtureControls).observe(document.getElementById('root')!, { childList: true, subtree: true });
placeFixtureControls();
history.replaceState(null, '', `${location.pathname}${location.search}#/workspaces/${sourceId}/data`);
updateLabel();
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
