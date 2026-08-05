import { decodeEventLog, parseAbiItem } from 'viem';
import { DomainError } from '../domain/errors.js';
import type { ReviewPaymentVerifier } from '../application/ports.js';
import { goatPublicClient } from './goat-client.js';

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export class GoatReviewPaymentVerifier implements ReviewPaymentVerifier {
  async verify(input: {
    txHash: `0x${string}`;
    payer: `0x${string}`;
    token: `0x${string}`;
    payTo: `0x${string}`;
    amount: bigint;
  }) {
    let receipt;
    let transaction;
    try {
      [receipt, transaction] = await Promise.all([
        goatPublicClient.getTransactionReceipt({ hash: input.txHash }),
        goatPublicClient.getTransaction({ hash: input.txHash })
      ]);
    } catch {
      throw new DomainError('Review payment transaction was not found on GOAT Testnet3', 400, 'PAYMENT_NOT_FOUND');
    }
    if (receipt.status !== 'success') throw new DomainError('Review payment transaction failed', 400, 'PAYMENT_FAILED');
    if (transaction.from.toLowerCase() !== input.payer.toLowerCase()) {
      throw new DomainError('Review payment must come from the bounty owner wallet', 403, 'PAYMENT_PAYER_MISMATCH');
    }

    const matchingTransfer = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== input.token.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: [transferEvent], data: log.data, topics: log.topics });
        return decoded.eventName === 'Transfer'
          && decoded.args.from.toLowerCase() === input.payer.toLowerCase()
          && decoded.args.to.toLowerCase() === input.payTo.toLowerCase()
          && decoded.args.value === input.amount;
      } catch {
        return false;
      }
    });
    if (!matchingTransfer) throw new DomainError('Transaction does not contain the required review payment', 400, 'PAYMENT_MISMATCH');
  }
}
