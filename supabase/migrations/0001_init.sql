-- PlanBound initial schema.
-- Mirrors packages/core/types.ts exactly; the two are the frozen contract.
-- No resource identifiers here — the project this runs against comes from env.

create type quote_source   as enum ('live-402', 'estimate');
create type rail           as enum ('hedera', 'worldchain', 'base');
create type plan_status    as enum ('pending_approval','approved','rejected','executing','blocked','settled','aborted','expired');
create type step_status    as enum ('pending','paid','blocked','skipped');
create type decision_outcome as enum ('approved','rejected','edited','drift_approved','drift_replan','drift_abort');
create type decision_target  as enum ('price','logic','scope','service');

-- An agent authenticates with a bearer token; only its sha256 is stored.
create table agents (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  ens            text,
  evm_address    text,
  hedera_account text,
  token_hash     text not null unique,
  created_at     timestamptz not null default now()
);

create table plans (
  id            text primary key,                       -- 'pl_<random>'
  agent_id      uuid not null references agents(id) on delete cascade,
  goal          text not null,
  approach      text not null,
  depth         text,                                   -- the depth level the human asked for
  total_usd     numeric(14,6) not null,                 -- Σ step quotes at approval time
  ceiling_usd   numeric(14,6) not null,
  tolerance_pct numeric(5,2) not null,
  status        plan_status not null default 'pending_approval',
  self_check    jsonb not null default '{}'::jsonb,     -- {turns, fixes[]}
  approval_key  text not null,                          -- unguessable ?k= for the approval link
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint ceiling_covers_total check (ceiling_usd >= total_usd)
);

create index plans_agent_idx on plans (agent_id, created_at desc);

create table steps (
  id           uuid primary key default gen_random_uuid(),
  plan_id      text not null references plans(id) on delete cascade,
  idx          int not null,
  service_url  text not null,
  service_name text not null,
  quote_usd    numeric(14,6) not null,
  source       quote_source not null,
  buys         text not null,
  why          text not null,
  rail         rail not null,
  status       step_status not null default 'pending',
  paid_usd     numeric(14,6),
  live_ask_usd numeric(14,6),                            -- what the seller actually asked
  receipt      jsonb,                                    -- {ask, paid, txRef, payer, at}
  unique (plan_id, idx)
);

-- Every human answer, typed. This table is the learning loop's only input.
create table decisions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    text not null references plans(id) on delete cascade,
  outcome    decision_outcome not null,
  target     decision_target,
  reason     text,
  step_idx   int,
  created_at timestamptz not null default now()
);

create index decisions_plan_idx on decisions (plan_id, created_at);

create table envelopes (
  plan_id            text primary key references plans(id) on delete cascade,
  hedera_account     text,                               -- the bounded account
  hedera_schedule_id text,                               -- keeperless refund at expiry
  hcs_topic          text,
  evm_address        text,                               -- plan wallet: same address on worldchain + base
  funded_usd         numeric(14,6) not null default 0,
  swept_usd          numeric(14,6),
  created_at         timestamptz not null default now()
);

-- Rules learned from real rejections. Nothing seeded — see the console copy.
create table insights (
  id          uuid primary key default gen_random_uuid(),
  text        text not null,
  decision_id uuid references decisions(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- All access is server-side through the service role; RLS on with no policies means
-- anon/authenticated clients can read nothing even if a key leaks.
alter table agents    enable row level security;
alter table plans     enable row level security;
alter table steps     enable row level security;
alter table decisions enable row level security;
alter table envelopes enable row level security;
alter table insights  enable row level security;
