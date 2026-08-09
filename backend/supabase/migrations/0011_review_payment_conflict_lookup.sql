-- Keep replay checks index-backed as the bounty table grows. Existing hashes
-- are normalized once so jsonb containment uses the same canonical form as
-- new API writes.
update public.bounties
set review_payment_tx_hashes = coalesce((
  select jsonb_agg(lower(value))
  from jsonb_array_elements_text(review_payment_tx_hashes) as hashes(value)
), '[]'::jsonb)
where review_payment_tx_hashes <> '[]'::jsonb;

create index if not exists bounties_review_payment_tx_hashes_gin
  on public.bounties using gin (review_payment_tx_hashes jsonb_path_ops);

create index if not exists bounties_review_payment_order_ids_gin
  on public.bounties using gin (review_payment_order_ids jsonb_path_ops);

create or replace function public.find_review_payment_conflict(
  p_tx_hash text,
  p_order_id text,
  p_exclude_bounty_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.bounties
    where lower(review_payment_tx_hash) = lower(p_tx_hash)
      or review_payment_tx_hashes @> jsonb_build_array(lower(p_tx_hash))
      or (
        id <> p_exclude_bounty_id
        and review_payment_order_ids @> jsonb_build_array(p_order_id)
      )
  );
$$;

revoke all on function public.find_review_payment_conflict(text, text, uuid) from public, anon, authenticated;
grant execute on function public.find_review_payment_conflict(text, text, uuid) to service_role;
