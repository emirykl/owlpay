import { describe, expect, it } from 'vitest';
import { getTransactionErrorMessage } from './transaction-error';

describe('getTransactionErrorMessage', () => {
  it('returns no message when there is no error', () => {
    expect(getTransactionErrorMessage(null, 'Payment failed.')).toBeNull();
  });

  it('silences rejected wallet requests', () => {
    expect(getTransactionErrorMessage({ code: 'ACTION_REJECTED', message: 'User denied transaction signature.' }, 'Payment failed.')).toBeNull();
    expect(getTransactionErrorMessage(new Error('ethers-user-denied: MetaMask Tx Signature: User denied transaction signature. code=ACTION_REJECTED'), 'Payment failed.')).toBeNull();
  });

  it('hides verbose provider internals behind a safe fallback', () => {
    expect(getTransactionErrorMessage(new Error('JSONRPC payload eth_sendTransaction failed'), 'Payment failed.')).toBe('Payment failed.');
  });

  it('keeps short actionable application errors', () => {
    expect(getTransactionErrorMessage(new Error('Connect the wallet that created this bounty.'), 'Payment failed.')).toBe('Connect the wallet that created this bounty.');
  });
});
