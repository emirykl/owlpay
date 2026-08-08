export class DomainError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'DOMAIN_ERROR'
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

