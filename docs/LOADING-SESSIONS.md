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
  session.json                     the session and its parts: titles, summaries, themes, slides, video times
  slides/                          slide-01.jpg, slide-02.jpg, … (the shared slides, in order)
  transcripts/fid-1-1.md …         the standard transcript of each part, shown under the video (Watch tab)
  perspectives.csv                 words seen through other languages in the teaching (Words page)
  cohorts/freedom-church-jersey-2026-09/
    talk/fid-1-1.md …              what was said with this cohort (Read tab)
    songs.csv                      segment,title,translation,language,url,story (in the order sung)
    tables/fid-1-3.md …            what the tables said, one file per part, under "## <theme>" headings
    prayers/fid-1-6.md             the tables' prayers, the same way
    perspectives.csv               words seen through other languages in this cohort's discussions (Words page)
    by-table/                      the original per-table write-ups (kept for reference; not loaded)
    what-people-said.md            kept for the welcome page
```

- In a transcript or talk, `![caption](slide:3)` shows that part's third slide.
- **Extra videos** (3rd-party clips and the like) are written `![caption](youtube:VIDEO-ID)` (the ID is the part
  after `v=` in its link). The rule: **extra video is embedded on the Watch tab, under the part's own video**
  (under "More to watch"), **and is just a link in the text** (the transcript and the Read tab). Put the marker in
  the standard transcript for a clip everyone sees, or in a cohort's talk for one only that cohort sees.
- In a talk, `<!-- songs -->` marks where the cohort's songs go and `<!-- contributions -->` where its table
  write-ups and prayers go; without the markers they follow the talk.
- **Songs.** A cohort's songs go in its `songs.csv`, one row per song in the order sung: the part (`segment`, the
  session's songs part, e.g. `fid-1-7`), the title as sung, an English title, the language, the YouTube link and the
  story (what was said about it, taken from the recording). There are no standard songs: a cohort with no songs for
  a part has none, like any other part with nothing of its own. The same generic **SONGS** slide
  (`Sessions/shared/slide-songs.jpg`) is used for every session's songs part.
- **Where songs show.** Each song's title, English title, language and video are on the **Watch** tab, below the
  intro video and its transcript button. On the **Read** tab they are a bulleted list with what was said about each
  (no videos), at the `<!-- songs -->` marker in the talk.
- **Links are checked.** Every load looks each YouTube link up and prints the video's YouTube title next to your
  song, so a wrong link is obvious. It stops if a video doesn't exist or can't be embedded. To check without
  loading: `python3 pipeline/load_session.py Sessions/fid-1 --check --check-links`.
- **Table discussions and prayers are organised by theme, not by table.** Each discussion or prayer part lists its
  themes in `session.json` (`"themes": ["…", "…"]`, in order): short summary points such as "Languages and culture
  give us the ability to see God from so many different angles". A cohort's `tables/<part>.md` (or
  `prayers/<part>.md`) puts each point under the `## ` heading of its theme, using the theme's exact wording; the
  loader stops if a heading isn't in the part's list. Every cohort uses the same list, so their points line up: when a
  new cohort raises something new, add a theme to the list. Text before the first heading is shown without a theme.
- The Read tab shows a person their own cohort's talk, songs, table discussions and prayers. Other cohorts' **songs,
  table discussions and prayers** can be seen too, under "From other groups" (My cohort / My church / All
  participants), within each cohort's **sharing** setting on the Admin page. Songs are listed by group; table
  discussions and prayers by theme, each theme folding open to show what every group said about it.
- **Words (perspectives).** `perspectives.csv` has one row per word seen through a language:
  `segment,concept,language,term,romanisation,insight`. `concept` is the English word being looked at (e.g. `sin`;
  rows with the same concept, in any case, are grouped), `term` is the word in that language (in its own script),
  `romanisation` is optional (pronunciation or romanisation, e.g. `tsumi`), and `insight` is what the language
  shows us (Markdown). The session's own file holds the teaching's; each cohort's holds what came up in its
  discussions. The **Words** page lists every word with more than one perspective, across sessions and cohorts.
  A cohort's words follow its sharing setting; the teaching's are seen by everyone.
- **Songs** from every session are also listed on the **Songs** page (filter by church, cohort and language; sort by
  session or English title).

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

Reloading is safe: it updates the parts, replaces each loaded cohort's talks, songs, table write-ups, prayers and
words for the session (and the teaching's words), and overwrites the slides. People's progress and notes are
kept.
