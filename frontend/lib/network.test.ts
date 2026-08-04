import { describe, expect, it } from 'vitest';
import { goatTestnet } from './network';

describe('GOAT Testnet3 configuration', () => {
  it('uses the guarded testnet chain', () => {
    expect(goatTestnet.id).toBe(48816);
    expect(goatTestnet.testnet).toBe(true);
    expect(goatTestnet.rpcUrls.default.http[0]).toContain('testnet3.goat.network');
  });
});

