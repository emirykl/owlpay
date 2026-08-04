import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem/utils';
import { env } from '../config/env.js';

export const goatTestnet = defineChain({
  id: 48816,
  name: 'GOAT Testnet3',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: { default: { http: [env.GOAT_RPC_URL] } },
  blockExplorers: { default: { name: 'GOAT Explorer', url: env.GOAT_EXPLORER_URL } },
  testnet: true
});

export const goatPublicClient = createPublicClient({ chain: goatTestnet, transport: http(env.GOAT_RPC_URL) });

export async function getNetworkStatus() {
  try {
    const blockNumber = await goatPublicClient.getBlockNumber();
    return { connected: true, blockNumber: blockNumber.toString() };
  } catch {
    return { connected: false, blockNumber: null };
  }
}

