-- Keep maintainer revision feedback bound to the reviewed commit.
alter table public.bounties
  add column if not exists revision_requests jsonb not null default '[]'::jsonb
    check (jsonb_typeof(revision_requests) = 'array');

revoke insert, update, delete on public.bounties from anon, authenticated;
