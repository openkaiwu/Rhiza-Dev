import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { presentError, presentErrorText } from './error-presentation';

const fallback = { message: '无法保存更改。', recovery: '请稍后重试。' };

describe('presentError', () => {
  it('maps application categories to safe messages and recovery actions', () => {
    expect(presentError(new ApiError('SQLSTATE 23505', 'REVISION_CONFLICT', 409, { category: 'conflict' }), fallback)).toMatchObject({
      message: '内容已被其他更改更新。',
      recovery: '请刷新工作区后重试。',
    });
    expect(presentError(new ApiError('access denied', 'FORBIDDEN', 403, { category: 'permission' }), fallback)).toMatchObject({
      message: '你没有权限执行此操作。',
      recovery: '请确认访问权限后重试。',
    });
  });

  it('does not expose raw upstream or infrastructure details', () => {
    const text = presentErrorText(new ApiError('provider key sk-secret failed at https://upstream.example', 'UPSTREAM_FAILURE', 502, { category: 'infrastructure', retryable: true, correlationId: 'corr-123' }), fallback);
    expect(text).toContain('服务暂时不可用。');
    expect(text).toContain('请稍后重试；若持续失败，请检查服务配置。');
    expect(text).toContain('追踪编号：corr-123');
    expect(text).not.toContain('sk-secret');
    expect(text).not.toContain('upstream.example');
  });

  it('keeps the explicit cancelled-generation recovery message', () => {
    expect(presentErrorText(new ApiError('internal cancellation trace', 'GENERATION_STOPPED', 499), fallback)).toBe('生成已停止，本轮未写入历史。可以修改输入后重新发送。');
  });
});
