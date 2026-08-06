-- Persist the official GOAT Flow merchant order lifecycle for Owl Agent reviews.
alter table public.bounties
  add column if not exists review_payment_intent_id text,
  add column if not exists review_payment_order_id text,
  add column if not exists review_payment_order_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(review_payment_order_ids) = 'array'),
  add column if not exists review_payment_target_plan text
    check (review_payment_target_plan is null or review_payment_target_plan in ('STANDARD', 'SECURITY')),
  add column if not exists review_payment_payer_address text
    check (review_payment_payer_address is null or review_payment_payer_address ~ '^0x[0-9a-f]{40}$'),
  add column if not exists review_payment_order_status text
    check (review_payment_order_status is null or review_payment_order_status in (
      'CHECKOUT_VERIFIED', 'PAYMENT_CONFIRMED', 'INVOICED', 'FAILED', 'EXPIRED', 'CANCELLED'
    )),
  add column if not exists review_payment_order jsonb,
  add column if not exists review_payment_proof jsonb,
  add column if not exists review_payment_pending_tx_hash text
    check (review_payment_pending_tx_hash is null or review_payment_pending_tx_hash ~ '^0x[0-9a-fA-F]{64}$');

create unique index if not exists bounties_review_payment_order_unique
  on public.bounties(review_payment_order_id)
  where review_payment_order_id is not null;

create unique index if not exists bounties_review_payment_pending_tx_unique
  on public.bounties(lower(review_payment_pending_tx_hash))
  where review_payment_pending_tx_hash is not null;

revoke insert, update, delete on public.bounties from anon, authenticated;
