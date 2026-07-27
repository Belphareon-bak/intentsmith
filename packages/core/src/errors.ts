import { ContractValidationError, type NormalizedError } from '@intentsmith/contracts';

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }

  toNormalizedError(): NormalizedError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof DomainError) return error.toNormalizedError();
  if (error instanceof ContractValidationError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }
  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: 'Internal error',
      retryable: false,
    };
  }
  return {
    code: 'UNKNOWN_ERROR',
    message: 'Unknown error',
    retryable: false,
  };
}
