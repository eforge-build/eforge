export class HttpRouteError extends Error {
  readonly status: number;
  readonly bodyKind?: 'json' | 'text';

  constructor(status: number, message: string, bodyKind?: 'json' | 'text') {
    super(message);
    this.name = 'HttpRouteError';
    this.status = status;
    this.bodyKind = bodyKind;
  }
}

export class MalformedRouteParameterError extends HttpRouteError {
  constructor(message = 'Malformed route parameter') {
    super(400, message, 'json');
    this.name = 'MalformedRouteParameterError';
  }
}

export function isHttpRouteError(value: unknown): value is HttpRouteError {
  return value instanceof HttpRouteError;
}
