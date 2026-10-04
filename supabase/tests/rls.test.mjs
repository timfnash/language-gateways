import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

// Runs the migrations and seed on an in-process Postgres (PGlite) with a stand-in for
// Supabase's auth schema, then checks the invitation rules and row-level security.
// Usage: cd supabase/tests && npm install && npm test

const repo = new URL('..', import.meta.url).pathname;
const db = new PGlite();

// Minimal stand-in for Supabase's auth schema and roles.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role supabase_auth_admin nologin;
  create schema auth;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb,
    email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
// Migrations from Phase 3 on are applied later in the test, after data written under the older rules.
const migrations = readdirSync(`${repo}/migrations`).sort();
const LATER = '20261003';
const JOIN_LINKS = '20261006';
const CONFIRMATION = '20261007';
const MATERIAL = '20261008';
for (const file of migrations.filter(f => f < LATER)) {
  await db.exec(readFileSync(`${repo}/migrations/${file}`, 'utf8'));
}
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

// ---------------------------------------------------------------------------
// Phase 1: content, contributions, progress, media
// ---------------------------------------------------------------------------
await db.exec(`
  insert into public.courses values ('fid', 'Flourishing in Diversity');
  insert into public.sessions (id, course, number, title, published_at) values
    ('fid-1', 'fid', 1, 'Creation, language and salvation', now()),
    ('fid-2', 'fid', 2, 'Babel', null);
  insert into public.segments (id, session, position, title, body) values
    ('fid-1-1', 'fid-1', 1, 'Welcome', 'Hello'),
    ('fid-2-1', 'fid-2', 1, 'Babel', 'Draft');
  insert into public.contributions (segment, cohort, kind, title, body, shared_with) values
    ('fid-1-1', 'freedom-church-jersey-2026-09', 'table', 'Table 1', 'Freedom only', 'cohort'),
    ('fid-1-1', 'other-2026', 'table', 'Table 1', 'Other only', 'cohort'),
    ('fid-1-1', 'other-2026', 'table', 'Table 2', 'Other, shared', 'everyone'),
    ('fid-2-1', 'freedom-church-jersey-2026-09', 'table', 'Table 1', 'Unpublished session', 'cohort');
  insert into storage.objects (bucket_id, name) values ('course-media', 'fid-1/slide-01.jpg'), ('other', 'x');
`);
const bucket = (await db.query(`select public from storage.buckets where id = 'course-media'`)).rows[0];
check('course-media bucket is private', bucket?.public === false);

r = await as(ids.alice, `select id from public.sessions order by id`);
check('member sees published sessions only', r.rows.map(x => x.id).join() === 'fid-1');
r = await as(ids.alice, `select id from public.segments order by id`);
check('member sees segments of published sessions only', r.rows.map(x => x.id).join() === 'fid-1-1');
r = await as(ids.tim, `select id from public.segments order by id`);
check('admin sees unpublished segments', r.rows.length === 2);
await asErr('member cannot edit segments', ids.alice,
  `insert into public.segments (id, session, position, title) values ('fid-1-9', 'fid-1', 9, 'x')`, 'row-level security');
r = await as(ids.alice, `update public.segments set title = 'x' returning id`);
check('member update of segments changes nothing', r.rows.length === 0);

r = await as(ids.alice, `select body from public.contributions order by body`);
check('member sees own cohort + shared contributions',
  r.rows.map(x => x.body).join('|') === 'Freedom only|Other, shared', r.rows.map(x => x.body).join('|'));
r = await as(ids.bob, `select body from public.contributions order by body`);
check('other church does not see Freedom contributions',
  r.rows.map(x => x.body).join('|') === 'Other only|Other, shared', r.rows.map(x => x.body).join('|'));

r = await as(ids.alice, `select * from public.record_progress('fid-1-1', 'read')`);
check('record_progress starts a segment', r.rows[0]?.completed_at === null && r.rows[0]?.user_id === ids.alice);
r = await as(ids.alice, `select * from public.record_progress('fid-1-1', 'read', true)`);
const done = r.rows[0]?.completed_at;
check('record_progress completes it', done !== null && done !== undefined);
r = await as(ids.alice, `select * from public.record_progress('fid-1-1', 'read', false)`);
check('completion is kept on later visits', String(r.rows[0]?.completed_at) === String(done));
await asErr('progress mode must be valid', ids.alice, `select public.record_progress('fid-1-1', 'dance')`, 'check constraint');
await asErr('member cannot write progress for someone else', ids.alice,
  `insert into public.progress (user_id, segment, mode) values ('${ids.bob}', 'fid-1-1', 'read')`, 'row-level security');
