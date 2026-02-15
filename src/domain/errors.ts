export class DomainError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message, 409);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super('FORBIDDEN', message, 403);
  }
}
