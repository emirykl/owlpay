import { describe, expect, it } from 'vitest';
import { bountyTokenSymbol } from './bounty-token';

describe('bountyTokenSymbol', () => {
  it('keeps historical mock-token bounties distinct from the current USDC escrow', () => {
    expect(bountyTokenSymbol({ escrowContractAddress: '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24' }, 'USDC')).toBe('otUSDC');
    expect(bountyTokenSymbol({ escrowContractAddress: '0x7c52415f89e3f6870a2188dc0a087463a16e17fe' }, 'USDC')).toBe('USDC');
  });
});