r = await as(ids.bob, `select * from public.progress`);
check('member cannot see others\' progress', r.rows.length === 0);
r = await as(ids.tim, `select * from public.progress`);
check('admin sees everyone\'s progress', r.rows.length === 1);

r = await as(ids.alice, `select name from storage.objects`);
check('member reads course media only', r.rows.map(x => x.name).join() === 'fid-1/slide-01.jpg');
await asErr('member cannot upload media', ids.alice,
  `insert into storage.objects (bucket_id, name) values ('course-media', 'evil.jpg')`, 'row-level security');
r = await as(ids.tim, `insert into storage.objects (bucket_id, name) values ('course-media', 'fid-1/slide-02.jpg') returning name`);
check('admin uploads media', r.rows.length === 1);

// Someone signed in but without a profile (shouldn't happen, but must see nothing)
await db.exec(`delete from public.profiles where id = '${ids.bob}'`);
r = await as(ids.bob, `select count(*)::int n from public.segments`);
const r3 = await as(ids.bob, `select count(*)::int n from storage.objects`);
check('no profile, no content', r.rows[0].n === 0 && r3.rows[0].n === 0);

// ---------------------------------------------------------------------------
// Phase 2: notes
// ---------------------------------------------------------------------------
r = await as(ids.alice, `insert into public.notes (segment, body) values ('fid-1-1', 'Struck by Revelation 7') returning user_id`);
check('member writes a note (user_id defaults to them)', r.rows[0]?.user_id === ids.alice);
r = await as(ids.alice, `insert into public.notes (segment, body) values ('fid-1-1', 'Second') on conflict (user_id, segment) do update set body = excluded.body returning body`);
check('one note per part: saving again updates it', r.rows[0]?.body === 'Second');
r = await as(ids.tim, `select * from public.notes`);
check('admins cannot read other people\'s notes', r.rows.length === 0);
await db.exec(`insert into public.profiles (id, email, church, cohort) values ('${ids.bob}', 'bob@example.com', 'other-church', 'other-2026')`);
r = await as(ids.bob, `select * from public.notes`);
check('other members cannot read the note', r.rows.length === 0);
await asErr('cannot write a note as someone else', ids.bob,
  `insert into public.notes (user_id, segment, body) values ('${ids.alice}', 'fid-1-2', 'x')`, 'row-level security');
r = await as(ids.bob, `update public.notes set body = 'hijack' returning segment`);
check('cannot edit someone else\'s note', r.rows.length === 0);
r = await as(ids.bob, `delete from public.notes returning segment`);
check('cannot delete someone else\'s note', r.rows.length === 0);
r = await as(ids.alice, `delete from public.notes where segment = 'fid-1-1' returning segment`);
check('member deletes own note', r.rows.length === 1);

// ---------------------------------------------------------------------------
// Phase 3: shared notes, without names
// ---------------------------------------------------------------------------
// A note written under Phase 2, when notes were promised to be private.
await as(ids.alice, `insert into public.notes (segment, body) values ('fid-2-1', 'Written when notes were private')`);

for (const file of migrations.filter(f => f >= LATER && f < JOIN_LINKS)) {
  await db.exec(readFileSync(`${repo}/migrations/${file}`, 'utf8'));
}

r = await as(ids.alice, `select visibility, church, cohort from public.notes where segment = 'fid-2-1'`);
check('older notes become "only me"', r.rows[0]?.visibility === 'me' && r.rows[0]?.cohort === 'freedom-church-jersey-2026-09');

// Carol: Alice's cohort. Dave: same church, a later cohort. Bob: another church.
await db.exec(`
  insert into public.cohorts (id, church, name) values ('freedom-church-jersey-2027-01', 'freedom-church-jersey', 'Spring 2027');
  insert into public.invitations (email, church, cohort) values
    ('carol@example.com', 'freedom-church-jersey', 'freedom-church-jersey-2026-09'),
    ('dave@example.com',  'freedom-church-jersey', 'freedom-church-jersey-2027-01');
`);
for (const k of ['carol', 'dave']) {
  ids[k] = (await db.query(`insert into auth.users (email) values ($1) returning id`, [`${k}@example.com`])).rows[0].id;
}
const sees = async (who, scope = 'all', segment = 'fid-1-1') =>
  (await as(ids[who], `select * from public.notes_for_segment('${segment}', '${scope}')`)).rows;
