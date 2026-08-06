const rejectionPattern = /action_rejected|code["'=:\s]+4001|ethers-user-denied|user (?:rejected|denied)|denied transaction signature/i;
const providerDetailPattern = /eth_sendtransaction|jsonrpc|payload|transaction signature|version=\d/i;

export function getTransactionErrorMessage(error: unknown, fallback: string): string | null {
  if (error === null || error === undefined) return null;
  const candidate = error as { code?: unknown; message?: unknown; shortMessage?: unknown } | null;
  const message = [candidate?.shortMessage, candidate?.message]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');

  if (candidate?.code === 4001 || candidate?.code === 'ACTION_REJECTED' || rejectionPattern.test(message)) return null;
  if (!message || message.length > 240 || providerDetailPattern.test(message)) return fallback;
  return message;
}
