export type ErrorCode =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'not_supported'
  | 'runtime_unreachable'
  | 'rate_limited'
  | 'internal';

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  not_supported: 422,
  runtime_unreachable: 502,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = STATUS[code];
  }
}
export const notFound = (what: string) => new ApiError('not_found', `${what} not found`);
export const conflict = (msg: string) => new ApiError('conflict', msg);
