// Sends an email from the Admin page to people on the invitations list (through Resend).
//
// The Admin page calls it with { emails: [...], subject, message, test? }. Only admins may use it (checked
// with the caller's own sign-in), and it only sends to addresses on the invitations list, so it can't be used
// to email anyone else. Each person gets their own copy, starting "Dear <given name>,". With test: true, one
// copy goes to the admin who is sending, and nobody else.
//
// It answers { sent, failed, not_invited } (counts), or an error status with { error }.
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
const MAX_RECIPIENTS = 500;

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
  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject ?? '').trim(), message = String(body.message ?? '').trim();
  const emails = Array.isArray(body.emails) ? [...new Set(body.emails.map((e: unknown) => String(e).trim().toLowerCase()))] : [];
  if (!subject || !message) return json({ error: 'Write a subject and a message.' }, 400);
  if (!body.test && !emails.length) return json({ error: 'Choose who to send it to.' }, 400);
  if (emails.length > MAX_RECIPIENTS) return json({ error: `Send to at most ${MAX_RECIPIENTS} people at a time.` }, 400);

  // Admins only, judged by the caller's own sign-in.
  const asCaller = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: isAdmin } = await asCaller.rpc('is_admin');
  if (isAdmin !== true) return json({ error: 'Only admins can send emails.' }, 403);

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ error: 'RESEND_API_KEY isn’t set.' }, 500);

  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  let recipients: { email: string; name: string | null }[];
  if (body.test) {
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user?.email) return json({ error: 'Couldn’t find your own email address.' }, 400);
    const { data: me } = await service.from('profiles').select('given_name').eq('id', user.id).maybeSingle();
    recipients = [{ email: user.email, name: me?.given_name ?? null }];
  } else {
    // Only people on the invitations list; their profile's name if they've joined, otherwise the invitation's.
    const [{ data: invited }, { data: profiles }] = await Promise.all([
      service.from('invitations').select('email, given_name').in('email', emails),
      service.from('profiles').select('email, given_name').in('email', emails),
    ]);
    const nameOf = new Map((profiles ?? []).map(p => [p.email, p.given_name]));
    recipients = (invited ?? []).map(i => ({ email: i.email, name: nameOf.get(i.email) || i.given_name || null }));
  }

  // Resend's batch endpoint takes up to 100 emails per call; each is a separate email to one person.
  let sent = 0, failed = 0;
  const fullSubject = body.test ? `[Test] ${subject}` : subject;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map(r => ({
        from: EMAIL_FROM, to: [r.email], reply_to: REPLY_TO, subject: fullSubject,
        html: emailHtml(r.name, subject, message), text: emailText(r.name, message),
      }))),
    });
    if (res.ok) sent += chunk.length;
    else {
      failed += chunk.length;
      console.error('Resend refused a batch', res.status, (await res.text()).slice(0, 300));
    }
  }
  return json({ sent, failed, not_invited: body.test ? 0 : emails.length - recipients.length });
});

const greeting = (name: string | null) => (name ? `Dear ${name},` : 'Hello,');

function emailText(name: string | null, message: string) {
  return `${greeting(name)}

${message}

Questions? Email ${REPLY_TO}.

Language Gateways · Zipf (Jersey) Ltd`;
}

// The message as HTML: blank lines start paragraphs, single line breaks are kept, and web links are clickable.
function messageHtml(message: string) {
  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#221A25;';
  const link = (t: string) => t.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)'"]/g,
    url => `<a href="${url}" style="color:#510074;">${url}</a>`);
  return message.split(/\n\s*\n/).map(para => `<p style="${p}">${link(esc(para.trim())).replace(/\n/g, '<br>')}</p>`).join('\n        ');
}

// Same design as the auth emails in supabase/email-templates/ (inline styles, table layout).
function emailHtml(name: string | null, subject: string, message: string) {
  const p = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#221A25;';
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;600&display=swap" rel="stylesheet">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FBF8F2;font-family:'Jost',Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FBF8F2;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="background:#510074;border-radius:18px 18px 0 0;padding:18px 24px;">
        <img src="${SITE_URL}/assets/language-gateways.png" width="96" alt="Language Gateways"
             style="display:block;width:96px;height:auto;border:0;color:#FBF8F2;font-family:'Jost',Arial,sans-serif;font-weight:600;letter-spacing:2px;">
      </td></tr>
      <tr><td style="background:#FFFFFF;border-radius:0 0 18px 18px;padding:32px 32px 24px;">
        <p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8C6F1E;">Flourishing in Diversity</p>
        <h1 style="margin:0 0 20px;font-size:26px;line-height:1.15;font-weight:600;text-transform:uppercase;color:#510074;">${esc(subject)}</h1>
        <p style="${p}">${esc(greeting(name))}</p>
        ${messageHtml(message)}
        <p style="margin:0;padding-top:16px;border-top:1px solid #E7E0D2;font-size:13px;line-height:1.5;color:#5F5763;">You’re getting this because you’re taking part in <a href="${SITE_URL}" style="color:#5F5763;">Flourishing in Diversity</a>.</p>
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
