# Language Gateways: Flourishing in Diversity (FiD) course

Tim F Nash (tim@zipf.me) runs *Flourishing in Diversity*, a five-session course on how a church's
linguistic diversity helps it flourish. It was first run at Freedom Church Jersey, starting 29 Sept 2026.
This repo holds (1) the invitation-only course website and (2) the pipeline that turns each session's
recordings into course content.

See `ROADMAP.md` for what to build and in what order, and `SESSION-CHECKLIST.md` for running and processing a session.

## Repo layout

- `site/`: the static course site (plain HTML + ES modules, supabase-js from jsDelivr), deployed to
  GitHub Pages by `.github/workflows/pages.yml`. Supabase URL and anon key go in `site/assets/config.js`.
  Run locally with `python3 -m http.server 8000 --directory site`.
- `supabase/migrations/`: the database schema, RLS and invitation-only signup (hook + auth.users trigger).
  `supabase/seed.sql` holds the first church, cohort and admin. No Supabase CLI or Docker on this Mac:
  migrations are pasted into the SQL editor.
- `supabase/email-templates/`: branded HTML for Supabase's auth emails (pasted into the dashboard; see its README).
- `supabase/tests/`: PGlite tests for the schema and RLS (`npm install && npm test`). Add checks there
  whenever a table or policy changes.
- `docs/SETUP.md` (one-off account setup), `docs/INVITATIONS.md` (how Tim adds people) and
  `docs/LOADING-SESSIONS.md` (loading and publishing session content).
- `pipeline/`: the recording → content pipeline; `load_session.py` loads a session folder into Supabase.

## Architecture decisions (agreed)

- **Front end:** static site on GitHub Pages at `fid.languagegateways.com`
  (`fid` = Flourishing in Diversity; future courses get their own subdomains). The public landing page
  (Book us / Recommend us) can live at `languagegateways.com`.
- **Backend:** Supabase for auth (email + password, and Google sign-in), Postgres, storage, and Edge Functions
  (for Claude API calls such as the précis and takeaway summaries).
- **The repo and the Pages site are public. Never commit gated content:** no transcripts, table write-ups,
  attendee data or raw recordings. Gated content lives in Supabase behind row-level security (RLS).
- **Access is by invitation or join link.** The `invitations` table holds church*, cohort*, email*, given_name,
  family_name, mother_tongue, other_languages (* = required). Signup is rejected unless the email is
  invited or the signup carries a cohort's join code; enforced in Supabase (auth hook and trigger), not only in the UI.
  Churches won't share members' details, so each cohort has a join link; joiners get a 'pending' profile and
  see nothing until an admin or a church admin approves them (approval adds them to `invitations`).
  Roles: admins (`admins`) and church admins (`church_admins`, one church each). Managed on the Admin page.
- **Profile (for now):** given name, family name, mother tongue, other languages. Pre-filled from the
  invitation. Leave out sensitive fields (denomination, years as a Christian) until consent and privacy are designed.
