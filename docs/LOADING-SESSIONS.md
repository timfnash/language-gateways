# Loading a session onto the site

Session content is never committed to this repo. It lives in the `Sessions/` folder inside the project,
which git ignores, and is loaded into Supabase, where only invited people can see it.
That folder isn't backed up by GitHub, so make sure your Mac's own backup covers it.

## One-off setup

1. **Database.** In Supabase, **SQL Editor → New query**: paste
   `supabase/migrations/20261001000000_sessions.sql` and run it. This adds the course, session, segment,
   contribution and progress tables, and the private `course-media` bucket for slides.
2. **Secret key.** In **Project Settings → API Keys**, create or copy a **secret** key (`sb_secret_…`).
   Put it in a file called `.env` at the top of this repo (it's ignored by git):

   ```
   SUPABASE_URL=https://qlfzuimffvvpzraeebjp.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_…
   ```

   This key can read and change everything, so keep it out of the site, the repo and chat.

## The session folder

```
Sessions/2026-09-29-freedom-church-jersey-S1/
  slides/        slide-01.jpg, slide-02.jpg, … (every visible slide, in order)
  content/
    session.json         the session, its segments, video times and which slides each uses
    fid-1-1.md …         one write-up per segment (Markdown)
    contributions/       table write-ups and prayers; these belong to the cohort named in session.json
    what-people-said.md  kept for the welcome page
```

In a write-up, `![caption](slide:3)` shows that segment's third slide, `![caption](youtube:VIDEO-ID)` embeds a
YouTube video (the ID is the part after `v=` in its link), and `<!-- contributions -->` marks where the table
write-ups (or prayers) appear. Edit the Markdown files freely and reload.

Segments can be split, added or reordered: change `session.json` (each segment's `position`, slides and video
times) and reload. Keep existing segments' `id`s, because people's progress and notes are stored against them;
give new segments new ids.

## Loading

Check the folder first (nothing is sent anywhere):

```bash
python3 pipeline/load_session.py Sessions/2026-09-29-freedom-church-jersey-S1 --check
```

Load it. A new session starts as a **draft** that only admins can see, so you can check it on the site first;
reloading a session that's already published keeps it published:

```bash
python3 pipeline/load_session.py Sessions/2026-09-29-freedom-church-jersey-S1
```

When you're happy, **publish** it to members:

```bash
python3 pipeline/load_session.py Sessions/2026-09-29-freedom-church-jersey-S1 --publish
```

Reloading is safe: it updates the segments, replaces that cohort's table write-ups, and overwrites the slides.
People's progress is kept.

## Sharing a table write-up with other churches

Table write-ups and prayers are visible only to the cohort they came from. To share one with every church,
set its `shared_with` to `everyone` in **Table Editor → contributions**.
