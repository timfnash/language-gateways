# Inviting people

Only people with an invitation can create an account. When they sign up, their profile is filled in
from their invitation, and they can correct it on first sign-in.

Everything below is on the site's **Admin** page (menu → Admin), which only admins can open.
**Never commit attendee lists to this repo** (it's public). If you keep a CSV, keep it in `Sessions/`.

## Churches and cohorts

**Churches & cohorts** tab. Add a church, then a cohort (one run of the course) for it. The ID is
suggested from the name; a cohort's ID is what goes in the CSV's `cohort` column.

## Inviting

**Invitations** tab:

- **Invite one person:** email and cohort; names and languages are optional.
- **Paste a CSV:** first row `email,cohort,given_name,family_name,mother_tongue,other_languages`.
  Only `email` and `cohort` are needed; the church comes from the cohort. Emails can be in any case.
  People already invited are skipped, and any row with an unknown cohort is listed so you can fix it.

The list below shows everyone invited; a tick means they've joined. Filter it by church, cohort,
status (all invitees, joined, not yet joined), or a name or email.

## Removing someone

The **trash icon** on their row in the invitations list:

- **Not joined yet:** removes the invitation.
- **Joined:** permanently deletes their account, profile, notes and progress, and their invitation.
  They can't sign in again unless you invite them again. This can't be undone.

Admins can't be removed this way (their trash icon is greyed out): remove their admin rights first.

## Admins

Admins can approve shared notes, see who wrote them, and manage churches, cohorts, invitations and people.
The **shield icon** on a row shows who's an admin (filled) and switches admin rights on or off. You can't
remove your own admin rights; another admin has to do it.
