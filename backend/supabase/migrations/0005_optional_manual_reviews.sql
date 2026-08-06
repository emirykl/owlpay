-- Allow free maintainer-led review while keeping paid Owl Agent packages optional.
alter table public.bounties
  drop constraint if exists bounties_review_plan_check,
  drop constraint if exists bounties_review_price_check,
  drop constraint if exists bounties_review_payment_status_check;

alter table public.bounties
  add constraint bounties_review_plan_check
    check (review_plan in ('NONE', 'STANDARD', 'SECURITY')),
  add constraint bounties_review_price_check
    check (review_price >= 0),
  add constraint bounties_review_payment_status_check
    check (review_payment_status in ('NOT_REQUIRED', 'REQUIRED', 'PAID', 'CONSUMED'));

-- Existing paid-plan bounties keep their current values. New manual bounties are
-- written with review_price = 0 and review_payment_status = 'NOT_REQUIRED'.
revoke insert, update, delete on public.bounties from anon, authenticated;
