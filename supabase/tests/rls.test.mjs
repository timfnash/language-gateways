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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`);
// Migrations from Phase 3 on are applied later in the test, after data written under the older rules.
const migrations = readdirSync(`${repo}/migrations`).sort();
const LATER = '20261003';
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

for (const file of migrations.filter(f => f >= LATER)) {
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
