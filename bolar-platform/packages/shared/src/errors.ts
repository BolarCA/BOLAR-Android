/** Error contract shared by API and web: {code,message,requestId,fieldErrors?} */
export type ErrorCode =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'review_required'
  | 'not_found'
  | 'conflict'
  | 'idempotency_conflict'
  | 'rate_limited'
  | 'invalid_transition'
  | 'legal_hold'
  | 'internal_error';

export interface FieldError {
  path: string;
  message: string;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: FieldError[];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldError[];
  readonly details?: Record<string, unknown>;
  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    opts: { fieldErrors?: FieldError[]; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.fieldErrors = opts.fieldErrors;
    this.details = opts.details;
  }
}

export const errors = {
  validation: (fieldErrors: FieldError[], message = 'Validation failed') =>
    new AppError('validation_error', message, 400, { fieldErrors }),
  unauthenticated: (message = 'Authentication required') =>
    new AppError('unauthenticated', message, 401),
  /** Generic denial. Never include resource existence details in message. */
  forbidden: (message = 'You do not have access to this resource') =>
    new AppError('forbidden', message, 403),
  /** Sensitive access gate did not pass; UI shows request-access state. */
  reviewRequired: (message = 'Access to this record requires an approved purpose') =>
    new AppError('review_required', message, 403),
  /** Used for both missing and denied-restricted records so existence is not leaked. */
  notFound: (message = 'Not found') => new AppError('not_found', message, 404),
  conflict: (message = 'Conflict') => new AppError('conflict', message, 409),
  idempotencyConflict: (message = 'Idempotency key reused with a different payload') =>
    new AppError('idempotency_conflict', message, 409),
  invalidTransition: (from: string, to: string) =>
    new AppError('invalid_transition', `Cannot transition from ${from} to ${to}`, 409, {
      details: { from, to },
    }),
  legalHold: (message = 'Record is under legal hold') => new AppError('legal_hold', message, 409),
  internal: (message = 'Internal error') => new AppError('internal_error', message, 500),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
