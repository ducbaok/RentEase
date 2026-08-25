-- RentEase · shared test scaffolding
--
-- Not a test file (no .test.sql suffix, so pg_prove ignores it). Each test
-- file inlines this same preamble; it is kept here as the readable reference
-- for WHY the tests are shaped the way they are.
--
-- WHY THE RESULTS TABLE
-- pgTAP keeps its plan and counter in objects owned by the session role. If an
-- assertion ran while impersonating `authenticated`, pgTAP would fail on its
-- own bookkeeping rather than on the thing under test. So each test does:
--
--   1. become the user under test, run the query, park the answer in tres
--   2. reset role
--   3. assert on the parked answer as postgres
--
-- WHY attempt()
-- Two different failures both count as "blocked", and they are not the same
-- thing, so the tests must tell them apart:
--   * a rejected write raises  → attempt() returns the SQLSTATE
--     ('42501' = RLS or privilege, '23505' = unique, '23P01' = exclusion)
--   * a hidden row does not raise → the UPDATE simply matches zero rows
-- Asserting the exact code stops a test from passing for the wrong reason —
-- e.g. a NOT NULL violation masquerading as an access-control success.

create table public.tres (k text primary key, v text);
grant all on public.tres to authenticated;

create or replace function public.attempt(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Usage:
--   reset role;
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   set local role authenticated;
