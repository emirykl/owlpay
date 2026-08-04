-- OwlPay MVP schema. Run through the Supabase SQL editor or CLI.
create extension if not exists pgcrypto;

create type public.bounty_status as enum (
  'DRAFT', 'OPEN', 'SUBMITTED', 'VERIFYING', 'REVISION_REQUIRED',
  'HUMAN_REVIEW', 'APPROVED', 'PAID', 'EXPIRED', 'REFUNDED', 'CANCELLED'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_login text unique,
  github_avatar_url text,
  wallet_address text unique check (wallet_address is null or wallet_address ~ '^0x[0-9a-f]{40}$'),
  wallet_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bounties (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete restrict,
  owner_address text not null check (owner_address ~ '^0x[0-9a-f]{40}$'),
  title varchar(120) not null,
  description text not null,
  repository_url text not null,
  reward_amount numeric(38, 6) not null check (reward_amount > 0),
  verification_budget numeric(38, 6) not null check (verification_budget >= 0),
  deadline timestamptz not null,
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array'),
  status public.bounty_status not null default 'DRAFT',
  onchain_id text,
  funding_tx_hash text check (funding_tx_hash is null or funding_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  submission jsonb,
  decision jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  message text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallet_challenges_user_idx on public.wallet_challenges(user_id, created_at desc);

create index bounties_status_created_idx on public.bounties(status, created_at desc);
create index bounties_owner_idx on public.bounties(owner_user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.bounties enable row level security;
alter table public.wallet_challenges enable row level security;

-- Public marketplace data is readable, except unpublished drafts.
create policy "Published bounties are public"
on public.bounties for select
to anon, authenticated
using (status <> 'DRAFT' or owner_user_id = (select auth.uid()));

create policy "Users can read their own profile"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

-- Business mutations go through the Fastify API and its secret-key client.
revoke insert, update, delete on public.bounties from anon, authenticated;
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke all on public.wallet_challenges from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, github_login, github_avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    github_login = excluded.github_login,
    github_avatar_url = excluded.github_avatar_url,
    updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created
after insert or update of raw_user_meta_data on auth.users
for each row execute procedure public.handle_new_user();
