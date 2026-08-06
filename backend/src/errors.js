export class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'O serviço de dados não está configurado.') {
    super(message, { statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
    this.name = 'ServiceUnavailableError';
  }
}
