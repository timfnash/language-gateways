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

Each session has one folder. Material shared by everyone sits at the top; each cohort that has had the
session has its own folder under `cohorts/`.

```
Sessions/fid-1/
  session.json                     the session and its parts: titles, summaries, slides, video times
  songs.csv                        standard songs, shown to any cohort with no songs of its own for that part
  slides/                          slide-01.jpg, slide-02.jpg, … (the shared slides, in order)
  transcripts/fid-1-1.md …         the standard transcript of each part, shown under the video (Watch tab)
  cohorts/freedom-church-jersey-2026-09/
    talk/fid-1-1.md …              what was said with this cohort (Read tab)
    songs.csv                      segment,title,translation,language,url,story
    tables/fid-1-3-1.md …          table write-ups: <part>-<table number>.md, shown as "Table 1" …
    prayers/fid-1-6-1.md …         prayers, named the same way
    what-people-said.md            kept for the welcome page
```

- In a transcript or talk, `![caption](slide:3)` shows that part's third slide and `![caption](youtube:VIDEO-ID)`
  embeds a YouTube video (the ID is the part after `v=` in its link).
- In a talk, `<!-- songs -->` marks where the cohort's songs go and `<!-- contributions -->` where its table
  write-ups and prayers go; without the markers they follow the talk.
- **Songs** come from `songs.csv`, one row per song: the part (`segment`), the title as sung, an English
  translation of the title, the language, the YouTube link and, optionally, the story behind it. Each shows as a
  linked title with the video embedded beneath it. A cohort with no songs of its own for a part sees the
  **standard** songs from the session's top-level `songs.csv`.
- The Read tab only ever shows a person their own cohort's talk and songs. Other cohorts' **table discussions and
  prayers** can be read too, under "Table discussions in other groups" (My cohort / My church / All participants),
  within each cohort's **sharing** setting on the Admin page.

Parts can be split, added or reordered: change `session.json` (each part's `position`, slides and video times)
and reload. Keep existing parts' `id`s, because people's progress and notes are stored against them; give new
parts new ids.

## Loading

Check the folder first (nothing is sent anywhere):

```bash
python3 pipeline/load_session.py Sessions/fid-1 --check
```

Load it. A new session starts as a **draft** that only admins can see, so you can check it on the site first;
reloading a session that's already published keeps it published:

```bash
python3 pipeline/load_session.py Sessions/fid-1
```

When you're happy, **publish** it to members:

```bash
python3 pipeline/load_session.py Sessions/fid-1 --publish
```

To load just one cohort's material (say, after a new cohort has had the session):

```bash
python3 pipeline/load_session.py Sessions/fid-1 --cohort individuals-october-2026
```

Reloading is safe: it updates the parts, replaces each loaded cohort's material for the session, and overwrites
the slides. People's progress and notes are kept.
