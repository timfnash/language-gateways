import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

// Runs the migration and seed on an in-process Postgres (PGlite) with a stand-in for
// Supabase's auth schema, then checks the invitation rules and row-level security.
// Usage: cd supabase/tests && npm install && npm test

const repo = new URL('..', import.meta.url).pathname;
const db = new PGlite();

// Minimal stand-in for Supabase's auth schema and roles.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
await db.exec(readFileSync(`${repo}/migrations/20260930000000_foundations.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/seed.sql`, 'utf8'));
await db.exec(`
  insert into public.churches values ('other-church', 'Other Church');
  insert into public.cohorts (id, church, name) values ('other-2026', 'other-church', 'Other 2026');
  insert into public.invitations (email, church, cohort, given_name, mother_tongue, other_languages)
    values ('  Alice@Example.COM ', 'freedom-church-jersey', 'freedom-church-jersey-2026-09', 'Alice', 'Portuguese', 'English, French'),
           ('bob@example.com', 'other-church', 'other-2026', null, 'Swahili', null);
`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const expectError = async (name, sql, match) => {
  try { await db.exec(sql); check(name, false, 'no error'); }
  catch (e) { check(name, !match || e.message.includes(match), e.message); }
};
const as = async (uid, sql) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role;`); }
};
const asErr = async (name, uid, sql, match) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { await db.query(sql); check(name, false, 'no error'); }
  catch (e) { check(name, !match || e.message.includes(match), e.message); }
  finally { await db.exec(`reset role;`); }
};

// Invitation CSV normalisation
const inv = await db.query(`select email from public.invitations where given_name = 'Alice'`);
check('invitation email normalised', inv.rows[0].email === 'alice@example.com');

// Hook
const hook = async email => (await db.query(`select public.hook_before_user_created($1) r`,
  [JSON.stringify({ user: { email } })])).rows[0].r;
check('hook allows invited (any case)', JSON.stringify(await hook('ALICE@example.com')) === '{}');
const denied = await hook('eve@example.com');
check('hook rejects uninvited', denied.error?.http_code === 403, denied.error?.message);
check('hook rejects missing email', (await hook(null)).error?.http_code === 403);

// Trigger fallback + profile creation
await expectError('trigger blocks uninvited signup',
  `insert into auth.users (email) values ('eve@example.com')`, 'not on the invitation list');
const ids = {};
for (const [k, email, meta] of [
  ['tim', 'tim@zipf.me', {}],
  ['alice', 'alice@example.com', {}],
  ['bob', 'Bob@Example.com', { full_name: 'Bob van der Berg' }],
]) {
  ids[k] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify(meta)])).rows[0].id;
}
const p = (await db.query(`select * from public.profiles where id = $1`, [ids.alice])).rows[0];
check('profile pre-filled from invitation',
  p.church === 'freedom-church-jersey' && p.given_name === 'Alice' && p.mother_tongue === 'Portuguese'
  && p.other_languages === 'English, French' && p.confirmed_at === null);
const pb = (await db.query(`select * from public.profiles where id = $1`, [ids.bob])).rows[0];
check('names fall back to Google full_name', pb.given_name === 'Bob' && pb.family_name === 'van der Berg',
  `${pb.given_name} / ${pb.family_name}`);

// RLS: profiles
let r = await as(ids.alice, `select id from public.profiles`);
check('member sees only own profile', r.rows.length === 1 && r.rows[0].id === ids.alice);
r = await as(ids.tim, `select id from public.profiles`);
check('admin sees all profiles', r.rows.length === 3);
r = await as(ids.alice, `update public.profiles set given_name = 'Ali', confirmed_at = now() where id = '${ids.alice}' returning given_name`);
check('member updates own details', r.rows[0]?.given_name === 'Ali');
r = await as(ids.alice, `update public.profiles set given_name = 'X' where id = '${ids.bob}' returning id`);
check('member cannot update others', r.rows.length === 0);
await asErr('member cannot change cohort', ids.alice,
  `update public.profiles set cohort = 'other-2026' where id = '${ids.alice}'`, 'permission denied');
await asErr('member cannot insert profile', ids.alice,
  `insert into public.profiles (id, email, church, cohort) values (gen_random_uuid(), 'x@x', 'other-church', 'other-2026')`);

// RLS: churches / cohorts / invitations / admins
r = await as(ids.alice, `select id from public.churches`);
check('member sees only own church', r.rows.length === 1 && r.rows[0].id === 'freedom-church-jersey');
r = await as(ids.bob, `select id from public.cohorts`);
check('member sees only own cohort', r.rows.length === 1 && r.rows[0].id === 'other-2026');
r = await as(ids.alice, `select * from public.invitations`);
check('member cannot read invitations', r.rows.length === 0);
await asErr('member cannot add invitations', ids.alice,
  `insert into public.invitations (email, church, cohort) values ('x@x.com', 'other-church', 'other-2026')`, 'row-level security');
r = await as(ids.alice, `select * from public.admins`);
check('member cannot read admins', r.rows.length === 0);
await asErr('member cannot make self admin', ids.alice,
  `insert into public.admins values ('alice@example.com')`, 'row-level security');
r = await as(ids.alice, `select public.is_admin() a`);
check('is_admin false for member', r.rows[0].a === false);
r = await as(ids.tim, `select public.is_admin() a`);
check('is_admin true for Tim', r.rows[0].a === true);
r = await as(ids.tim, `insert into public.invitations (email, church, cohort) values ('New@X.com', 'other-church', 'other-2026') returning email`);
check('admin adds invitations', r.rows[0]?.email === 'new@x.com');
await asErr('member cannot call is_invited', ids.alice, `select public.is_invited('bob@example.com')`, 'permission denied');
await expectError('invitation cohort must belong to its church',
  `insert into public.invitations (email, church, cohort) values ('z@z.com', 'other-church', 'freedom-church-jersey-2026-09')`, 'foreign key');

// Anonymous (signed-out) visitors see nothing
await db.exec(`set role anon;`);
r = await db.query(`select count(*)::int n from public.profiles`);
const r2 = await db.query(`select count(*)::int n from public.invitations`);
await db.exec(`reset role;`);
check('anon sees no profiles or invitations', r.rows[0].n === 0 && r2.rows[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
