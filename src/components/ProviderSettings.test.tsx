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