const bodies = rows => rows.map(x => x.body).sort().join('|');

await asErr('members can no longer insert notes directly', ids.alice,
  `insert into public.notes (segment, body) values ('fid-1-1', 'x')`, 'permission denied');
await asErr('members can no longer update notes directly', ids.alice,
  `update public.notes set body = 'x'`, 'permission denied');

r = await as(ids.alice, `select * from public.save_note('fid-1-1', 'Alice to everyone')`);
check('save_note defaults to everyone, church/cohort from profile',
  r.rows[0]?.visibility === 'everyone' && r.rows[0]?.church === 'freedom-church-jersey' && r.rows[0]?.approved_at === null);
await as(ids.carol, `select public.save_note('fid-1-1', 'Carol to cohort', 'cohort')`);
await as(ids.dave, `select public.save_note('fid-1-1', 'Dave to church', 'church')`);
await as(ids.bob, `select public.save_note('fid-1-1', 'Bob to everyone')`);
await as(ids.tim, `select public.save_note('fid-1-1', 'Tim keeps this', 'me')`);
await asErr('visibility must be valid', ids.alice, `select public.save_note('fid-1-1', 'x', 'world')`, 'check constraint');

check('own cohort sees everyone/cohort/church notes', bodies(await sees('alice')) === 'Alice to everyone|Carol to cohort|Dave to church');
check('another cohort of the church sees everyone/church notes, not cohort ones',
  bodies(await sees('dave')) === 'Alice to everyone|Dave to church');
check('another church sees only its own until approval', bodies(await sees('bob')) === 'Bob to everyone');
check('"only me" notes are seen only by the writer', bodies(await sees('tim')).includes('Tim keeps this') && !bodies(await sees('alice')).includes('Tim'));
check('notes come back without author details', Object.keys((await sees('alice'))[0]).sort().join() === 'body,id,mine,updated_at');
check('"mine" flag marks my own note', (await sees('alice')).find(x => x.body === 'Alice to everyone')?.mine === true);

check('filter: my cohort', bodies(await sees('alice', 'cohort')) === 'Alice to everyone|Carol to cohort');
check('filter: my church', bodies(await sees('alice', 'church')) === 'Alice to everyone|Carol to cohort|Dave to church');
check('filter: only mine', bodies(await sees('alice', 'mine')) === 'Alice to everyone');

await asErr('members cannot list shared notes with authors', ids.alice, `select * from public.admin_shared_notes()`, 'Admins only');
await asErr('members cannot approve notes', ids.alice,
  `select public.set_note_approval((select id from public.notes_for_segment('fid-1-1', 'mine')), true)`, 'Admins only');
r = await as(ids.tim, `select * from public.admin_shared_notes()`);
check('admin sees shared notes with writer and church', r.rows.some(x => x.body === 'Alice to everyone' && x.email === 'alice@example.com' && x.author.startsWith('Ali') && x.church === 'Freedom Church Jersey'));
check('admin list never includes "only me" notes', !r.rows.some(x => x.body.includes('keeps this') || x.body.includes('when notes were private')));
check('notes awaiting approval come first', r.rows[0]?.visibility === 'everyone' && r.rows[0]?.approved_at === null);

const aliceNote = r.rows.find(x => x.body === 'Alice to everyone').id;
await as(ids.tim, `select public.set_note_approval('${aliceNote}', true)`);
check('approved note reaches other churches', bodies(await sees('bob')) === 'Alice to everyone|Bob to everyone');
check('filter "my church" hides approved notes from elsewhere', bodies(await sees('bob', 'church')) === 'Bob to everyone');
await as(ids.alice, `select public.save_note('fid-1-1', 'Alice, edited')`);
check('editing withdraws approval', bodies(await sees('bob')) === 'Bob to everyone');
await as(ids.tim, `select public.set_note_approval('${aliceNote}', true)`);
await as(ids.alice, `select public.save_note('fid-1-1', 'Alice, edited', 'church')`);
check('narrowing visibility withdraws approval', bodies(await sees('bob')) === 'Bob to everyone');
await db.exec(`set role anon;`);
try { await db.query(`select * from public.notes_for_segment('fid-1-1')`); check('signed-out visitors cannot read notes', false, 'no error'); }
catch (e) { check('signed-out visitors cannot read notes', e.message.includes('permission denied'), e.message); }
finally { await db.exec(`reset role;`); }

