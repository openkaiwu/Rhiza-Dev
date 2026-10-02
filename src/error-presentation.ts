import { ApiError, type ApiErrorCategory } from './api';

export interface PresentedError {
  message: string;
  recovery: string;
  correlationId?: string;
}

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  category?: unknown;
  retryable?: unknown;
  correlationId?: unknown;
};

const categoryMessages: Record<ApiErrorCategory, PresentedError> = {
  validation: { message: '提交的内容需要调整。', recovery: '请检查输入后再试。' },
  conflict: { message: '内容已被其他更改更新。', recovery: '请刷新工作区后重试。' },
  permission: { message: '你没有权限执行此操作。', recovery: '请确认访问权限后重试。' },
  not_found: { message: '目标内容已不存在或无法访问。', recovery: '请刷新工作区后重试。' },
  infrastructure: { message: '服务暂时不可用。', recovery: '请稍后重试。' },
};

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? error as ErrorLike : {};
}

function inferCategory(error: ErrorLike): ApiErrorCategory | undefined {
  if (typeof error.category === 'string' && error.category in categoryMessages) return error.category as ApiErrorCategory;
  if (typeof error.status === 'number') {
    if (error.status === 401 || error.status === 403) return 'permission';
    if (error.status === 404) return 'not_found';
    if (error.status === 409 || error.status === 412) return 'conflict';
    if (error.status >= 400 && error.status < 500) return 'validation';
    if (error.status >= 500) return 'infrastructure';
  }
  return undefined;
}

/**
 * Converts untrusted HTTP and runtime failures into a small, actionable UI
 * vocabulary. In particular, provider and infrastructure messages are never
 * rendered verbatim because they can contain implementation details or keys.
 */
export function presentError(error: unknown, fallback: PresentedError): PresentedError {
  const details = asErrorLike(error);
  const code = typeof details.code === 'string' ? details.code : '';
  if (code === 'GENERATION_STOPPED') return { message: '生成已停止，本轮未写入历史。', recovery: '可以修改输入后重新发送。' };
  if (code === 'STREAM_UNAVAILABLE' || code === 'INCOMPLETE_STREAM') return { message: '生成连接意外中断。', recovery: '请重试；本轮未写入历史。' };

  const specific: Record<string, PresentedError> = {
    PROVIDER_INPUT_INVALID: { message: '模型无法处理当前输入。', recovery: '请调整消息、附件或生成参数。' },
    PROVIDER_AUTH_FAILED: { message: '模型认证失败。', recovery: '请在模型设置检查凭据。' },
    PROVIDER_RATE_LIMITED: { message: '模型请求频率受限。', recovery: '请稍后手动重试。' },
    PROVIDER_TIMEOUT: { message: '生成超时。', recovery: '请查看执行状态后重试。' },
    PROVIDER_UNREACHABLE: { message: '无法连接模型。', recovery: '请检查网络后重试。' },
    PROCESS_INTERRUPTED: { message: '执行中断。', recovery: '请查看执行历史，确认后重试。' },
    MODEL_NOT_FOUND: { message: '选择的模型不可用。', recovery: '请重新选择模型。' },
    RUN_COMMIT_FAILED: { message: '结果保存失败。', recovery: '请查看执行记录后重试。' },
  };
  if (specific[code]) return specific[code];
  const category = inferCategory(details);
  const presented = category ? categoryMessages[category] : fallback;
  const retryable = details.retryable === true || category === 'infrastructure';
  return {
    ...presented,
    recovery: retryable && presented.recovery === '请稍后重试。' ? '请稍后重试；若持续失败，请检查服务配置。' : presented.recovery,
    correlationId: typeof details.correlationId === 'string' ? details.correlationId : undefined,
  };
}

export function presentErrorText(error: unknown, fallback: PresentedError): string {
  const presented = presentError(error, fallback);
  const trace = presented.correlationId ? `（追踪编号：${presented.correlationId}）` : '';
  return `${presented.message}${presented.recovery}${trace}`;
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
