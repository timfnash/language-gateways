// Approves a request to join, then emails the person to say they're in (through Resend).
//
// The approval runs as the signed-in admin or church admin, so the database's own rules
// (approve_join_request) decide who may approve whom. Only after that succeeds does the function
// look the person up, with the service role, to email them.
//
// The Admin page calls it with { user: <profile id> }. It answers 200 with { approved: true, emailed }
// once the request is approved, even if the email couldn't be sent (email_problem says why), and an
// error status with { error } if the approval itself was refused.
//
// Deploying and secrets: see supabase/functions/README.md.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
// Supabase provides these keys to every function. If the legacy keys are switched off, add the new ones as the
// secrets SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.
const PUBLIC_KEY = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://fid.languagegateways.com';
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') ?? 'Flourishing in Diversity <courses@languagegateways.com>';
const REPLY_TO = 'courses@languagegateways.com';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const { user } = await req.json().catch(() => ({}));
  if (typeof user !== 'string' || !user) return json({ error: 'Say which request to approve.' }, 400);

  const asCaller = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { error } = await asCaller.rpc('approve_join_request', { p_user: user });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: person } = await service.from('profiles')
    .select('email, given_name, church, cohort').eq('id', user).single();
  if (!person) return json({ approved: true, emailed: false, email_problem: 'their profile couldn’t be found' });
  const [{ data: church }, { data: cohort }] = await Promise.all([
    service.from('churches').select('name').eq('id', person.church).single(),
    service.from('cohorts').select('name').eq('id', person.cohort).single(),
  ]);

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ approved: true, emailed: false, email_problem: 'RESEND_API_KEY isn’t set' });
  const group = [church?.name, cohort?.name].filter(Boolean).join(' · ');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [person.email],
      reply_to: REPLY_TO,
      subject: 'You’re in · Flourishing in Diversity',
      html: approvedHtml(person.given_name, group),
      text: approvedText(person.given_name, group),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    console.error('Resend refused the approval email', res.status, detail);
    return json({ approved: true, emailed: false, email_problem: `the email service answered ${res.status}` });
  }
  return json({ approved: true, emailed: true });
});

const signIn = `${SITE_URL}/index.html`;

function approvedText(name: string | null, group: string) {
  return `${name ? `Dear ${name},` : 'Hello,'}

Your request to join Flourishing in Diversity${group ? ` (${group})` : ''} has been approved.

You can now sign in and start the course: watch and read each session, add your own notes, and see what other groups have shared.

Sign in: ${signIn}

Questions? Email ${REPLY_TO}.

Language Gateways · Zipf (Jersey) Ltd`;
}

// Same design as the auth emails in supabase/email-templates/ (inline styles, table layout).
function approvedHtml(name: string | null, group: string) {
  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#221A25;';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;600&display=swap" rel="stylesheet">
<title>You’re in</title>
</head>
<body style="margin:0;padding:0;background:#FBF8F2;font-family:'Jost',Arial,Helvetica,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your request to join Flourishing in Diversity has been approved.</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FBF8F2;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="background:#510074;border-radius:18px 18px 0 0;padding:18px 24px;">
        <img src="${SITE_URL}/assets/language-gateways.png" width="96" alt="Language Gateways"
             style="display:block;width:96px;height:auto;border:0;color:#FBF8F2;font-family:'Jost',Arial,sans-serif;font-weight:600;letter-spacing:2px;">
      </td></tr>
      <tr><td style="background:#FFFFFF;border-radius:0 0 18px 18px;padding:32px 32px 24px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8C6F1E;">Flourishing in Diversity</p>
        <h1 style="margin:0 0 20px;font-size:26px;line-height:1.15;font-weight:600;text-transform:uppercase;color:#510074;">You’re in</h1>
        <p style="${p}">${name ? `Dear ${esc(name)},` : 'Hello,'}</p>
        <p style="${p}">Your request to join <em>Flourishing in Diversity</em>${group ? ` (${esc(group)})` : ''} has been approved.</p>
        <p style="${p}">You can now sign in and start the course: watch and read each session, add your own notes, and see what other groups have shared.</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
          <tr><td align="center" bgcolor="#510074" style="border-radius:999px;">
            <a href="${signIn}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#FBF8F2;text-decoration:none;border-radius:999px;">Go to the course</a>
          </td></tr>
        </table>
        <p style="margin:0;padding-top:16px;border-top:1px solid #E7E0D2;font-size:13px;line-height:1.5;color:#5F5763;">You’re getting this because you asked to join the course with your church’s link.</p>
      </td></tr>
      <tr><td align="center" style="padding:16px 24px;font-size:12px;line-height:1.5;color:#5F5763;letter-spacing:.5px;">
        Language Gateways · Zipf (Jersey) Ltd<br>
        Questions? <a href="mailto:${REPLY_TO}" style="color:#5F5763;">${REPLY_TO}</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}
