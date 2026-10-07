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
