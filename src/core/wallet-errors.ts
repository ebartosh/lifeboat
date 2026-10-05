/** Numeric MWA code from the normalized SDK error or native RN rejection. */
export function walletProtocolErrorCode(error: unknown): number | undefined {
  let current = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const details = current as { code?: unknown; userInfo?: { jsonRpcErrorCode?: unknown }; cause?: unknown };
    const code = typeof details.code === 'number' ? details.code
      : details.code === 'JSON_RPC_ERROR' ? details.userInfo?.jsonRpcErrorCode : undefined;
    if (typeof code === 'number' && Number.isSafeInteger(code)) return code;
    current = details.cause;
  }
  return undefined;
}
