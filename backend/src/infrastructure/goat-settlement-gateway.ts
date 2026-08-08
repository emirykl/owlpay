import { createWalletClient, getAddress, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { SettlementGateway } from '../application/ports.js';
import { env } from '../config/env.js';
import { goatPublicClient, goatTestnet } from './goat-client.js';

const settlementAbi = parseAbi([
  'function approveSubmission(uint256 bountyId, bytes32 verificationHash)',
  'function releasePayment(uint256 bountyId)',
  'function requestRevision(uint256 bountyId, bytes32 verificationHash)',
  'function resolveReviewTimeout(uint256 bountyId, bytes32 verificationHash, bool approve)'
]);

export class GoatSettlementGateway implements SettlementGateway {
  readonly writesEnabled = env.ENABLE_TESTNET_WRITES;

  async approveAndRelease(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string) {
    if (!this.writesEnabled) return null;
    const client = settlementWallet();
    const bountyId = BigInt(onchainId);
    const approvalHash = await client.writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'approveSubmission', args: [bountyId, verificationHash]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash: approvalHash });
    const payoutHash = await client.writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'releasePayment', args: [bountyId]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash: payoutHash });
    return payoutHash;
  }

  async requestRevision(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string) {
    if (!this.writesEnabled) return null;
    const hash = await settlementWallet().writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'requestRevision', args: [BigInt(onchainId), verificationHash]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async approveAfterTimeout(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string) {
    if (!this.writesEnabled) return null;
    const client = settlementWallet();
    const bountyId = BigInt(onchainId);
    const approvalHash = await client.writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'resolveReviewTimeout', args: [bountyId, verificationHash, true]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash: approvalHash });
    const payoutHash = await client.writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'releasePayment', args: [bountyId]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash: payoutHash });
    return payoutHash;
  }

  async refundAfterTimeout(onchainId: string, verificationHash: `0x${string}`, escrowContractAddress?: string) {
    if (!this.writesEnabled) return null;
    const hash = await settlementWallet().writeContract({
      address: contractAddress(escrowContractAddress), abi: settlementAbi, functionName: 'resolveReviewTimeout', args: [BigInt(onchainId), verificationHash, false]
    });
    await goatPublicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}

function settlementWallet() {
  const account = privateKeyToAccount(env.SETTLEMENT_PRIVATE_KEY as `0x${string}`);
  return createWalletClient({ account, chain: goatTestnet, transport: http(env.GOAT_RPC_URL) });
}

function contractAddress(value?: string) {
  const address = value || env.OWL_PAY_CONTRACT_ADDRESS;
  if (!isAddress(address)) throw new Error('A valid escrow contract address is required for settlement');
  return getAddress(address);
}
