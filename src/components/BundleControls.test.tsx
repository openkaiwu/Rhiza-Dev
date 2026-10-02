import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { BundleControls } from './BundleControls';
import type { BundlePreview, ProviderCatalog } from '../types';
const preview: BundlePreview = { workspaceId: 'restored', name: 'Restored workspace', archiveDigest: 'a'.repeat(64), messages: 2, runs: 1, resourceVersions: 0, documentVersion: '3.0.0', canImport: true, reasons: [], missingResourceCount: 0, missingResources: [], missingResourcesTruncated: false, executionRequirementCount: 0, executionRequirementsTruncated: false, executionConfiguration: { ready: true, mappingCount: 0, mappings: [], truncated: false } };
const catalog: ProviderCatalog = { providers: [{ id: 'provider', name: 'Fixture', preset: 'custom', baseUrl: 'http://localhost', chatPath: '/chat', allowNoKey: true, hasApiKey: false, configured: true, createdAt: '', updatedAt: 'endpoint-version' }], models: [{ id: 'model', providerId: 'provider', modelId: 'fixture', displayName: 'Fixture model', favorite: false, pinned: false, createdAt: '' }], activeModelId: 'model' };
const handlers = () => ({ onPreview: vi.fn().mockResolvedValue(preview), onImport: vi.fn().mockResolvedValue({ workspaceId: 'restored', importId: 'import', executionConfiguration: preview.executionConfiguration }), onReadImported: vi.fn().mockResolvedValue({ canApply: true }), onApplyModel: vi.fn().mockResolvedValue(undefined), onOpenImported: vi.fn().mockResolvedValue(undefined), onHydrate: vi.fn(), onBackup: vi.fn().mockResolvedValue(undefined), onRefreshBackups: vi.fn(), onBackupArchive: vi.fn(), onSettings: vi.fn() });
const selectArchive = () => { fireEvent.click(screen.getByRole('tab', { name: '导入与恢复' })); fireEvent.change(screen.getByLabelText('选择 .rhiza 归档'), { target: { files: [new File(['bundle'], 'workspace.rhiza')] } }); fireEvent.click(screen.getByRole('button', { name: '预检所选归档' })); };
const acknowledge = () => fireEvent.click(screen.getByRole('checkbox', { name: '我已确认工作区身份、归档内容及密钥需重新配置' }));

it('shows the scoped full/thin download and retries only an acknowledged import with the same identity', async () => {
  const calls = handlers(); calls.onImport.mockRejectedValueOnce(new Error('upload failed'));
  render(<BundleControls workspaceId="source" catalog={catalog} {...calls}/>);
  expect(screen.getByRole('link')).toHaveAttribute('href', '/api/v1/workspaces/source/bundle');
  fireEvent.click(screen.getByRole('checkbox', { name: '包含附件文件' })); expect(screen.getByRole('link')).toHaveAttribute('href', '/api/v1/workspaces/source/bundle?includeResources=false');
  selectArchive(); await screen.findByText('Restored workspace');
  expect(calls.onImport).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '导入所选归档' })).toBeDisabled();
  acknowledge(); fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByText('操作未完成。请检查后重试。');
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await waitFor(() => expect(calls.onImport).toHaveBeenCalledTimes(2));
  expect(calls.onImport.mock.calls[0]).toEqual(calls.onImport.mock.calls[1]);
  await screen.findByRole('button', { name: '选择其他归档' }); fireEvent.click(screen.getByRole('button', { name: '选择其他归档' })); expect(screen.queryByLabelText('归档预检结果')).not.toBeInTheDocument();
});

it('applies an imported future model only by explicit choice and retries preferences without reimporting data', async () => {
  const calls = handlers();
  const target = { modelSpecRef: 'old-model', providerEndpointRef: 'old-provider', targetModelId: 'model', targetProviderEndpointRef: 'provider', targetEndpointVersion: 'endpoint-version' };
  calls.onImport.mockResolvedValue({ workspaceId: 'restored', importId: 'import', executionConfiguration: { ready: true, mappingCount: 1, truncated: false, mappings: [{ ...target, target, runCount: 1, currentEndpointVersion: 'endpoint-version', status: 'ready', credentialStatus: 'not-required', discoveryStatus: 'unknown' }] } });
  calls.onReadImported.mockResolvedValue({ canApply: true, activeNodeId: 'restored-discussion' });
  calls.onApplyModel.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost response'));
  render(<BundleControls workspaceId="source" catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByRole('region', { name: '导入后继续对话' });
  expect(calls.onApplyModel).not.toHaveBeenCalled(); expect(screen.getByLabelText('导入后的模型')).toHaveValue('model');
  fireEvent.click(screen.getByRole('button', { name: '应用后续模型' })); await screen.findByText('归档已导入。模型设置未完成，请重试此步骤；无需重新导入。');
  fireEvent.click(screen.getByRole('button', { name: '应用后续模型' })); await screen.findByText('工作区与当前讨论的后续模型已保存，尚未实际调用模型。');
  expect(calls.onApplyModel).toHaveBeenCalledTimes(3); expect(calls.onApplyModel.mock.calls[1]).toEqual(calls.onApplyModel.mock.calls[2]);
  expect(calls.onApplyModel.mock.calls[0][2]).not.toBe(calls.onApplyModel.mock.calls[1][2]);
  expect(calls.onApplyModel).toHaveBeenLastCalledWith('restored', 'model', expect.any(String), 'restored-discussion'); expect(calls.onImport).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '打开导入的工作区' })); await waitFor(() => expect(calls.onOpenImported).toHaveBeenCalledWith('restored'));
});

