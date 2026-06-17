export class ExtensionPackageError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ExtensionPackageError';
    this.statusCode = statusCode;
  }
}
