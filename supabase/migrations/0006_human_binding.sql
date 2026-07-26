-- Binding an account to a specific human, without learning who they are.
--
-- Proof-of-human answers "is something alive on the other end", which is the right question
-- for exactly one threat: `submit_plan` hands the agent the approval URL, so an agent could
-- open its own approval and fund itself. A liveness check is the thing a machine cannot pass.
--
-- It answers nothing about *which* human, and that is the gap this table closes. World
-- returns a `nullifier` — stable per (app, action, World ID), and pseudonymous. Recording it
-- once turns every later approval into "the same person as the one who enrolled" rather than
-- "somebody alive". A leaked approval link stops being enough.
--
-- What this is not: identity. There is no name here, no document, no legal person. It is
-- continuity, and calling it more than that would be the kind of claim this repo does not
-- make.

create type verification_policy as enum (
  -- The capability URL alone approves. The shipping default, and correct for small ceilings
  -- where an interruption costs more than it protects.
  'off',
  -- Required above STEP_UP_USD. Today's behaviour.
  'threshold',
  -- Every approval needs the bound human, whatever it costs.
  'always'
);

create table human_bindings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- Null until the human enrols. The policy can be set before a binding exists; approvals
  -- then refuse rather than silently falling open, because "required but not enrolled" is a
  -- misconfiguration and not permission.
  nullifier  text,
  -- Which preset produced it. The nullifier is scoped to (app, action) and not to the
  -- preset, so this is evidence rather than a key — it records what the human actually
  -- proved, since deviceLegacy and selfieCheckLegacy are very different claims.
  preset     text,
  policy     verification_policy not null default 'threshold',
  bound_at   timestamptz,
  created_at timestamptz not null default now()
);

-- Deliberately not unique. Two accounts binding the same human is a legitimate thing a
-- person may do, and a unique index would turn it into a lockout that looks like a bug.
create index human_bindings_nullifier_idx on human_bindings (nullifier);

alter table human_bindings enable row level security;

grant select on human_bindings to authenticated;

-- A human may read their own binding — that is what makes it reviewable, and what lets the
-- console show "enrolled" without trusting the client. Writes stay with the service-role
-- client: enrolling means verifying a proof, and only the server can do that.
create policy human_bindings_owner_read on human_bindings
  for select to authenticated
  using (user_id = auth.uid());