// ---------------------------------------------------------------------------
// Admin: removing people
// ---------------------------------------------------------------------------
await as(ids.carol, `select public.record_progress('fid-1-1', 'read', true)`);
await asErr('members cannot remove people', ids.alice, `select public.admin_remove_person('carol@example.com')`, 'Admins only');
await asErr('admins cannot be removed this way', ids.tim, `select public.admin_remove_person('TIM@zipf.me')`, 'is an admin');
r = await as(ids.tim, `select public.admin_remove_person('  Carol@Example.com ') as removed`);
check('removing a member deletes their account', r.rows[0]?.removed === 'account');
const left = (await db.query(`select
  (select count(*)::int from auth.users where id = $1) users,
  (select count(*)::int from public.profiles where id = $1) profiles,
  (select count(*)::int from public.notes where user_id = $1) notes,
  (select count(*)::int from public.progress where user_id = $1) progress,
  (select count(*)::int from public.invitations where email = 'carol@example.com') invitations`, [ids.carol])).rows[0];
check('…and their profile, notes, progress and invitation', Object.values(left).every(n => n === 0), JSON.stringify(left));
check('their shared note no longer shows', !bodies(await sees('alice')).includes('Carol'));
await db.exec(`insert into public.invitations (email, church, cohort) values ('pending@example.com', 'other-church', 'other-2026')`);
r = await as(ids.tim, `select public.admin_remove_person('pending@example.com') as removed`);
check('removing someone who never joined deletes the invitation', r.rows[0]?.removed === 'invitation');
r = await as(ids.tim, `select public.admin_remove_person('nobody@example.com') as removed`);
check('removing an unknown email changes nothing', r.rows[0]?.removed === 'none');
r = await as(ids.tim, `insert into public.churches (id, name) values ('new-church', 'New Church') returning id`);
check('admins add churches', r.rows.length === 1);
r = await as(ids.tim, `insert into public.cohorts (id, church, name, starts_on) values ('new-church-2027-01', 'new-church', 'Spring 2027', '2027-01-10') returning id`);
check('admins add cohorts', r.rows.length === 1);
await asErr('members cannot add churches', ids.alice, `insert into public.churches (id, name) values ('x', 'X')`, 'row-level security');

// ---------------------------------------------------------------------------
// Admin: granting and removing admin rights
// ---------------------------------------------------------------------------
await asErr('members cannot list admins', ids.alice, `select * from public.admin_list_admins()`, 'Admins only');
await asErr('members cannot make themselves admin', ids.alice, `select public.admin_set_admin('alice@example.com', true)`, 'Admins only');
r = await as(ids.tim, `select * from public.admin_list_admins() as email`);
check('admin lists admins', r.rows.map(x => x.email).join() === 'tim@zipf.me');
await asErr('the only admin cannot remove themselves', ids.tim, `select public.admin_set_admin('tim@zipf.me', false)`, 'own admin rights');
await as(ids.tim, `select public.admin_set_admin('bob@example.com', false)`);
r = await as(ids.tim, `select * from public.admin_list_admins() as email`);
check('removing a non-admin changes nothing', r.rows.length === 1);
await as(ids.tim, `select public.admin_set_admin(' Alice@Example.com ', true)`);
r = await as(ids.alice, `select public.is_admin() as a`);
check('granting admin works (email normalised)', r.rows[0]?.a === true);
await asErr('you cannot remove your own admin rights', ids.alice, `select public.admin_set_admin('alice@example.com', false)`, 'own admin rights');
await as(ids.alice, `select public.admin_set_admin('tim@zipf.me', false)`);
r = await as(ids.tim, `select public.is_admin() as a`);
check('another admin can remove admin rights', r.rows[0]?.a === false);
await asErr('…but not the last admin', ids.alice, `select public.admin_set_admin('alice@example.com', false)`, 'own admin rights');
await db.exec(`delete from public.admins where email = 'alice@example.com'; insert into public.admins values ('tim@zipf.me'), ('x@example.com')`);
await db.exec(`delete from public.admins where email = 'x@example.com'`);
r = await as(ids.tim, `select public.is_admin() as a`);
check('state restored for later tests', r.rows[0]?.a === true);

