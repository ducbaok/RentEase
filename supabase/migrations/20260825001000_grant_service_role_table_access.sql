-- ===========================================================================
-- service_role table access — the backend identity behind cron and webhooks.
--
-- Batch 0 granted DML to `authenticated` (fenced in by RLS) but never to
-- `service_role`. Its only legitimate callers — the daily reminder job and the
-- Stripe webhook — had not been built yet, so the gap stayed invisible until
-- stream 2B created app/api/cron and the service-role client hit its first
-- table. service_role already carries rolbypassrls, but BYPASSRLS only skips
-- ROW policies; a table-level GRANT is still required, and without one every
-- service-role query failed with "permission denied for table ...".
--
-- This is the posture the data model always assumed: reminder_logs is "written
-- exclusively by the reminder job's service role" and subscriptions "by the
-- Stripe webhook's service role" (see 0700). Those sentences describe grants
-- that were simply missing. RLS is not the barrier for service_role — it
-- bypasses it by design — so full DML is correct; the barrier for service_role
-- is that only two files may import the client (an eslint rule), plus this
-- endpoint's shared-secret gate.
--
-- Spelled out explicitly for service_role, the same way 0700 spells grants out
-- for authenticated, rather than leaning on Supabase's blanket default
-- privileges — matching the convention in 20-architecture.md.
-- ===========================================================================

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
