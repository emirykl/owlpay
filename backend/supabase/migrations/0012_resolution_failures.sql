-- Durable record of bounties a scheduled resolution run could not settle.
--
-- The run itself answers 200 even when individual bounties fail, because the
-- work that did commit is real and a 5xx would only make the scheduler repeat
-- it. That left the failures visible solely in a log line nobody reads, so a
-- bounty could sit unsettled indefinitely with no trace. This table is that
-- trace: a maintainer can ask "what did not settle" without log retention.

create table if not exists public.resolution_failures (
  id uuid primary key default gen_random_uuid(),
  bounty_id uuid not null,
  reason text not null,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- The only question this table is asked: what failed recently, newest first.
create index if not exists resolution_failures_run_at_idx
  on public.resolution_failures (run_at desc);

create index if not exists resolution_failures_bounty_id_idx
  on public.resolution_failures (bounty_id);

-- Operational data with no reader in the browser. No policies are defined, so
-- with row level security on, only the backend's service key reaches it.
alter table public.resolution_failures enable row level security;
