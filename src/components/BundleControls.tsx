import { useRef, useState } from 'react';
import { ApiError } from '../api';
import { presentErrorText } from '../error-presentation';
import type { BundleMappingChoice, BundlePreview, ManagedBackupList, ProviderCatalog } from '../types';

export interface BundleControlsProps {
  workspaceId?: string;
  catalog: ProviderCatalog;
  backups?: ManagedBackupList;
  backupsLoading?: boolean;
  backupsError?: string;
  onPreview: (file: File, mappings?: BundleMappingChoice[]) => Promise<BundlePreview>;
  onImport: (file: File, key: string, mappings?: BundleMappingChoice[]) => Promise<void>;
  onHydrate: (file: File, resources: Record<string, File>) => Promise<File>;
  onBackup: (key: string, retryOf?: string) => Promise<void>;
  onRefreshBackups: () => void;
  onBackupArchive: (id: string) => Promise<File>;
  onSettings: () => void;
}
const backupStatus = { running: '备份中', ready: '可恢复', failed: '失败', interrupted: '已中断', purged: '已清除' };
const mappingReasons: Record<string, string> = { mapping_required: '请选择本机模型', model_missing: '模型已移除', endpoint_missing: '供应商已移除', endpoint_mismatch: '供应商不匹配', endpoint_changed: '连接配置已变化，请重新预检', credential_required: '需要配置密钥', credential_invalid: '密钥已失效' };

