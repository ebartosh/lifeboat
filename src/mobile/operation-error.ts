import { NotSentError, UnsentTransactionExpiredError } from '../core/transaction';

/** Only known pre-submission expiry may invite a fresh attempt. */
export function unsentExpiryHint(error: unknown, withdrawal = false): string | undefined {
  const expiry = error instanceof NotSentError ? error.cause : error;
  if (!(expiry instanceof UnsentTransactionExpiredError)) return undefined;
  const recovery = withdrawal
    ? 'This step expired before sending. Confirmed steps are kept. Resume the withdrawal'
    : 'Transaction expired. Nothing was sent. Prepare it again';
  return `${recovery}, then complete wallet approval and the fee review without long pauses. Check the details before approving.`;
}
