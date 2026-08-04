import { createPublicClient, defineChain, http } from 'viem';

export const goatTestnet = defineChain({
  id: 48816,
  name: 'GOAT Testnet3',
  nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_GOAT_RPC_URL ?? 'https://rpc.testnet3.goat.network'] }
  },
  blockExplorers: {
    default: {
      name: 'GOAT Explorer',
      url: process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? 'https://explorer.testnet3.goat.network'
    }
  },
  testnet: true
});

export const goatPublicClient = createPublicClient({
  chain: goatTestnet,
  transport: http(goatTestnet.rpcUrls.default.http[0])
});