export function BundleControls({ workspaceId, catalog, backups, backupsLoading, backupsError, onPreview, onImport, onHydrate, onBackup, onRefreshBackups, onBackupArchive, onSettings }: BundleControlsProps) {
  const [tab, setTab] = useState<'export' | 'import' | 'backups'>('export');
  const [includeResources, setIncludeResources] = useState(true);
  const [selection, setSelection] = useState<{ file: File; key: string }>();
  const [preview, setPreview] = useState<BundlePreview>();
  const [choices, setChoices] = useState<BundleMappingChoice[]>([]);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [resources, setResources] = useState<Record<string, File>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const running = useRef(false);
  const backupKeys = useRef(new Map<string, string>());
  const run = async (operation: () => Promise<void>, pending: string) => {
    if (running.current) return;
    running.current = true; setBusy(true); setMessage(pending);
    try { await operation(); }
    catch (error) { setMessage(error instanceof ApiError && error.code === 'BUNDLE_TARGET_EXISTS' ? '目标工作区已存在，导入不会覆盖。请在不含该工作区的实例中导入。' : presentErrorText(error, { message: '操作未完成。', recovery: '请检查后重试。' })); }
    finally { running.current = false; setBusy(false); }
  };
  const selectFile = (file?: File) => {
    setPreview(undefined); setMessage(''); setChoices([]); setResources({}); setAcknowledged(false); setMappingDirty(false);
    if (file && (!file.name.toLowerCase().endsWith('.rhiza') || file.size > 2 * 1024 ** 3)) { setSelection(undefined); setMessage('请选择不超过 2 GiB 的 .rhiza 文件。'); return; }
    setSelection(file ? { file, key: crypto.randomUUID() } : undefined);
  };
  const preflight = () => run(async () => {
    if (!selection) return;
    const result = await onPreview(selection.file, choices.length ? choices : undefined);
    setPreview(result); setAcknowledged(false); setMappingDirty(false);
    setMessage(result.canImport ? '归档校验通过。请确认内容和安全提示后导入。' : '归档缺少历史文件，补齐并校验通过后才能导入。');
  }, '正在预检归档…');
  const importBundle = () => run(async () => {
    if (!selection || !preview?.canImport || !acknowledged || mappingDirty) return;
    await onImport(selection.file, selection.key, choices.length ? choices : undefined); setMessage('导入成功。');
  }, '正在校验并导入，请勿关闭页面。');
  return <div className="workspace-data-controls">
    <div className="data-tabs" role="tablist" aria-label="数据操作">{([['export', '导出'], ['import', '导入与恢复'], ['backups', '托管备份']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} disabled={busy} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'export' && <section aria-label="导出工作区"><h3>保存完整工作区</h3><p>保留讨论、历史版本、执行和来源引用。归档包含正文，请妥善保管；下载副本无法通过本实例的清除操作撤回。</p><label className="data-check"><input type="checkbox" checked={includeResources} onChange={event => setIncludeResources(event.target.checked)}/>包含附件文件</label>{!includeResources && <p role="status">仅导出文件描述：摘要、大小和历史版本。恢复时必须提供完全一致的历史文件，当前文件不能替代。</p>}{workspaceId && <a className="primary-button" href={`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/bundle${includeResources ? '' : '?includeResources=false'}`} download="workspace.rhiza">下载 workspace.rhiza</a>}</section>}
    {tab === 'import' && <section aria-label="导入工作区"><h3>导入前检查</h3><p>保留原身份，仅限归档 owner；已有工作区不会覆盖。导入和预检不会执行模型。</p><label>选择 .rhiza 归档<input type="file" accept=".rhiza" disabled={busy} onChange={event => selectFile(event.target.files?.[0])}/></label>{selection && <p>{selection.file.name} · {(selection.file.size / 1024).toFixed(1)} KiB</p>}
      <button disabled={!selection || busy} onClick={() => void preflight()}>预检所选归档</button>
      {preview && <section className="data-preflight" aria-label="归档预检结果"><h4>{preview.name}</h4><p>{preview.messages} 条消息 · {preview.runs} 次执行 · {preview.resourceVersions} 个资源版本</p><p className="data-identity">工作区：{preview.workspaceId}<br/>归档校验：{preview.archiveDigest}</p>
        {!!preview.missingResourceCount && <><p role="alert">缺少 {preview.missingResourceCount} 个历史文件，导入已阻止。</p><ul className="data-resource-list">{preview.missingResources.map(item => <li key={item.resourceVersionId}><strong>{item.resourceVersionId}</strong><small>{item.mediaType} · {item.size} B · SHA256 {item.digest}</small><label>提供精确历史文件<input type="file" disabled={busy} aria-label={`历史文件 ${item.resourceVersionId}`} onChange={event => { const file = event.target.files?.[0]; setResources(previous => { const next = { ...previous }; if (file) next[item.resourceVersionId] = file; else delete next[item.resourceVersionId]; return next; }); }}/></label></li>)}</ul>{preview.missingResourcesTruncated && <p>清单过长，请使用完整文件导出重新生成归档。</p>}<button disabled={busy || preview.missingResourcesTruncated || preview.missingResources.some(item => !resources[item.resourceVersionId])} onClick={() => void run(async () => { if (!selection) return; const file = await onHydrate(selection.file, resources); selectFile(file); setPreview(await onPreview(file)); setMessage('历史文件校验并补齐成功。请确认后导入。'); }, '正在校验历史文件…')}>校验并补齐历史文件</button></>}
        <details open={!preview.executionConfiguration.ready}><summary>继续对话的模型配置 · {preview.executionConfiguration.mappingCount} 项</summary><p>密钥不会随归档迁移。映射只用于后续配置，不改写历史；Exact Replay 仍需原执行配置。</p>{preview.executionConfiguration.mappings.slice(0, 64).map(mapping => {
          const chosen = choices.find(item => item.modelSpecRef === mapping.modelSpecRef && item.providerEndpointRef === mapping.providerEndpointRef);
          return <label className="data-mapping" key={`${mapping.modelSpecRef}:${mapping.providerEndpointRef}`}><span>{mapping.modelSpecRef} · {mapping.runCount} 次执行<small>{mappingReasons[mapping.reason ?? ''] ?? (mapping.status === 'ready' ? '本机配置已就绪，尚未实际验证模型' : '需要本机配置')}</small></span><select aria-label={`映射模型 ${mapping.modelSpecRef} ${mapping.providerEndpointRef}`} disabled={busy} value={chosen?.targetModelId ?? ''} onChange={event => {
            const model = catalog.models.find(item => item.id === event.target.value); const provider = catalog.providers.find(item => item.id === model?.providerId);
            setChoices(previous => [...previous.filter(item => item.modelSpecRef !== mapping.modelSpecRef || item.providerEndpointRef !== mapping.providerEndpointRef), ...(model && provider ? [{ modelSpecRef: mapping.modelSpecRef, providerEndpointRef: mapping.providerEndpointRef, targetModelId: model.id, targetProviderEndpointRef: provider.id, targetEndpointVersion: provider.updatedAt }] : [])]); setAcknowledged(false); setMappingDirty(true); setSelection(previous => previous ? { ...previous, key: crypto.randomUUID() } : previous);
          }}><option value="">保留历史，稍后配置</option>{catalog.models.map(model => <option key={model.id} value={model.id}>{model.displayName} · {catalog.providers.find(item => item.id === model.providerId)?.name}</option>)}</select></label>;
        })}{(preview.executionConfiguration.truncated || preview.executionConfiguration.mappingCount > 64) && <p>更多历史映射需导入后逐项配置。</p>}<button disabled={busy} onClick={onSettings}>打开模型设置</button>{choices.length > 0 && <button disabled={busy} onClick={() => void preflight()}>重新检查模型映射</button>}</details>
        {preview.canImport && <><label className="data-check"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)}/>我已确认工作区身份、归档内容及密钥需重新配置</label><button className="primary-button" disabled={busy || !acknowledged || mappingDirty} onClick={() => void importBundle()}>导入所选归档</button></>}
      </section>}
    </section>}
    {tab === 'backups' && <section aria-label="托管备份"><h3>本机加密备份</h3><p>完整保留附件与历史，备份位于当前实例。清除操作会同步处置受影响的托管副本；已下载副本需自行管理。</p><p role="status">{backupsLoading ? '正在读取备份…' : backups?.reminder.due ? '建议创建备份：尚无近期可恢复备份。' : backups?.reminder.nextAt ? `下次提醒：${new Date(backups.reminder.nextAt).toLocaleString()}` : '备份提醒暂不可用'}</p><div className="data-actions"><button className="primary-button" disabled={busy} onClick={() => void run(async () => { const key = backupKeys.current.get('create') ?? crypto.randomUUID(); backupKeys.current.set('create', key); await onBackup(key); backupKeys.current.delete('create'); setMessage('备份操作已完成，请查看状态。'); }, '正在创建完整备份…')}>立即备份</button><button disabled={busy || backupsLoading} onClick={onRefreshBackups}>刷新备份</button></div>{backupsError && <p role="alert">{backupsError}</p>}{!backupsLoading && backups?.backups.length === 0 && <p>还没有托管备份。</p>}<ul className="data-backup-list">{backups?.backups.map(backup => <li key={backup.backupId}><header><strong>{backupStatus[backup.status]}</strong><time>{new Date(backup.startedAt).toLocaleString()}</time></header><p>位置：{backup.location}</p>{backup.sizeBytes !== undefined && <small>{(backup.sizeBytes / 1024 ** 2).toFixed(2)} MiB</small>}{backup.errorCode && <p role="status">{backup.errorCode === 'BACKUP_LOCATION_UNAVAILABLE' ? '备份位置不可用，请检查本机存储空间或权限后重试。' : '备份未完成，请重试。'}</p>}{backup.status === 'ready' && <div className="data-actions"><a href={`/api/v1/workspaces/${encodeURIComponent(workspaceId ?? '')}/backups/${encodeURIComponent(backup.backupId)}/archive`} download="workspace.rhiza">下载恢复归档</a><button disabled={busy} onClick={() => void run(async () => { const file = await onBackupArchive(backup.backupId); selectFile(file); setPreview(await onPreview(file)); setTab('import'); setMessage('恢复归档校验完成。已有工作区不会覆盖；可下载后在空实例中恢复。'); }, '正在读取恢复归档…')}>恢复预检</button></div>}{['failed', 'interrupted'].includes(backup.status) && <button disabled={busy} onClick={() => void run(async () => { const key = backupKeys.current.get(backup.backupId) ?? crypto.randomUUID(); backupKeys.current.set(backup.backupId, key); await onBackup(key, backup.backupId); backupKeys.current.delete(backup.backupId); setMessage('重试已完成，请查看状态。'); }, '正在重试备份…')}>重试备份</button>}</li>)}</ul></section>}
    <p className="data-feedback" role="status" aria-live="polite">{message}</p>
  </div>;
}