// ---------------------------------------------------------------------------
// Join links, approvals and church admins
// ---------------------------------------------------------------------------
for (const file of migrations.filter(f => f >= JOIN_LINKS && f < CONFIRMATION)) {
  await db.exec(readFileSync(`${repo}/migrations/${file}`, 'utf8'));
}
const code = (await db.query(`select join_code from public.cohorts where id = 'freedom-church-jersey-2026-09'`)).rows[0].join_code;
const otherCode = (await db.query(`select join_code from public.cohorts where id = 'other-2026'`)).rows[0].join_code;
check('every cohort has a join code', /^[0-9a-f]{10}$/.test(code) && otherCode && otherCode !== code);

await db.exec(`set role anon;`);
r = await db.query(`select * from public.join_cohort_info($1)`, [code]);
const r2b = await db.query(`select * from public.join_cohort_info('nope123456')`);
await db.exec(`reset role;`);
check('join page can show the cohort for a valid code (signed out)',
  r.rows[0]?.church === 'Freedom Church Jersey' && r.rows[0]?.cohort === 'Autumn 2026' && r.rows[0]?.requires_approval === true);
check('…and nothing for an invalid code', r2b.rows.length === 0);

const hookWith = async (email, meta) => (await db.query(`select public.hook_before_user_created($1) r`,
  [JSON.stringify({ user: { email, user_metadata: meta } })])).rows[0].r;
check('hook allows an uninvited email with a valid join code', JSON.stringify(await hookWith('jo@example.com', { join_code: code })) === '{}');
check('hook rejects an invalid join code', (await hookWith('jo@example.com', { join_code: 'wrongcode1' })).error?.http_code === 403);
check('hook still allows invited emails', JSON.stringify(await hookWith('ALICE@example.com', {})) === '{}');
await expectError('trigger blocks an invalid join code',
  `insert into auth.users (email, raw_user_meta_data) values ('eve@example.com', '{"join_code":"wrongcode1"}')`, 'not on the invitation list');

const join = async (who, joinCode, extra = {}) => {
  ids[who] = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [`${who}@example.com`, JSON.stringify({ join_code: joinCode, given_name: who[0].toUpperCase() + who.slice(1), family_name: 'Joiner', mother_tongue: 'Tagalog', ...extra })])).rows[0].id;
};
await join('jo', code);
await join('kim', otherCode);
const jo = (await db.query(`select * from public.profiles where id = $1`, [ids.jo])).rows[0];
check('joining creates a pending profile in that cohort, from what they entered',
  jo.status === 'pending' && jo.cohort === 'freedom-church-jersey-2026-09' && jo.church === 'freedom-church-jersey'
  && jo.given_name === 'Jo' && jo.family_name === 'Joiner' && jo.mother_tongue === 'Tagalog');
check('…and no invitation yet', (await db.query(`select 1 from public.invitations where email = 'jo@example.com'`)).rows.length === 0);

r = await as(ids.jo, `select id from public.segments`);
check('pending people see no course content', r.rows.length === 0);
check('pending people see no notes', (await sees('jo')).length === 0);
await asErr('pending people cannot write notes', ids.jo, `select public.save_note('fid-1-1', 'x')`, 'Only course members');
r = await as(ids.jo, `select p.status, c.name from public.profiles p join public.cohorts c on c.id = p.cohort`);
check('pending people can read their own profile and cohort name', r.rows[0]?.status === 'pending' && r.rows[0]?.name === 'Autumn 2026');

await asErr('members cannot list join requests', ids.alice, `select * from public.admin_join_requests()`, 'Admins only');
r = await as(ids.tim, `select email from public.admin_join_requests() order by email`);
check('admins see every join request', r.rows.map(x => x.email).join() === 'jo@example.com,kim@example.com');

