import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PurgeNodeControl } from './PurgeNodeControl';

it('requires the exact confirmation and reason, prevents duplicate submissions, and exposes rejection', async () => {
  let reject!: (error: Error) => void;
  const onPurge = vi.fn(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  render(<PurgeNodeControl nodeId="node-one" title="Archived" onPurge={onPurge}/>);
  fireEvent.click(screen.getByRole('button', { name: '永久清除' }));
  const submit = screen.getByRole('button', { name: '确认永久清除' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('清除确认文本'), { target: { value: 'PURGE another' } });
  fireEvent.change(screen.getByLabelText('清除原因'), { target: { value: '  requested  ' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('清除确认文本'), { target: { value: 'PURGE node-one' } });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(onPurge).toHaveBeenCalledExactlyOnceWith('node-one', 'PURGE node-one', 'requested');
  reject(new Error('存在跨节点引用'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('存在跨节点引用'));
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
});
