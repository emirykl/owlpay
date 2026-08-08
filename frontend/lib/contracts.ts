import { parseAbi } from 'viem';

export const owlPayAbi = parseAbi([
  'function createBounty(uint128 rewardAmount, uint64 deadline, bytes32 taskHash) returns (uint256 bountyId)',
  'function assignDeveloper(uint256 bountyId, address developer)',
  'function submitWork(uint256 bountyId, bytes32 submissionHash)',
  'function refundExpiredBounty(uint256 bountyId)',
  'event BountyCreated(uint256 indexed bountyId, address indexed owner, address indexed paymentToken, uint256 rewardAmount, uint256 deadline, bytes32 taskHash)'
]);

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

function parseHexAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined;
  return value as `0x${string}`;
}

export const contractAddress = parseHexAddress(process.env.NEXT_PUBLIC_OWLPAY_CONTRACT_ADDRESS);
export const paymentTokenAddress = parseHexAddress(process.env.NEXT_PUBLIC_PAYMENT_TOKEN_ADDRESS);

export const contractsReady = Boolean(contractAddress && paymentTokenAddress);
