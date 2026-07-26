-- Human accounts. Until now the only identities in this system were the agent (a bearer
-- token) and "whoever holds the approval link" (a capability URL). Both are still true and
-- deliberate. What was missing is an owner: a person who can see their own plans, issue an
-- agent token, and revoke it.
--
-- The ownership chain is single-parent all the way down:
--   auth.users → agents.owner_id → plans.agent_id → steps / envelopes / decisions
-- so every policy below is the same question asked at a different depth.

alter table agents add column owner_id uuid references auth.users(id) on delete cascade;

create index agents_owner_idx on agents (owner_id, created_at desc);

-- Deliberately nullable. Agents seeded before accounts existed have no owner and are
-- therefore invisible to every signed-in user — which is the safe direction to fail. They
-- are claimed by an explicit update, not by a guess about who deserves them.

-- ---------------------------------------------------------------------------------------
-- Reads for signed-in humans.
--
-- 0002 gave anon and authenticated nothing at all, on the reasoning that an absent grant is
-- a second lock independent of RLS. That reasoning still holds for `anon`, which continues
-- to get nothing. `authenticated` now needs to read its own rows, so it gets SELECT and
-- only SELECT — every write in this system goes through the service-role client behind a
-- bearer token or the approval capability, and none of them should become reachable from a
-- browser session.
-- ---------------------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select on agents, plans, steps, envelopes, decisions to authenticated;

-- `token_hash` is in this table. It is a sha256 of a high-entropy token so it is not
-- directly reversible, but a hash the owner never needs to read has no business crossing
-- the wire, and column privileges are not what these policies enforce. Revoke it.
revoke select (token_hash) on agents from authenticated;

create policy agents_owner_read on agents
  for select to authenticated
  using (owner_id = auth.uid());

create policy plans_owner_read on plans
  for select to authenticated
  using (exists (
    select 1 from agents a
    where a.id = plans.agent_id and a.owner_id = auth.uid()
  ));

create policy steps_owner_read on steps
  for select to authenticated
  using (exists (
    select 1 from plans p join agents a on a.id = p.agent_id
    where p.id = steps.plan_id and a.owner_id = auth.uid()
  ));

create policy envelopes_owner_read on envelopes
  for select to authenticated
  using (exists (
    select 1 from plans p join agents a on a.id = p.agent_id
    where p.id = envelopes.plan_id and a.owner_id = auth.uid()
  ));

create policy decisions_owner_read on decisions
  for select to authenticated
  using (exists (
    select 1 from plans p join agents a on a.id = p.agent_id
    where p.id = decisions.plan_id and a.owner_id = auth.uid()
  ));

-- No policy is added for `insights`: it is aggregate learning data with no owner column,
-- and the console reads it through the service-role client. Leaving it policy-less keeps
-- it unreadable from a browser session, which is the current intent.
