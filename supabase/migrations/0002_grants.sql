-- Tables created through the migration API land owned by `postgres` with no DML
-- granted to `service_role`, so the server-side client gets "permission denied for
-- table agents" despite holding the service key. Grant DML to service_role only.
--
-- anon/authenticated deliberately get nothing: RLS is enabled with no policies, and
-- the absent grant is a second, independent lock. A leaked publishable key reads
-- nothing even if a policy is ever added by accident.

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage on schema public to service_role;

-- Same treatment for anything added later by a future migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
