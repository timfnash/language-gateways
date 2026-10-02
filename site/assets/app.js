import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT-REF');

export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Absolute URL of a page on this site, so redirects work on localhost and on GitHub Pages.
export const pageUrl = path => new URL(path, location.href).href;

export function showMessage(el, text, kind = 'error') {
  el.textContent = text;
  el.className = `message ${kind}`;
  el.hidden = !text;
}

// Supabase reports a rejected signup differently depending on whether the auth hook or the
// fallback database trigger stopped it; show the same friendly text for both.
export function friendlyError(error) {
  const msg = error?.message || String(error || '');
  if (/invitation list|Database error saving new user/i.test(msg)) {
    return 'This email address is not on the invitation list. Please use the address you were invited with, or contact courses@languagegateways.com.';
  }
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email address first: check your inbox for the link.';
  return msg;
}

export function notConfiguredBanner() {
  const banner = document.createElement('p');
  banner.className = 'message error';
  banner.textContent = 'The site isn’t connected to Supabase yet: fill in site/assets/config.js.';
  document.querySelector('main').prepend(banner);
}

// For signed-in pages: returns the session and profile, or sends the visitor to sign in.
export async function requireSignedIn() {
  if (!configured) { notConfiguredBanner(); return {}; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.replace(pageUrl('index.html')); return {}; }
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
  return { session, profile };
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace(pageUrl('index.html'));
}

// Where a signed-in person goes next: the profile page until they've confirmed it, then home.
export async function nextPage(userId) {
  const { data } = await supabase.from('profiles').select('confirmed_at').eq('id', userId).single();
  return data?.confirmed_at ? 'home.html' : 'profile.html';
}

// ---------------------------------------------------------------------------
// Course content and progress
// ---------------------------------------------------------------------------

export const MODES = { read: 'Read', watch: 'Watch', slides: 'Slides' };

// All sessions the person can see, each with its segments in order, plus their progress.
// notes is the set of segment ids the person has written a note on.
// progress is keyed by segment id: { read: {started_at, completed_at, updated_at}, watch: …, … }
export async function loadCourse() {
  const [{ data: sessions, error }, { data: rows }, { data: noteRows }] = await Promise.all([
    supabase.from('sessions')
      .select('id, number, title, summary, youtube_id, published_at, segments (id, position, title, summary, slides, youtube_start, youtube_end)')
      .order('number'),
    supabase.from('progress').select('segment, mode, started_at, completed_at, updated_at'),
    supabase.from('notes').select('segment').neq('body', ''),
  ]);
  if (error) throw error;
  for (const s of sessions) s.segments.sort((a, b) => a.position - b.position);
  const progress = {};
  for (const r of rows ?? []) (progress[r.segment] ??= {})[r.mode] = r;
  for (const s of sessions) s.segments.forEach((g, i) => { g.part = `${i + 1}/${s.segments.length}`; });
  const notes = new Set((noteRows ?? []).map(n => n.segment));
  return { sessions, progress, notes, segments: sessions.flatMap(s => s.segments.map(g => ({ ...g, session: s }))) };
}

export const isComplete = modes => Object.values(modes ?? {}).some(m => m.completed_at);

// Awaited on purpose: supabase-js only sends a request once something waits for its result.
export async function recordProgress(segment, mode, completed = false) {
  const { error } = await supabase.rpc('record_progress', { p_segment: segment, p_mode: mode, p_completed: completed });
  if (error) console.error('Could not save progress', error);
  return !error;
}

// Short-lived URLs for private slide images, keyed by storage path.
export async function signedUrls(paths) {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from('course-media').createSignedUrls(paths, 60 * 60 * 4);
  if (error) throw error;
  return Object.fromEntries(data.filter(d => d.signedUrl).map(d => [d.path, d.signedUrl]));
}

// "1/6 Welcome and worship", with the number styled separately.
export const partTitle = (seg, esc = String) => `<span class="part">${seg.part}</span> ${esc(seg.title)}`;

export const formatTime = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
