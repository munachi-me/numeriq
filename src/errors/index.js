export class NumeriqError extends Error {
  constructor(message, code = 'NUMERIQ_ERROR') { super(message); this.name = 'NumeriqError'; this.code = code; }
}
export class ValidationError extends NumeriqError {
  constructor(message) { super(message, 'VALIDATION_ERROR'); this.name = 'ValidationError'; }
}
