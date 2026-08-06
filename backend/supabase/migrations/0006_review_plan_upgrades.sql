-- Track cumulative review payments so maintainers can upgrade Silver to Gold
-- by paying only the difference, while preserving every transaction hash.
alter table public.bounties
  add column if not exists review_paid_amount numeric(38, 6) not null default 0
    check (review_paid_amount >= 0),
  add column if not exists review_payment_tx_hashes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(review_payment_tx_hashes) = 'array');

update public.bounties
set
  review_paid_amount = case
    when review_payment_status in ('PAID', 'CONSUMED') and review_plan = 'STANDARD' then 1
    when review_payment_status in ('PAID', 'CONSUMED') and review_plan = 'SECURITY' then 2
    else 0
  end,
  review_payment_tx_hashes = case
    when review_payment_tx_hash is not null then jsonb_build_array(review_payment_tx_hash)
    else '[]'::jsonb
  end
where review_paid_amount = 0
  and review_payment_tx_hashes = '[]'::jsonb;

revoke insert, update, delete on public.bounties from anon, authenticated;
