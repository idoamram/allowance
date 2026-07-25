-- The envelope's key structure needs the agent's Hedera public key at mint time:
-- 1-of-[ 2-of-2(agent, policy), treasury ]. The agent's PRIVATE key never leaves the
-- developer's machine — only this public half is registered.
--
-- Additive column; nothing in the frozen contract changes shape.

alter table agents add column if not exists hedera_public_key text;
