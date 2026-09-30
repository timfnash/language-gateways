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
    return 'This email address is not on the invitation list. Please use the address you were invited with, or contact Tim.';
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
