-- Separate one-time Owl Agent review purchases from the bounty reward escrow.
-- The legacy verification_budget column remains at zero for migration compatibility.
alter table public.bounties
  alter column verification_budget set default 0,
  add column if not exists review_plan text not null default 'STANDARD'
    check (review_plan in ('STANDARD', 'SECURITY')),
  add column if not exists review_price numeric(38, 6) not null default 2
    check (review_price > 0),
  add column if not exists review_payment_status text not null default 'REQUIRED'
    check (review_payment_status in ('REQUIRED', 'PAID', 'CONSUMED')),
  add column if not exists review_payment_tx_hash text
    check (review_payment_tx_hash is null or review_payment_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  add column if not exists review_paid_at timestamptz,
  add column if not exists review_consumed_at timestamptz;

create unique index if not exists bounties_review_payment_tx_unique
  on public.bounties(lower(review_payment_tx_hash))
  where review_payment_tx_hash is not null;

revoke insert, update, delete on public.bounties from anon, authenticated;