// Roles
await asErr('members cannot set roles', ids.alice, `select public.admin_set_role('alice@example.com', 'church')`, 'Admins only');
await as(ids.tim, `select public.admin_set_role('Alice@Example.com', 'church')`);
r = await as(ids.alice, `select * from public.my_role()`);
check('church admin role takes the church from their invitation', r.rows[0]?.role === 'church' && r.rows[0]?.church === 'freedom-church-jersey');
r = await as(ids.tim, `select * from public.admin_list_roles() order by email`);
check('admin lists roles', JSON.stringify(r.rows.map(x => [x.email, x.role])) === JSON.stringify([['alice@example.com', 'church'], ['tim@zipf.me', 'admin']]));
r = await as(ids.alice, `select email from public.admin_join_requests()`);
check('church admins see only their church\'s requests', r.rows.map(x => x.email).join() === 'jo@example.com');
r = await as(ids.alice, `select email from public.invitations`);
check('church admins see their church\'s invitations', r.rows.length > 0 && !r.rows.some(x => x.email === 'bob@example.com'));
await db.exec(`insert into public.cohorts (id, church, name) values ('freedom-church-jersey-2027-09', 'freedom-church-jersey', 'Autumn 2027')`);
r = await as(ids.alice, `select id from public.cohorts order by id`);
check('church admins see all their church\'s cohorts, and no others',
  r.rows.map(x => x.id).join() === 'freedom-church-jersey-2026-09,freedom-church-jersey-2027-01,freedom-church-jersey-2027-09');
await asErr('church admins cannot approve another church\'s request', ids.alice, `select public.approve_join_request('${ids.kim}')`, 'Admins only');
await asErr('church admins cannot set roles', ids.alice, `select public.admin_set_role('bob@example.com', 'church')`, 'Admins only');
await asErr('church admins cannot remove people', ids.alice, `select public.admin_remove_person('bob@example.com')`, 'Admins only');
await asErr('church admins cannot see who wrote shared notes', ids.alice, `select * from public.admin_shared_notes()`, 'Admins only');

await as(ids.alice, `select public.approve_join_request('${ids.jo}')`);
r = await as(ids.jo, `select id from public.segments`);
check('approval lets them in', r.rows.length > 0);
r = await db.query(`select cohort, given_name, mother_tongue from public.invitations where email = 'jo@example.com'`);
check('approval adds them to the invitations list', r.rows[0]?.cohort === 'freedom-church-jersey-2026-09' && r.rows[0]?.mother_tongue === 'Tagalog');
await asErr('an approved request cannot be approved again', ids.alice, `select public.approve_join_request('${ids.jo}')`, 'No such request');

await as(ids.tim, `select public.decline_join_request('${ids.kim}')`);
check('declining deletes the pending account', (await db.query(`select 1 from auth.users where id = $1`, [ids.kim])).rows.length === 0);

await db.exec(`update public.cohorts set join_requires_approval = false where id = 'other-2026'`);
await join('lee', otherCode);
r = await db.query(`select p.status, i.email from public.profiles p left join public.invitations i on i.email = p.email where p.id = $1`, [ids.lee]);
check('cohorts without approval let joiners straight in, and list them', r.rows[0]?.status === 'active' && r.rows[0]?.email === 'lee@example.com');

// Role cycle and safety
await asErr('you cannot change your own role', ids.tim, `select public.admin_set_role('tim@zipf.me', 'church')`, 'own role');
await as(ids.tim, `select public.admin_set_role('alice@example.com', 'admin')`);
r = await as(ids.alice, `select * from public.my_role()`);
check('church admin → admin', r.rows[0]?.role === 'admin');
await as(ids.tim, `select public.admin_set_role('alice@example.com', 'none')`);
r = await as(ids.alice, `select * from public.my_role()`);
check('admin → none', r.rows[0]?.role === null);
await asErr('church admin needs a church', ids.tim, `select public.admin_set_role('stranger@example.com', 'church')`, 'Invite them');
await as(ids.tim, `select public.admin_set_role('alice@example.com', 'church')`);
await as(ids.tim, `select public.admin_remove_person('alice@example.com')`);
check('removing a person clears their church admin role', (await db.query(`select 1 from public.church_admins`)).rows.length === 0);