- **Shared vs per-cohort:** the teaching is shared by everyone (one standard video per session, slides, and a
  standard transcript shown under the video on the Watch tab). Each cohort's session material is its own: what was
  actually said (from audio recordings), songs (title, language, link, story), table write-ups and prayers, shown
  on the Read tab. Talks are only ever shown to the cohort itself; songs, table write-ups and prayers (and notes) can
  be read across cohorts (My cohort default / My church / All participants). Songs are edited on the Admin page by cohort and
  session, and go on the session's songs part (the first part with "song" in its title)
  (admins: any cohort and the standard songs; church admins: their church's cohorts); a cohort with none of its
  own for a part sees the standard songs. The loader only touches songs with `--songs`.
- **Visibility:** notes are visible to everyone (default), my church, my cohort or only me, always without names.
  Each cohort has a sharing limit (everyone by default; admins or its church admins can narrow it to its church or
  cohort) that applies to its songs, table write-ups and prayers and caps its members' notes. Notes for everyone need approval
  (by an admin, or a church admin for their church) before other churches see them.
- **Anonymity:** in published content, everyone except Tim F Nash is anonymous. Tables are numbered, not named.
  It's fine to say that Session One was held at Freedom Church Jersey with members of that congregation.
- **Content model:** Course → Session → Segment (text, slide images, YouTube start/end, audio).
  Church → Cohort (one run of the course). Contributions (table write-ups, comments, notes) belong to a segment and a cohort.
- Session One video: https://youtu.be/Dhws-HMCMzs

## Session One source material (on Tim's Mac, NOT in the repo)

- `~/Desktop/Session One/`: `Session One - Transcript` (front talk), `Session One - PowerPoint.pptx`
  (song links on slide 9; slides 36–46 are hidden), `Session One - Slides.pdf` (28 pages = the visible
  slides, with the giraffe build collapsed), `Session One - Table Discussions.txt`, `Session One - Audio.m4a`,
  `Wide Angle.mp4`, `Small Group.mp4`
- `~/Desktop/Session One/Table discussions/`: 17 WAVs from 5 table recorders plus Whisper `.txt` transcripts.
  The recorders split files every 20 min. Recorder → table mapping, by file start time:
  T1 193757+195816, T2 193925+195940, T3 194021+200034, T4 194118+200128, T5 194314+200336.
  Files after 20:18 are post-session chatter.
- The finished write-up (tidied talk + slides + table write-ups + prayers + quotes) is a Claude doc:
  https://claude.ai/code/artifact/3ab702dc-ca71-40f6-a249-5c010512c848 (export → Word/Markdown).
  Anonymised write-up: https://claude.ai/code/artifact/3c710251-6a0f-4ce4-be10-f66388a4eb03

## Pipeline notes (learned on Session One)

- Transcription: `mlx-whisper` with `mlx-community/whisper-large-v3-turbo` on Apple Silicon, installed in a venv.
  There's no ffmpeg or Homebrew on this Mac: the recorders produce 16 kHz stereo WAV, so load it with Python's
  `wave` module, average to mono and pass a numpy array (see `pipeline/transcribe.py`).
- Use `word_timestamps=True, hallucination_silence_threshold=2.0, no_speech_threshold=0.5,
  condition_on_previous_text=False` and drop consecutive duplicate lines. Without these, quiet stretches
  produce invented repeated phrases ("And the light", "It's at the end").
- Every table recorder also picks up the front speaker, so the talk and the room feedback appear in all of
  them. Attribute room feedback to the table whose own discussion matches it.
- Slides: use Tim's own JPEG export of each slide (2000 px wide, every build step included; Session One had 35
  visible slides). Rendering the PDF with PyMuPDF also works (the Egyptian hieroglyph shows as a missing-glyph box);
  Keynote's export of the .pptx substitutes fonts and breaks the layout, so don't use it.
- Never change an existing segment's id (progress and notes hang off it); new segments get new ids, and
  `position` sets the order. Session One's songs and series-outline parts are `fid-1-7` and `fid-1-8` for this reason.
- The session video is edited: the table discussions are cut out, so segments can run end to end. Tim can paste
  YouTube's transcript (with times) to set the segment boundaries.
- Content lives in `Sessions/fid-<n>/` in this repo (git-ignored: never commit it): shared parts, slides and
  transcripts at the top, each cohort's talk, songs.csv, tables and prayers under `cohorts/<cohort-id>/`.
  Loaded with `pipeline/load_session.py`; see `docs/LOADING-SESSIONS.md`. In a segment's Markdown,
  `![caption](slide:N)` places the segment's Nth slide, `![caption](youtube:ID)` embeds a video, and `<!-- contributions -->` marks where the table
  write-ups or prayers go.
- The Session One Full Record Claude doc stores its slide images as artifact assets; they can be downloaded one at
  a time with the Artifact tool's read action and an asset id.
- Swahili song on slide 9: the correct title is "Sifu Bwana Moyo Wangu" (confirmed by Tim). The Session One slide image still reads "Wwana".
- Style: British English. Lightly tidy speech (remove ums, false starts and repetition) without changing meaning.
