# Email templates

Branded versions of the emails Supabase sends. Paste each one into **Supabase → Authentication → Emails →
Templates** (switch the editor to its HTML/source view if it has one), set the subject, and save.

| Supabase template      | File                  | Subject                                       |
|------------------------|-----------------------|-----------------------------------------------|
| Confirm signup         | `confirm-signup.html` | Confirm your email · Flourishing in Diversity |
| Reset password         | `reset-password.html` | Reset your password · Flourishing in Diversity |
| Change email address   | `change-email.html`   | Confirm your new email · Flourishing in Diversity |

The site doesn't use magic links, invite emails or reauthentication, so those templates can stay as they are.

**Confirm signup doubles as the acknowledgement for requests to join.** The join page records whether the cohort
needs approval (`needs_approval` in the user's metadata), and the template uses `{{ if .Data.needs_approval }}` to
say "Request received … we’ll email you as soon as they have [approved it]" instead of the plain wording.
Invited people, and joiners to cohorts that don't need approval, get the plain wording.

The **approval** email ("You’re in") isn't a Supabase template: the `approve-join-request` Edge Function sends it
through Resend when an admin approves a request. Its HTML is in `supabase/functions/approve-join-request/index.ts`
(same design as these); see `supabase/functions/README.md` to deploy it.

Copy one to the clipboard:

```bash
pbcopy < supabase/email-templates/confirm-signup.html
```

Notes:

- `{{ .ConfirmationURL }}` and `{{ .NewEmail }}` are filled in by Supabase. Keep them exactly as written.
- The logo is loaded from `https://fid.languagegateways.com/assets/language-gateways.png`. Some email programs
  hide images until the reader allows them; the purple band then shows "Language Gateways" instead.
- Styles are inline and the layout uses tables, because many email programs (Outlook especially) ignore
  modern CSS. Jost is used where the email program supports web fonts; others fall back to Arial.
- Send yourself a test (e.g. **Forgotten your password?** on the site) after changing a template.