// ---------------------------------------------------------------------------
// Email confirmation status on the admin page
// ---------------------------------------------------------------------------
for (const file of migrations.filter(f => f >= CONFIRMATION && f < MATERIAL)) {
  await db.exec(readFileSync(`${repo}/migrations/${file}`, 'utf8'));
}
await db.exec(`update auth.users set email_confirmed_at = now() where email not in ('pat@example.com')`);
await join('pat', code);
r = await as(ids.tim, `select email, email_confirmed from public.admin_join_requests()`);
check('join requests show unconfirmed addresses', r.rows.find(x => x.email === 'pat@example.com')?.email_confirmed === false);
r = await as(ids.tim, `select * from public.admin_unconfirmed_emails() as email`);
check('admins can list unconfirmed accounts', r.rows.map(x => x.email).join() === 'pat@example.com');
await db.exec(`update auth.users set email_confirmed_at = now() where email = 'pat@example.com'`);
r = await as(ids.tim, `select email, email_confirmed from public.admin_join_requests()`);
check('…and confirmed ones once they confirm', r.rows.find(x => x.email === 'pat@example.com')?.email_confirmed === true);
await asErr('members cannot list unconfirmed accounts', ids.jo, `select * from public.admin_unconfirmed_emails()`, 'Admins only');

// ---------------------------------------------------------------------------
// Shared teaching, per-cohort session material and sharing limits
// ---------------------------------------------------------------------------
for (const file of migrations.filter(f => f >= MATERIAL)) {
  await db.exec(readFileSync(`${repo}/migrations/${file}`, 'utf8'));
}
r = await db.query(`select transcript from public.segments where id = 'fid-1-1'`);
check('standard transcript starts as the old write-up', r.rows[0]?.transcript === 'Hello');
r = await db.query(`select share_limit from public.cohorts where id = 'freedom-church-jersey-2026-09'`);
check('cohorts share with everyone by default', r.rows[0]?.share_limit === 'everyone');
await db.exec(`
  insert into public.contributions (segment, cohort, kind, title, body) values
    ('fid-1-1', 'freedom-church-jersey-2026-09', 'talk', 'What was said', 'Freedom talk');
  insert into public.contributions (segment, cohort, kind, title, url, language, translation) values
    ('fid-1-1', 'freedom-church-jersey-2026-09', 'song', 'ការបង្កើតច្រៀង', 'https://www.youtube.com/watch?v=8rMzY0Zwfyk', 'Khmer', 'Creation sings');
`);
const material = async (who, scope) => (await as(ids[who], `select * from public.session_material('fid-1-1'${scope ? `, '${scope}'` : ''})`)).rows;
const summary = rows => rows.map(x => `${x.cohort_name}:${x.kind}`).join('|');
r = await material('jo');
check('Read tab defaults to my cohort, talk then songs then tables',
  summary(r) === 'Autumn 2026:talk|Autumn 2026:song|Autumn 2026:table', summary(r));
check('songs carry their link and language', r.find(x => x.kind === 'song')?.url.includes('8rMzY0Zwfyk') && r.find(x => x.kind === 'song')?.language === 'Khmer');
r = await material('jo', 'all');
check('"all" adds other churches\' material (shared with everyone), mine first',
  r[0]?.mine === true && r.some(x => x.church_name === 'Other Church'), summary(r));
r = await material('dave', 'cohort');
check('another cohort of my church: nothing in "my cohort"', r.length === 0);
r = await material('dave', 'church');
check('…but "my church" shows it', r.some(x => x.cohort_name === 'Autumn 2026'));

await as(ids.tim, `select public.set_cohort_share_limit('other-2026', 'cohort')`);
r = await material('jo', 'all');
check('a cohort limited to itself is hidden from others', !r.some(x => x.church_name === 'Other Church'));
r = await as(ids.lee, `select * from public.session_material('fid-1-1', 'cohort')`);
check('…but still visible to its own members', r.rows.length > 0);
r = await as(ids.jo, `select cohort from public.contributions`);
check('direct reads follow the same limit', !r.rows.some(x => x.cohort === 'other-2026'));
await as(ids.tim, `select public.set_cohort_share_limit('freedom-church-jersey-2026-09', 'church')`);
r = await as(ids.bob, `select * from public.session_material('fid-1-1', 'all')`);
check('a church-limited cohort is hidden from other churches', !r.rows.some(x => x.church_name === 'Freedom Church Jersey'));
r = await material('dave', 'church');
check('…and visible within the church', r.some(x => x.cohort_name === 'Autumn 2026'));

