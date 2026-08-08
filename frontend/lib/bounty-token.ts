import type { Bounty } from './api';

const LEGACY_OTUSDC_ESCROWS = new Set([
  '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24',
  '0x1c45b6064d938545e4f22ae41cba42c7884c575f'
]);

export function bountyTokenSymbol(bounty: Pick<Bounty, 'escrowContractAddress'>, currentSymbol = 'USDC') {
  return bounty.escrowContractAddress && LEGACY_OTUSDC_ESCROWS.has(bounty.escrowContractAddress.toLowerCase())
    ? 'otUSDC'
    : currentSymbol;
}
