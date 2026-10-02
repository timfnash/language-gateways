// The site header, shared by every page: menu on the left, logo in the middle, course name on the right.
// A page includes <header id="site-header"></header> and <script type="module" src="assets/header.js">.
import { supabase, configured, signOut } from './app.js';

const FEEDBACK = 'mailto:courses@languagegateways.com?subject=' + encodeURIComponent('Flourishing in Diversity: feedback');

const header = document.getElementById('site-header');
header.innerHTML = `
  <div class="inner">
    <div class="menu">
      <button class="menu-button" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
      <ul class="menu-list" id="site-menu" hidden>
        <li><a href="home.html" id="menu-home">Home</a></li>
        <li><a href="${FEEDBACK}">Feedback</a></li>
        <li data-signed-in hidden><a href="profile.html">Profile</a></li>
        <li data-admin hidden><a href="admin.html">Admin</a></li>
        <li data-signed-in hidden><button type="button" id="menu-signout">Sign out</button></li>
        <li data-signed-out><a href="index.html">Sign in</a></li>
      </ul>
    </div>
    <a class="logo" href="home.html" id="logo-link">
      <img src="assets/language-gateways.png" alt="Language Gateways" width="120" height="89">
    </a>
    <span class="course">Flourishing in Diversity</span>
  </div>`;

const button = header.querySelector('.menu-button');
const list = header.querySelector('.menu-list');
const setOpen = open => { list.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
button.addEventListener('click', () => setOpen(list.hidden));
document.addEventListener('click', e => { if (!header.querySelector('.menu').contains(e.target)) setOpen(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); button.focus(); } });
header.querySelector('#menu-signout').addEventListener('click', signOut);

// Signed-out visitors see Home → sign-in page, and Sign in instead of Profile / Sign out.
const { data } = configured ? await supabase.auth.getSession() : { data: {} };
const signedIn = Boolean(data?.session);
for (const li of header.querySelectorAll('[data-signed-in]')) li.hidden = !signedIn;
for (const li of header.querySelectorAll('[data-signed-out]')) li.hidden = signedIn;
if (signedIn) {
  // Admins and church admins get the Admin page (church admins see their church's requests and people).
  const { data: role } = await supabase.rpc('my_role');
  for (const li of header.querySelectorAll('[data-admin]')) li.hidden = !role?.[0]?.role;
} else {
  header.querySelector('#menu-home').href = 'index.html';
  header.querySelector('#logo-link').href = 'index.html';
}
