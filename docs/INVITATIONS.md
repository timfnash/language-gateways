# Inviting people

People join in one of two ways:

- **Invitation:** you add their email (one at a time or by CSV). They can sign up straight away, and their
  profile is filled in from the invitation.
- **Join link:** each cohort has a link the church can send to its own members, so the church doesn't have
  to share anyone's details with us. People enter their own details and, if the cohort needs approval
  (the default), wait until an admin or one of that church's church admins approves them. Until then
  they see a "waiting for approval" message and no course content.

Everything below is on the site's **Admin** page (menu → Admin), which only admins can open.
**Never commit attendee lists to this repo** (it's public). If you keep a CSV, keep it in `Sessions/`.

## Churches and cohorts

**Churches & cohorts** tab. Add a church, then a cohort (one run of the course) for it. The ID is
suggested from the name; a cohort's ID is what goes in the CSV's `cohort` column.

Each cohort has a **sharing** setting: **All participants** (the default), **Its church** or **Its cohort**. It
decides who outside the cohort can see its songs, table discussions and prayers, and caps how far its members can
share their notes. (What was said is only ever shown to the cohort itself.) Admins and that church's church admins can change it.

Each cohort has a **join link**: **Copy link** to send it to the church; **New link** replaces it (the old
one stops working); untick **Needs approval** to let people from that link straight in.

## Songs

**Songs** tab: choose a cohort and a part, then add, edit, reorder (↑ ↓) or delete its songs: the title as sung, an
English title, the language, a YouTube link and, optionally, the story behind it. Changes show straight away on
that part's Read tab. A cohort with no songs of its own for a part sees the **Standard** songs, which admins edit by
choosing "Standard" as the cohort. Church admins can edit their own church's cohorts.

## Requests to join

**Requests to join** tab: **Approve** lets them in and adds them to the invitations list; **Decline**
deletes the account they created. Church admins see only their own church's requests.

A request marked **Email not confirmed yet** is from someone who hasn't clicked the link in their
confirmation email. They can't sign in until they do, even once approved; the sign-in page offers to
send the email again. If it stays unconfirmed, they may have mistyped their address.

## Inviting

**Invitations** tab:

- **Invite one person:** email and cohort; names and languages are optional.
- **Paste a CSV:** first row `email,cohort,given_name,family_name,mother_tongue,other_languages`.
  Only `email` and `cohort` are needed; the church comes from the cohort. Emails can be in any case.
  People already invited are skipped, and any row with an unknown cohort is listed so you can fix it.

The list below shows everyone invited; a tick means they've joined, and an envelope means they've
signed up but haven't confirmed their email address yet. Filter it by church, cohort,
status (all invitees, joined, not yet joined), or a name or email.

## Removing someone

The **trash icon** on their row in the invitations list:

- **Not joined yet:** removes the invitation.
- **Joined:** permanently deletes their account, profile, notes and progress, and their invitation.
  They can't sign in again unless you invite them again. This can't be undone.

Admins can't be removed this way (their trash icon is greyed out): remove their admin rights first.

## Admins and church admins

The **shield icon** on a row shows and changes someone's role. Each click moves to the next:
**no admin rights** (outline) → **church admin** (purple) → **admin** (gold) → no admin rights.

- **Admins** can do everything: approve shared notes and see who wrote them, and manage churches, cohorts,
  join links, invitations, requests and people.
- **Church admins** can approve or decline requests to join their church, see its people (read-only), edit its
  cohorts' songs, set their sharing, and approve its members' notes for all participants (without seeing who wrote
  them).

You can't change your own role; another admin has to do it. There's always at least one admin.