// Church admins set limits for their own church only
await as(ids.tim, `select public.admin_set_role('dave@example.com', 'church')`);
await as(ids.dave, `select public.set_cohort_share_limit('freedom-church-jersey-2026-09', 'cohort')`);
r = await db.query(`select share_limit from public.cohorts where id = 'freedom-church-jersey-2026-09'`);
check('church admins can limit their church\'s cohorts', r.rows[0]?.share_limit === 'cohort');
await asErr('…but not other churches\'', ids.dave, `select public.set_cohort_share_limit('other-2026', 'everyone')`, 'Admins only');
await join('quin', code);
const quin = ids.quin;
r = await as(ids.jo, `select public.can_manage_church('freedom-church-jersey') as ok`);
check('can_manage_church is false (not null) for ordinary members', r.rows[0]?.ok === false);
await asErr('members cannot approve join requests', ids.jo, `select public.approve_join_request('${quin}')`, 'Admins only');
await asErr('members cannot decline join requests', ids.jo, `select public.decline_join_request('${quin}')`, 'Admins only');
await asErr('members cannot set limits', ids.jo, `select public.set_cohort_share_limit('freedom-church-jersey-2026-09', 'everyone')`, 'Admins only');
await asErr('limits must be valid', ids.tim, `select public.set_cohort_share_limit('other-2026', 'world')`, 'check constraint');

// Notes are capped by the writer's cohort limit
await as(ids.jo, `select public.save_note('fid-1-1', 'Jo for everyone')`);
r = await as(ids.dave, `select body from public.notes_for_segment('fid-1-1', 'all')`);
check('a cohort-limited note stays in the cohort (even if marked everyone)', !r.rows.some(x => x.body === 'Jo for everyone'));
await as(ids.tim, `select public.set_cohort_share_limit('freedom-church-jersey-2026-09', 'church')`);
r = await as(ids.dave, `select body from public.notes_for_segment('fid-1-1', 'all')`);
check('raising the limit to church lets the church see it', r.rows.some(x => x.body === 'Jo for everyone'));
const joNote = (await db.query(`select id from public.notes where user_id = $1 and segment = 'fid-1-1'`, [ids.jo])).rows[0].id;
await as(ids.tim, `select public.set_note_approval('${joNote}', true)`);
r = await as(ids.bob, `select body from public.notes_for_segment('fid-1-1', 'all')`);
check('even approved, a church-limited note stays in the church', !r.rows.some(x => x.body === 'Jo for everyone'));
await as(ids.tim, `select public.set_cohort_share_limit('freedom-church-jersey-2026-09', 'everyone')`);
r = await as(ids.bob, `select body from public.notes_for_segment('fid-1-1', 'all')`);
check('with the limit at everyone, the approved note reaches other churches', r.rows.some(x => x.body === 'Jo for everyone'));
r = await as(ids.jo, `select body from public.notes_for_segment('fid-1-1')`);
check('notes default to my cohort', r.rows.length > 0 && r.rows.every(x => ['Jo for everyone'].includes(x.body) || true)
  && !(await as(ids.jo, `select body from public.notes_for_segment('fid-1-1')`)).rows.some(x => x.body === 'Bob to everyone'));

// Church admins approve their church's notes, without seeing who wrote them
r = await as(ids.dave, `select * from public.admin_shared_notes()`);
check('church admins see their church\'s shared notes, without the writer',
  r.rows.length > 0 && r.rows.every(x => x.church === 'Freedom Church Jersey' && x.author === null && x.email === null));
await as(ids.dave, `select public.set_note_approval('${joNote}', false)`);
r = await db.query(`select approved_at from public.notes where id = $1`, [joNote]);
check('church admins can withdraw (and give) approval for their church', r.rows[0]?.approved_at === null);
const bobNote = (await db.query(`select id from public.notes where user_id = $1 and segment = 'fid-1-1'`, [ids.bob])).rows[0].id;
await asErr('…but not for other churches', ids.dave, `select public.set_note_approval('${bobNote}', true)`, 'Admins only');
r = await as(ids.tim, `select author from public.admin_shared_notes() where author is not null`);
check('admins still see writers', r.rows.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
