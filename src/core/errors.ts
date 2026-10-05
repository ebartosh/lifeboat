export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError";
}

export class VerificationError extends Error {
  override readonly name = "VerificationError";
}

export class SimulationError extends Error {
  override readonly name = "SimulationError";
}

export class TransactionError extends Error {
  override readonly name = "TransactionError";
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/[^\s)\]}]+/gu, "[redacted endpoint]");
}
