export type ApplicationErrorCategory = 'validation' | 'conflict' | 'permission' | 'not_found' | 'infrastructure';

export type RecoveryAction = 'retry' | 'refresh' | 'contact_support' | 'select_model' | 'restore_node' | 'none';

/** Transport-independent error shape exposed by the Application boundary. */
export class ApplicationError extends Error {
  readonly name = 'ApplicationError';

  constructor(
    message: string,
    readonly details: {
      code: string;
      category: ApplicationErrorCategory;
      status: number;
      retryable: boolean;
      recovery: RecoveryAction;
      cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
  }
}

export function applicationError(
  message: string,
  code: string,
  category: ApplicationErrorCategory,
  recovery: RecoveryAction = 'none',
  retryable = false,
  status = defaultStatus(category),
): ApplicationError {
  return new ApplicationError(message, { code, category, status, recovery, retryable });
}

function defaultStatus(category: ApplicationErrorCategory): number {
  return ({ validation: 400, conflict: 409, permission: 403, not_found: 404, infrastructure: 503 })[category];
}
