export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'ROOM_NOT_FOUND'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'STALE_REVISION'
  | 'CONFLICT'
  | 'ROOM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  ROOM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  STALE_REVISION: 409,
  CONFLICT: 409,
  ROOM_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * An error that is safe to serialize to a client. Messages are written for an
 * operator and must never carry a credential, a file path, or hidden truth.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): { error: { code: ErrorCode; message: string; details?: Record<string, string | number> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}
