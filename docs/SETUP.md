# Setting up the course site (Phase 0)

These are the one-off steps that need your accounts. Do them in order; each takes a few minutes.
The code for everything else is already in the repo.

## 1. Supabase project

1. Sign in at <https://supabase.com/dashboard> and click **New project**.
   Name: `language-gateways`. Region: **West EU (London)** (`eu-west-2`), to keep data in the UK.
   Save the database password in your password manager.
2. **SQL Editor → New query**: paste the whole of
   `supabase/migrations/20260930000000_foundations.sql`, run it, then do the same with `supabase/seed.sql`.
3. **Authentication → Hooks → Add hook → Before User Created**: choose **Postgres function**,
   schema `public`, function `hook_before_user_created`. Save.
   (Signup is already blocked for uninvited emails without the hook; the hook gives people a clearer message.)
4. **Authentication → Sign In / Providers → Email**: make sure *Enable email provider* and
   *Confirm email* are both on. Set the minimum password length to 8.
5. **Authentication → URL Configuration**:
   - Site URL: `https://fid.languagegateways.com`
   - Redirect URLs: add `https://fid.languagegateways.com/**` and `http://localhost:8000/**`
6. **Project Settings → API**: copy the *Project URL* and the *anon public* key into
   `site/assets/config.js`. Both are safe to publish.

## 2. Google sign-in

1. At <https://console.cloud.google.com>, create a project called *Flourishing in Diversity*
   (the project ID underneath is only seen by you).
2. **Google Auth Platform → Get started**: app name *Flourishing in Diversity*; user support email;
   audience **External**; contact email.
3. **Create OAuth client**: Web application.
   - Authorised JavaScript origins: `https://fid.languagegateways.com`, `http://localhost:8000`
   - Authorised redirect URI: `https://qlfzuimffvvpzraeebjp.supabase.co/auth/v1/callback`
4. Copy the client ID and client secret straight into Supabase, **Authentication → Sign In / Providers → Google**,
   and enable it. (The secret never goes in the repo.)
5. **Branding**: home page `https://fid.languagegateways.com`, privacy policy
   `https://fid.languagegateways.com/privacy.html`, terms `https://fid.languagegateways.com/terms.html`;
   authorised domains `languagegateways.com` and `supabase.co`.
6. **Audience → Publish app**. While it's in *Testing*, only listed test users can sign in with Google.
   The site only asks for name and email, so publishing doesn't need Google's verification.

## 3. Domain

Done. The DNS for `languagegateways.com` is managed in Wix, which has this CNAME record:

| Host name | Value |
|-----------|-------|
| `fid`     | `timfnash.github.io` |

Each course gets its own subdomain (`fid` = *Flourishing in Diversity*); the main Wix site is unaffected.
Once GitHub has issued the certificate, tick **Enforce HTTPS** in the repo's **Settings → Pages**.

## 4. Try it

1. Run the site locally:
   ```bash
   python3 -m http.server 8000 --directory site
   ```
2. Open <http://localhost:8000>, choose **Create account** with tim@zipf.me, confirm the email,
   and check that your profile is pre-filled.
3. Try creating an account with an email that isn't invited: it should be refused.
4. Push to `main`; the **Deploy site** workflow publishes `site/` to <https://fid.languagegateways.com>.

## Checking the database rules

The invitation rules and row-level security have automated tests that run on an in-process Postgres:

```bash
cd supabase/tests && npm install && npm test
```
