// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('reports/m15-m18/design/preview.html', 'utf8');
const script = readFileSync('reports/m15-m18/design/preview.js', 'utf8');
let dom: JSDOM;

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:4175/preview.html' });
  dom.window.matchMedia = () => ({ matches: false, addEventListener: () => undefined });
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  // JSDOM does not implement the browser's native modal dialog methods.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event('close'));
  };
  dom.window.setTimeout = setTimeout;
  dom.window.clearTimeout = clearTimeout;
  dom.window.fetch = vi.fn();
  dom.window.eval(script);
});
afterEach(() => { dom.window.close(); vi.useRealTimers(); });

const element = (id: string) => dom.window.document.getElementById(id)!;
const click = (id: string) => element(id).click();
const launch = () => dom.window.document.querySelector<HTMLButtonElement>('.composer-collaboration')!.click();

describe('conversation collaboration design contract', () => {
  it('opens inside Chat and freezes the selected models and question without navigation', () => {
    launch();
    const checkbox = dom.window.document.querySelector<HTMLInputElement>('[data-participant="b"]')!;
    checkbox.click();
    expect(element('start-collab').hasAttribute('disabled')).toBe(true);
    expect(element('participant-validation').textContent).toContain('请选择 2–4');
    checkbox.click();
    dom.window.document.querySelector<HTMLInputElement>('[data-participant="c"]')!.click();
    dom.window.document.querySelector<HTMLInputElement>('[data-participant="d"]')!.click();
    const mode = element('collaboration-mode') as HTMLSelectElement;
    mode.value = 'second-opinion';
    mode.dispatchEvent(new dom.window.Event('change'));
    click('start-collab');
    vi.advanceTimersByTime(650);
    expect(element('participant-results').children).toHaveLength(4);
    expect(element('collaboration-turn').closest('#chat')).not.toBeNull();
    expect(element('chat').hasAttribute('hidden')).toBe(false);
    expect(element('page-title').textContent).toBe('信息架构方向');
    expect(dom.window.document.querySelector('[data-view="collaboration"]')).toBeNull();
    expect(element('collaboration-frozen-label').textContent).toContain('第二意见 · 4 位参与者');
    click('accept');
    dom.window.document.querySelector<HTMLButtonElement>('#collaboration-frozen button')!.click();
    expect(element('dialog-body').textContent).toContain('研究模型 D');
    expect(element('dialog-body').textContent).not.toContain('移动端导航方案 v2');
    expect(dom.window.fetch).not.toHaveBeenCalled();
  });

  it('retries only the failed participant, retains once and continues the same discussion', () => {
    launch(); click('start-collab'); vi.advanceTimersByTime(650);
    const completed = element('participant-results').children[0].textContent;
    dom.window.document.querySelector<HTMLButtonElement>('[data-retry-participant="b"]')!.click();
    expect(element('collaboration-state').textContent).toBe('执行中');
    expect(element('collab-copy').textContent).toContain('其他参与者的已完成意见保持不变');
    vi.advanceTimersByTime(650);
    expect(element('participant-results').children[0].textContent).toBe(completed);
    expect(element('synthesis').hasAttribute('hidden')).toBe(false);
    expect(element('synthesis-copy').textContent).toContain('仍有分歧');
    click('retain'); click('retain');
    expect(dom.window.document.querySelectorAll('#chat .collaboration-retained')).toHaveLength(1);
    const input = element('message-input') as HTMLTextAreaElement;
    input.value = '基于这些意见，给出下一步验证任务';
    input.dispatchEvent(new dom.window.Event('input'));
    element('composer-form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    expect(dom.window.document.querySelector('#chat .collaboration-followup')?.textContent).toContain('基于已纳入的协作结果');
    expect(element('page-title').textContent).toBe('信息架构方向');
    expect(dom.window.fetch).not.toHaveBeenCalled();
  });

  it('stops pending dispatch and retains partial opinions with missing participants identified', () => {
    launch(); click('start-collab'); click('stop'); vi.advanceTimersByTime(650);
    expect(element('participant-results').textContent).not.toContain('已完成');
    expect(element('synthesis').hasAttribute('hidden')).toBe(true);
    expect(element('summarize').hasAttribute('hidden')).toBe(true);
    dom.window.document.querySelector<HTMLButtonElement>('[data-thread="移动端导航方案"]')!.click();
    dom.window.document.querySelector<HTMLButtonElement>('[data-thread="信息架构方向"]')!.click();
    launch(); click('start-collab'); vi.advanceTimersByTime(650); click('summarize'); click('retain');
    expect(dom.window.document.querySelector('.collaboration-retained')?.textContent).toContain('缺席意见：研究模型 B');
    expect(dom.window.document.querySelector('.collaboration-retained')?.textContent).toContain('不能据此声称形成共识');
    expect(dom.window.document.querySelector('[data-retry-participant]')).toBeNull();
  });
});
