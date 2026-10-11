# Edge Functions

There's no Supabase CLI on Tim's Mac, so functions are deployed from the dashboard.

## approve-join-request

The Admin page's **Approve** button calls this function. It approves the request as the signed-in admin or
church admin (the database decides whether they may), then emails the person through Resend to say they're in.
If the function isn't deployed yet, the Admin page approves directly and says the email wasn't sent.

### Deploying

1. **Resend API key.** In Resend → **API Keys → Create API key**: name it `fid-approval-emails`, permission
   **Sending access**, domain `languagegateways.com` (already verified, because Supabase's SMTP uses Resend).
2. **Secrets.** In Supabase → **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY`: the key from step 1.
   - Optional: `EMAIL_FROM` (default `Flourishing in Diversity <courses@languagegateways.com>`, which must be on
     the verified domain) and `SITE_URL` (default `https://fid.languagegateways.com`).
3. **The function.** In Supabase → **Edge Functions → Deploy a new function → Via Editor**: name it
   `approve-join-request`, replace the example code with the contents of `approve-join-request/index.ts`, and
   **Deploy**. Copy it to the clipboard with:

   ```bash
   pbcopy < supabase/functions/approve-join-request/index.ts
   ```

4. **Try it.** Use a join link with a test address you can read, then approve the request on the Admin page.
   The message should say "we’ve emailed to tell them". If it says the email wasn't sent, the reason follows;
   the function's **Logs** tab in Supabase has more detail.

To change the function later, open it in **Edge Functions**, edit or paste the new code, and deploy again.

### If approving says the function "didn't accept your sign-in"

Supabase checks the caller's sign-in token before running a function ("Enforce JWT verification"), and that
check can fail with the newer API keys. Turn it off in the function's **Details** tab. That's safe: the
function approves only through `approve_join_request` with the caller's own token, which refuses anyone who
isn't an admin or the person's church admin.

## send-email

The Admin page's **Email selected** button (Invitations tab) calls this function. It sends an admin's message to
the people ticked in the invitations list, each as their own email starting "Dear <given name>," (so nobody sees
anyone else's address), through Resend. Only admins can use it, and it only sends to addresses on the invitations
list. **Send a test to me** sends one copy, marked [Test], to the admin who is sending.

### Deploying

It uses the same secrets as `approve-join-request` (`RESEND_API_KEY`, and optionally `EMAIL_FROM` and `SITE_URL`),
so if that one works, only the function itself is needed:

1. In Supabase → **Edge Functions → Deploy a new function → Via Editor**: name it `send-email`, replace the example
   code with the contents of `send-email/index.ts`, and **Deploy**:

   ```bash
   pbcopy < supabase/functions/send-email/index.ts
   ```

2. If you turned off **Enforce JWT verification** for `approve-join-request`, turn it off for this one too (its
   **Details** tab). That's safe for the same reason: it checks that the caller is an admin with their own sign-in.
3. Try it: tick yourself in the invitations list, **Email selected**, write something and **Send a test to me**.

**Unsubscribing.** Every email it sends ends with an unsubscribe link (and carries a List-Unsubscribe header, so
mail programs can show their own Unsubscribe button). The link holds the person's random unsubscribe code from the
`email_preferences` table, never their address, and opens `unsubscribe.html`, which shows where they stand: one
click unsubscribes them, or resubscribes them if they already have, without signing in. So the link in any old email
works both ways, even for people who never created an account. People can also turn these emails off or on in their Profile. The function skips anyone who has
unsubscribed and reports how many. This needs migration `20261011000000_email_unsubscribe.sql`; until it has been
run, emails go out without the link.

Resend's free plan sends up to 100 emails a day (3,000 a month); a bigger send needs a paid plan.