it('does not claim unpersisted execution configuration is ready and keeps restored history accessible', async () => {
  const calls = handlers();
  calls.onImport.mockResolvedValue({ workspaceId: 'restored', importId: 'import', executionConfiguration: { ready: false, mappingCount: 1, truncated: false, mappings: [{ modelSpecRef: 'old-model', providerEndpointRef: 'old-provider', runCount: 1, target: null, currentEndpointVersion: null, status: 'unresolved', reason: 'mapping_required', credentialStatus: 'unknown', discoveryStatus: 'unknown' }] } });
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByRole('region', { name: '导入后继续对话' });
  expect(screen.getByLabelText('导入后的模型')).toHaveValue(''); expect(screen.getByRole('button', { name: '应用后续模型' })).toBeDisabled();
  expect(screen.getByText(/历史数据已恢复，后续对话模型尚未配置/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '打开导入的工作区' })); await waitFor(() => expect(calls.onOpenImported).toHaveBeenCalledWith('restored'));
  expect(calls.onApplyModel).not.toHaveBeenCalled();
});

it('preserves successful import across a target-read failure and retries only the scoped read', async () => {
  const calls = handlers(); calls.onReadImported.mockRejectedValueOnce(new Error('network disconnected'));
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByRole('button', { name: '重新读取导入目标' });
  expect(screen.queryByRole('button', { name: '导入所选归档' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '应用后续模型' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重新读取导入目标' })); await waitFor(() => expect(calls.onReadImported).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('button', { name: '重新读取导入目标' })).not.toBeInTheDocument());
  expect(calls.onReadImported).toHaveBeenLastCalledWith('restored'); expect(calls.onImport).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('导入后的模型'), { target: { value: 'model' } });
  fireEvent.click(screen.getByRole('button', { name: '应用后续模型' })); await screen.findByText('工作区的后续模型已保存，尚未实际调用模型。');
  expect(calls.onApplyModel).toHaveBeenCalledWith('restored', 'model', expect.any(String));
});

it('requires explicit model selection for multiple mappings even when all point to one local model', async () => {
  const calls = handlers();
  const target = { modelSpecRef: 'old', providerEndpointRef: 'old-provider', targetModelId: 'model', targetProviderEndpointRef: 'provider', targetEndpointVersion: 'endpoint-version' };
  const mapping = { modelSpecRef: 'old', providerEndpointRef: 'old-provider', runCount: 1, target, currentEndpointVersion: 'endpoint-version', status: 'ready', credentialStatus: 'not-required', discoveryStatus: 'unknown' };
  calls.onImport.mockResolvedValue({ workspaceId: 'restored', importId: 'import', executionConfiguration: { ready: true, mappingCount: 2, truncated: false, mappings: [mapping, { ...mapping, modelSpecRef: 'other', target: { ...target, modelSpecRef: 'other' } }] } });
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByRole('region', { name: '导入后继续对话' });
  expect(screen.getByLabelText('导入后的模型')).toHaveValue(''); expect(calls.onApplyModel).not.toHaveBeenCalled();
});

it('keeps committed steps after a definitive rejection and assigns a new key only after target review', async () => {
  const calls = handlers(); calls.onReadImported.mockResolvedValue({ activeNodeId: 'restored-discussion', canApply: true });
  calls.onApplyModel.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError('讨论已归档', 'NODE_ARCHIVED', 409));
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByRole('region', { name: '导入后继续对话' });
  fireEvent.change(screen.getByLabelText('导入后的模型'), { target: { value: 'model' } }); fireEvent.click(screen.getByRole('button', { name: '应用后续模型' }));
  await screen.findByRole('button', { name: '重新读取导入目标' }); expect(screen.getByRole('button', { name: '应用后续模型' })).toBeDisabled();
  expect(screen.getByText(/工作区模型：已保存.*当前讨论模型：待确认/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新读取导入目标' })); await waitFor(() => expect(screen.getByRole('button', { name: '应用后续模型' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '应用后续模型' })); await screen.findByText('工作区与当前讨论的后续模型已保存，尚未实际调用模型。');
  expect(calls.onImport).toHaveBeenCalledOnce(); expect(calls.onApplyModel).toHaveBeenCalledTimes(3);
  expect(calls.onApplyModel.mock.calls[1][2]).not.toBe(calls.onApplyModel.mock.calls[2][2]);
  expect(calls.onApplyModel.mock.calls[2]).toEqual(['restored', 'model', expect.any(String), 'restored-discussion']);
});

it('keeps failed and missing-resource preflight unavailable for import and validates supplied historical files', async () => {
  const calls = handlers(); const descriptor = { resourceId: 'resource', resourceVersionId: 'version', digest: 'b'.repeat(64), size: 12, mediaType: 'text/plain' };
  calls.onPreview.mockResolvedValueOnce({ ...preview, canImport: false, missingResourceCount: 1, missingResources: [descriptor] }); calls.onHydrate.mockResolvedValue(new File(['hydrated'], 'workspace.rhiza'));
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('缺少 1 个历史文件，导入已阻止。');
  expect(screen.queryByRole('button', { name: '导入所选归档' })).not.toBeInTheDocument();
  const file = new File(['Frozen bytes'], 'history.txt'); fireEvent.change(screen.getByLabelText('历史文件 version'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: '校验并补齐历史文件' })); await screen.findByText('历史文件校验并补齐成功。请确认后导入。');
  expect(calls.onHydrate).toHaveBeenCalledWith(expect.any(File), { version: file }); expect(calls.onImport).not.toHaveBeenCalled();
});

it('requires a new mapping preflight and binds endpoint version without migrating secrets', async () => {
  const calls = handlers(); calls.onPreview.mockResolvedValue({ ...preview, executionConfiguration: { ready: false, mappingCount: 1, truncated: false, mappings: [{ modelSpecRef: 'old-model', providerEndpointRef: 'old-provider', runCount: 1, target: null, currentEndpointVersion: null, status: 'unresolved', reason: 'mapping_required', credentialStatus: 'unknown', discoveryStatus: 'unknown' }] } });
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace');
  fireEvent.change(screen.getByLabelText('映射模型 old-model old-provider'), { target: { value: 'model' } }); acknowledge();
  expect(screen.getByRole('button', { name: '导入所选归档' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '重新检查模型映射' })); await waitFor(() => expect(calls.onPreview).toHaveBeenCalledTimes(2));
  expect(calls.onPreview).toHaveBeenLastCalledWith(expect.any(File), [{ modelSpecRef: 'old-model', providerEndpointRef: 'old-provider', targetModelId: 'model', targetProviderEndpointRef: 'provider', targetEndpointVersion: 'endpoint-version' }]);
});

it('explains target conflicts and rejects invalid file types before upload', async () => {
  const calls = handlers(); calls.onImport.mockRejectedValue(new ApiError('BUNDLE_TARGET_EXISTS', 'BUNDLE_TARGET_EXISTS', 409));
  render(<BundleControls catalog={catalog} {...calls}/>); selectArchive(); await screen.findByText('Restored workspace'); acknowledge();
  fireEvent.click(screen.getByRole('button', { name: '导入所选归档' })); await screen.findByText('目标工作区已存在，导入不会覆盖。请在不含该工作区的实例中导入。');
  fireEvent.change(screen.getByLabelText('选择 .rhiza 归档'), { target: { files: [new File(['x'], 'notes.txt')] } }); expect(screen.getByRole('button', { name: '预检所选归档' })).toBeDisabled();
});

it('offers backup creation, failed-only explicit retry, location and read-only recovery preflight', async () => {
  const calls = handlers(); calls.onBackupArchive.mockResolvedValue(new File(['backup'], 'workspace.rhiza'));
  render(<BundleControls workspaceId="source" catalog={catalog} {...calls} backups={{ reminder: { due: true, nextAt: null, intervalDays: 7 }, backups: [{ backupId: 'failed', workspaceId: 'source', ownerId: 'user', status: 'failed', location: 'managed encrypted storage', startedAt: '2026-10-02T00:00:00Z', updatedAt: '', errorCode: 'BACKUP_LOCATION_UNAVAILABLE' }, { backupId: 'ready', workspaceId: 'source', ownerId: 'user', status: 'ready', location: 'managed encrypted storage', startedAt: '2026-10-02T00:00:00Z', updatedAt: '' }] }}/>
  );
  fireEvent.click(screen.getByRole('tab', { name: '托管备份' })); fireEvent.click(screen.getByRole('button', { name: '重试备份' })); await waitFor(() => expect(calls.onBackup).toHaveBeenCalledWith(expect.any(String), 'failed'));
  await screen.findByText('重试已完成，请查看状态。'); fireEvent.click(screen.getByRole('button', { name: '恢复预检' })); await screen.findByText('Restored workspace');
  expect(calls.onBackupArchive).toHaveBeenCalledWith('ready'); expect(calls.onImport).not.toHaveBeenCalled();
});
