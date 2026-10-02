// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResourceView } from './ResourceView';
import type { ResourceVersionView } from '../types';
const data: ResourceVersionView = { resource: { id: 'r', workspaceId: 'w', kind: 'file', title: '旧说明' }, version: { id: 'v-old', resourceId: 'r', version: 1, digestAlgorithm: 'sha256', digest: 'a'.repeat(64), canonicalization: 'raw-v1', mediaType: 'text/plain', size: 12, createdAt: '2026-01-01T00:00:00Z' }, preview: { kind: 'text', text: '<script>frozen</script>\n旧原文' } };
const props = () => ({ attachments: [], sources: [], loading: false, downloadBusy: false, onVersion: vi.fn(), onManifest: vi.fn(), onRetry: vi.fn(), onDownload: vi.fn() });
describe('ResourceView', () => {
  it('renders exact frozen text inertly and keeps download plus source return explicit', () => {
    const p = props(); render(<ResourceView {...p} data={data} resourceId="r" versionId="v-old" sources={[{resourceId:'r',versionId:'v-old',title:'旧来源',manifestId:'m',sourceIndex:2}]}/>);
    expect(screen.getByLabelText('此版本原文').querySelector('script')).toBeNull(); expect(screen.getByLabelText('此版本原文').textContent).toBe(data.preview.kind === 'text' ? data.preview.text : '');
    fireEvent.click(screen.getByRole('button',{name:'下载此版本原文'})); expect(p.onDownload).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'返回冻结上下文'})); expect(p.onManifest).toHaveBeenCalledWith('m',2);
  });
  it('exposes recovery for a missing version without a download or replacement preview', () => {
    const p = props(); render(<ResourceView {...p} resourceId="r" versionId="missing" error="原版本不可读取"/>);
    expect(screen.getByRole('alert')).toHaveTextContent('原版本不可读取'); expect(screen.queryByRole('button',{name:'下载此版本原文'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'重新读取资源'})); expect(p.onRetry).toHaveBeenCalledOnce();
  });
  it('preserves the explicit attachment version and labels binary or oversized previews', () => {
    const p = props(); const {rerender} = render(<ResourceView {...p} attachments={[{id:'a',resourceId:'r',resourceVersionId:'v-current',name:'附件',mimeType:'image/png',size:10,kind:'file',createdAt:''}]}/>);
    fireEvent.click(screen.getByRole('button',{name:'查看附件原文'})); expect(p.onVersion).toHaveBeenCalledWith('r','v-current');
    rerender(<ResourceView {...p} resourceId="r" versionId="v-old" data={{...data,preview:{kind:'binary'}}} downloadBusy/>);
    expect(screen.getByText(/此文件不提供文本预览/)).toBeInTheDocument(); expect(screen.getByRole('button',{name:'正在读取原文…'})).toBeDisabled();
    rerender(<ResourceView {...p} resourceId="r" versionId="v-old" data={{...data,preview:{kind:'too_large'}}}/>); expect(screen.getByText(/内容超过预览大小/)).toBeInTheDocument();
  });
});
