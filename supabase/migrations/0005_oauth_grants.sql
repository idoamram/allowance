-- Remote MCP over OAuth: the two records the resource server needs and Supabase does not give us.
--
-- 1. `oauth_grants` — the audience binding.
--
--    The MCP authorization spec requires a resource server to reject any token that was not
--    issued for it (RFC 8707). Supabase's OAuth server issues JWTs whose `aud` is the
--    Postgres role (`authenticated`), not the resource; nothing in the token names the MCP
--    server. Rather than skip the check — which is the confused-deputy hole, not a shortcut —
--    we hold the binding ourselves: the human's approval on /oauth/consent writes exactly
--    which OAuth client, for which resource URI, on whose behalf. A token whose (client_id,
--    sub) has no live grant for this server's canonical URI is refused, and revoking is a
--    single UPDATE rather than a wait for expiry.
--
--    `agent_id` is the answer to "which agent does this token act as" when the human owns
--    more than one. It is chosen by the human on the consent screen, so the server never
--    guesses.
--
-- 2. `agent_delegations` — the downstream credential.
--
--    The spec forbids passing the client's token through to anything downstream. When the
--    remote MCP server calls our own control-plane API it must authenticate as itself, so it
--    exchanges the verified OAuth token for a short-lived credential of its own, scoped to
--    one agent and one grant. Only the sha256 is stored, matching how `agents.token_hash`
--    already works: a leaked database read yields no usable credential.

create table oauth_grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  text not null,
  -- The canonical URI of the MCP server this grant is for. Stored, not derived, so a
  -- deployment that moves origin does not silently widen an old consent.
  resource   text not null,
  scope      text not null default '',
  agent_id   uuid references agents(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- One live grant per (human, client, resource). Re-consenting updates it rather than
-- accumulating rows nobody can reason about.
create unique index oauth_grants_live_idx
  on oauth_grants (user_id, client_id, resource)
  where revoked_at is null;

create table agent_delegations (
  token_hash text primary key,
  agent_id   uuid not null references agents(id) on delete cascade,
  grant_id   uuid not null references oauth_grants(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index agent_delegations_expiry_idx on agent_delegations (expires_at);

alter table oauth_grants      enable row level security;
alter table agent_delegations enable row level security;

-- A human may read their own consents — that is what makes revocation reviewable. Writes
-- stay with the service-role client, which is the only thing that authenticates the OAuth
-- token in the first place. `agent_delegations` gets no grant at all: it holds credential
-- hashes and no browser session has any business reading it.
grant select on oauth_grants to authenticated;

create policy oauth_grants_owner_read on oauth_grants
  for select to authenticated
  using (user_id = auth.uid());
