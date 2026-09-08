import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { BundleControls } from './BundleControls';

afterEach(() => vi.restoreAllMocks());
describe('BundleControls', () => {
  it('shows the scoped download and retries imports with the same identity', async () => {
    const upload = vi.spyOn(api, 'importWorkspaceBundle').mockRejectedValueOnce(new Error('Retry upload')).mockResolvedValue({ workspaceId: 'restored', importId: 'job' });
    const imported = vi.fn().mockResolvedValue(undefined);
    render(<BundleControls workspaceId="source" onImported={imported}/>);
    fireEvent.click(screen.getByText('导入 / 导出 Workspace'));
    expect(screen.getByRole('link')).toHaveAttribute('href', '/api/v1/workspaces/source/bundle');
    const file = new File(['bundle'], 'workspace.rhiza');
    fireEvent.change(screen.getByLabelText('选择 .rhiza 归档'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '导入所选归档' }));
    await screen.findByText('Retry upload');
    fireEvent.click(screen.getByRole('button', { name: '导入所选归档' }));
    await waitFor(() => expect(imported).toHaveBeenCalledWith('restored'));
    expect(upload.mock.calls[0]).toEqual(upload.mock.calls[1]);
  });
  it('rejects a non-bundle file before sending it', () => {
    const upload = vi.spyOn(api, 'importWorkspaceBundle');
    render(<BundleControls/>);
    fireEvent.click(screen.getByText('导入 / 导出 Workspace'));
    fireEvent.change(screen.getByLabelText('选择 .rhiza 归档'), { target: { files: [new File(['x'], 'notes.txt')] } });
    expect(screen.getByRole('button')).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });
});
