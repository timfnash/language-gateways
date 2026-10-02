# Email templates

Branded versions of the emails Supabase sends. Paste each one into **Supabase → Authentication → Emails →
Templates** (switch the editor to its HTML/source view if it has one), set the subject, and save.

| Supabase template      | File                  | Subject                                       |
|------------------------|-----------------------|-----------------------------------------------|
| Confirm signup         | `confirm-signup.html` | Confirm your email · Flourishing in Diversity |
| Reset password         | `reset-password.html` | Reset your password · Flourishing in Diversity |
| Change email address   | `change-email.html`   | Confirm your new email · Flourishing in Diversity |

The site doesn't use magic links, invite emails or reauthentication, so those templates can stay as they are.

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
