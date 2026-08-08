-- Keep each bounty bound to the escrow contract that actually received its funds.
-- This allows OwlPay to upgrade the default escrow without orphaning older bounties
-- or confusing identical numeric bounty IDs emitted by different deployments.
alter table public.bounties
  add column if not exists escrow_contract_address text
    check (escrow_contract_address is null or escrow_contract_address ~ '^0x[0-9a-f]{40}$');

-- First otUSDC deployment (bounties 1-3).
update public.bounties
set escrow_contract_address = '0x9682ba996dd174ad87573a9cc0fb6bf228f72f24'
where lower(funding_tx_hash) in (
  '0x474d4b554f3bed32159d078d2ba3f0a49811348acd5d4118332476cc992b2561',
  '0xee91a885df7ff23525d7d540f29cb3b4249a9094df4c57c2c3bb3c0ba37c1d37',
  '0xd4d00f0d630b20f5ac44fc50601f0f714a2fec276e7e46ec4d75f5195614cf19'
);

-- Second otUSDC deployment (its bounty IDs restarted at 1).
update public.bounties
set escrow_contract_address = '0x1c45b6064d938545e4f22ae41cba42c7884c575f'
where lower(funding_tx_hash) = '0xf806d6483d34fce8cf63ab81d4760d2cdd7676c14b30ede37d5c12d36b8289fe';

-- Any bounty funded after the USDC rollout but before this migration was applied
-- belongs to the current USDC escrow deployment.
update public.bounties
set escrow_contract_address = '0x7c52415f89e3f6870a2188dc0a087463a16e17fe'
where funding_tx_hash is not null and escrow_contract_address is null;

create index if not exists bounties_escrow_contract_onchain_idx
  on public.bounties(escrow_contract_address, onchain_id)
  where escrow_contract_address is not null and onchain_id is not null;

revoke insert, update, delete on public.bounties from anon, authenticated;
