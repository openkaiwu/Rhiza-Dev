import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DisclosureMenu } from './DisclosureMenu';

it('returns focus to the trigger on Escape and closes after an action', () => {
  render(<DisclosureMenu label="更多操作"><button>查看历史</button></DisclosureMenu>);
  const trigger = screen.getByLabelText('更多操作');
  const disclosure = trigger.closest('details')!;
  fireEvent.click(trigger);
  disclosure.open = true;
  screen.getByRole('button', { name: '查看历史' }).focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(disclosure.open).toBe(false);
  expect(trigger).toHaveFocus();
  disclosure.open = true;
  fireEvent.click(screen.getByRole('button', { name: '查看历史' }));
  expect(disclosure.open).toBe(false);
});

it('dismisses on outside interaction without stealing the new focus', () => {
  render(<><DisclosureMenu label="更多操作"><button>查看历史</button></DisclosureMenu><button>外部操作</button></>);
  const disclosure = screen.getByText('更多操作').closest('details')!;
  disclosure.open = true;
  const outside = screen.getByRole('button', { name: '外部操作' });
  outside.focus();
  fireEvent.pointerDown(outside);
  expect(disclosure.open).toBe(false);
  expect(outside).toHaveFocus();
});
