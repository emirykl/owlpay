-- Multi-applicant bounty workflow: apply, assign, submit, review, pay.
alter type public.bounty_status add value if not exists 'ASSIGNED' after 'OPEN';
alter type public.bounty_status add value if not exists 'READY_FOR_REVIEW' after 'VERIFYING';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status' and typnamespace = 'public'::regnamespace) then
    create type public.application_status as enum ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
  end if;
end
$$;

alter table public.bounties
  add column if not exists assigned_developer_user_id uuid references public.profiles(id) on delete restrict,
  add column if not exists assigned_developer_github_login text,
  add column if not exists assigned_developer_address text
    check (assigned_developer_address is null or assigned_developer_address ~ '^0x[0-9a-f]{40}$'),
  add column if not exists assigned_at timestamptz,
  add column if not exists assignment_tx_hash text
    check (assignment_tx_hash is null or assignment_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  add column if not exists payout_tx_hash text
    check (payout_tx_hash is null or payout_tx_hash ~ '^0x[0-9a-fA-F]{64}$');

create table if not exists public.bounty_applications (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null references public.bounties(id) on delete cascade,
  developer_user_id uuid not null references public.profiles(id) on delete cascade,
  developer_github_login text not null,
  developer_github_avatar_url text,
  developer_address text not null check (developer_address ~ '^0x[0-9a-f]{40}$'),
  message varchar(600) not null check (char_length(message) between 20 and 600),
  status public.application_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bounty_id, developer_user_id)
);

create index if not exists bounty_applications_bounty_idx
  on public.bounty_applications(bounty_id, created_at desc);

create index if not exists bounty_applications_developer_idx
  on public.bounty_applications(developer_user_id, created_at desc);

alter table public.bounty_applications enable row level security;

-- Application messages and wallet addresses stay private behind the Fastify API.
revoke all on public.bounty_applications from anon, authenticated;
