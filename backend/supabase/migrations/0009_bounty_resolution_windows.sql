-- Fixed contributor/reviewer windows and Owl AI timeout resolution state.
alter table public.bounties
  add column if not exists contributor_deadline timestamptz,
  add column if not exists maintainer_review_deadline timestamptz,
  add column if not exists revision_extension_used boolean not null default false,
  add column if not exists timeout_resolution text not null default 'NONE'
    check (timeout_resolution in (
      'NONE', 'AUTO_APPROVED', 'AUTO_FAILED_PENDING', 'INCONCLUSIVE', 'DISPUTED', 'AUTO_REFUNDED'
    )),
  add column if not exists timeout_resolved_at timestamptz,
  add column if not exists appeal_deadline timestamptz,
  add column if not exists refund_tx_hash text
    check (refund_tx_hash is null or refund_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  add column if not exists appeal_message text
    check (appeal_message is null or char_length(appeal_message) between 20 and 2000);

update public.bounties
set
  contributor_deadline = coalesce(contributor_deadline, deadline),
  maintainer_review_deadline = coalesce(maintainer_review_deadline, deadline + interval '7 days')
where contributor_deadline is null or maintainer_review_deadline is null;

alter table public.bounties
  alter column contributor_deadline set not null,
  alter column maintainer_review_deadline set not null;

create index if not exists bounties_maintainer_review_deadline_idx
  on public.bounties(maintainer_review_deadline)
  where status in ('SUBMITTED', 'READY_FOR_REVIEW', 'HUMAN_REVIEW');

revoke insert, update, delete on public.bounties from anon, authenticated;
