import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProviderSettings } from './ProviderSettings';
import type { ProviderCatalog } from '../types';
const catalog: ProviderCatalog = { activeModelId: 'a', providers: [{ id: 'p', name: 'Fixture', preset: 'custom', baseUrl: 'https://example.test', chatPath: '/chat', allowNoKey: true, hasApiKey: false, configured: true, createdAt: '', updatedAt: 'endpoint-1', discoveryHealth: { endpointVersion: 'endpoint-1', status: 'degraded', code: 'MODEL_DISCOVERY_TIMEOUT' } }, { id: 'other', name: 'Other', preset: 'custom', baseUrl: 'https://other.test', chatPath: '/chat', allowNoKey: true, hasApiKey: false, configured: true, createdAt: '', updatedAt: '' }], models: [{ id: 'a', providerId: 'p', displayName: 'Alpha', modelId: 'alpha', favorite: true, pinned: false, createdAt: '' }, { id: 'b', providerId: 'p', displayName: 'Beta', modelId: 'beta', favorite: false, pinned: true, createdAt: '' }] };
const props = { catalog, presets: {}, onClose: vi.fn(), onSave: vi.fn(), onDiscover: vi.fn(), onToggleModel: vi.fn(), onSelectModel: vi.fn().mockResolvedValue(undefined) };

it('distinguishes failed discovery from manually configured model use and provides recoverable catalog filters', async () => {
  render(<ProviderSettings {...props}/>);
  await screen.findByText('目录同步失败');
  expect(screen.getByText(/已手动配置的模型仍可尝试对话/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('筛选模型目录'), { target: { value: 'favorite' } });
  expect(screen.getByText('Alpha')).toBeInTheDocument(); expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索模型目录'), { target: { value: 'unknown' } });
  expect(screen.getByText(/没有匹配的模型/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索模型目录'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '设为默认模型 Alpha' }));
  await waitFor(() => expect(props.onSelectModel).toHaveBeenCalledWith('a'));
});

it('retries only the failed provider from a completed batch and keeps all provider configuration visible', async () => {
  const batch = vi.fn().mockResolvedValueOnce([{ providerId: 'p', status: 'failed' }, { providerId: 'other', status: 'succeeded' }]).mockResolvedValue([{ providerId: 'p', status: 'succeeded' }]);
  render(<ProviderSettings {...props} onDiscoverBatch={batch}/>);
  fireEvent.click(screen.getByRole('button', { name: '同步所有目录' }));
  await screen.findByRole('button', { name: '仅重试失败目录 · 1' });
  fireEvent.click(screen.getByRole('button', { name: '仅重试失败目录 · 1' }));
  await waitFor(() => expect(batch).toHaveBeenLastCalledWith(['p'], true));
  expect(batch.mock.calls[0]).toEqual([['p', 'other'], false]);
  expect(screen.getByText('Other')).toBeInTheDocument();
});

it('keeps an explicit new provider draft separate from the existing connection and saved key', async () => {
  const existingCatalog: ProviderCatalog = { ...catalog, providers: catalog.providers.map(provider => ({ ...provider, hasApiKey: provider.id === 'p' })) };
  const originalProvider = structuredClone(existingCatalog.providers[0]);
  const save = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<ProviderSettings {...props} catalog={existingCatalog} onSave={save}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('Fixture');
  expect(screen.getByText('已安全保存，留空则保持不变')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '新增供应商' }));
  expect(screen.getByLabelText('名称')).toHaveValue('OpenAI');
  expect(screen.queryByText('已安全保存，留空则保持不变')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New connection' } });
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://new.example.test/v1' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'new-provider-key' } });
  fireEvent.change(screen.getByLabelText('手动添加模型'), { target: { value: 'new-model' } });
  rerender(<ProviderSettings {...props} catalog={{ ...existingCatalog, providers: [...existingCatalog.providers] }} onSave={save}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('New connection');
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ preset: 'openai', name: 'New connection', baseUrl: 'https://new.example.test/v1', apiKey: 'new-provider-key', allowNoKey: false, modelId: 'new-model' }));
  expect(save.mock.calls[0][0]).not.toHaveProperty('id');
  expect(existingCatalog.providers[0]).toEqual(originalProvider);

  fireEvent.click(screen.getByRole('button', { name: 'Fixture目录同步失败' }));
  expect(screen.getByLabelText('名称')).toHaveValue('Fixture');
  expect(screen.getByLabelText('Base URL')).toHaveValue('https://example.test');
  expect(screen.getByText('已安全保存，留空则保持不变')).toBeInTheDocument();
  expect(screen.getByLabelText(/API Key/)).toHaveValue('');
});

it('selects the first asynchronously loaded provider once without replacing a later new draft', () => {
  const empty: ProviderCatalog = { providers: [], models: [], activeModelId: null };
  const { rerender } = render(<ProviderSettings {...props} catalog={empty}/>);
  rerender(<ProviderSettings {...props}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('Fixture');
  fireEvent.click(screen.getByRole('button', { name: '新增供应商' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Explicit new draft' } });
  rerender(<ProviderSettings {...props} catalog={{ ...catalog, providers: [...catalog.providers] }}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('Explicit new draft');
});

it('preserves a manually started connection draft when the initial catalog arrives', () => {
  const empty: ProviderCatalog = { providers: [], models: [], activeModelId: null };
  const { rerender } = render(<ProviderSettings {...props} catalog={empty}/>);
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Local draft' } });
  fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://127.0.0.1:11434/v1' } });
  rerender(<ProviderSettings {...props}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('Local draft');
  expect(screen.getByLabelText('Base URL')).toHaveValue('http://127.0.0.1:11434/v1');
});

it('selects the newly saved provider after its catalog arrives and updates the same connection on resave', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(<ProviderSettings {...props} onSave={save}/>);
  fireEvent.click(screen.getByRole('button', { name: '新增供应商' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Created connection' } });
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'created-connection-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).not.toHaveProperty('id');
  await screen.findByText('供应商配置已保存。');
  expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();

  const createdCatalog: ProviderCatalog = { ...catalog, providers: [...catalog.providers, { ...catalog.providers[0], id: 'created-provider', preset: 'openai', name: 'Created connection', baseUrl: 'https://api.openai.com/v1', allowNoKey: false, hasApiKey: true, discoveryHealth: undefined }] };
  rerender(<ProviderSettings {...props} catalog={createdCatalog} onSave={save}/>);
  expect(screen.getByLabelText('名称')).toHaveValue('Created connection');
  expect(screen.getByLabelText(/API Key/)).toHaveValue('');
  expect(screen.getByText('编辑')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '获取模型' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Renamed connection' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1][0]).toMatchObject({ id: 'created-provider', name: 'Renamed connection', apiKey: '' });
});
