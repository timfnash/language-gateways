# Roadmap

## Phase 0: Foundations
Done. Account setup steps are in `docs/SETUP.md`.

- [x] GitHub repo `language-gateways` with Pages enabled and the custom domain `fid.languagegateways.com` (DNS CNAME)
- [x] Supabase project; Google OAuth client; email + password auth
- [x] Tables: `churches`, `cohorts`, `invitations`, `profiles`, with RLS on every table
- [x] Signup allowed only for invited emails, enforced server-side
- [x] First login: profile pre-filled from the invitation (given name, family name, mother tongue, other languages)
- [x] Bulk invitations through Supabase CSV import (documented for Tim)

## Phase 1: Session One online
Done: Session One published 2 October 2026. Loading sessions is in `docs/LOADING-SESSIONS.md`.

- [x] Tables: `sessions`, `segments` (text, slides, youtube_start/end), with content in Supabase and not the repo
- [x] Segment views: **Read** (write-up plus slides), **Watch** (YouTube embed limited to the segment), **Slides** (carousel)
- [x] `progress` table: user × segment × mode (read / watch / slides / listen), with timestamps
- [x] Dashboard: "continue where you left off" and completion ticks
- [x] Table write-ups and prayers stored per cohort (`contributions`), so other churches don't see them unless shared
- [x] Load and publish Session One (6 segments: Welcome and worship, Creation and language, Discussion 1, Salvation, Discussion 2, Prayer and blessing)

## Phase 2: Personal notes
- [x] One private note per segment (visible only to its writer, not even admins), with the prompt
      "What has struck you here?"; saves as you type; "Note" shown against the part on the home page
- [ ] Voice notes: record in the browser, transcribe, edit, then save. Deferred (Tim, 2 Oct 2026): typed
      notes first. When picked up, the options were a transcription service (e.g. Whisper via an Edge
      Function, audio deleted after transcribing, privacy notice updated) or the browser's own dictation

## Phase 3: Community
Decided with Tim (2 Oct 2026): no separate comments; notes themselves are shared.
- [x] Each note's visibility: all participants (default) / my church / my cohort / only me
- [x] Shared notes always shown without name or church; only admins see the writer and their church
- [x] Filter notes from: all participants (default) / my church / my cohort / only me
- [x] "All participants" notes reach other churches only after admin approval; editing withdraws it
- [x] Admin page: shared-notes approval queue; invitations (add one, paste CSV, see who has joined,
      filter by church / cohort / status / search, remove people); add churches and cohorts
- [x] Shared teaching (standard video, slides, transcript on the Watch tab) vs per-cohort session material (what was
      said, songs, tables, prayers on the Read tab), with My cohort / My church / All participants views
- [x] Cohort sharing limits (admins and church admins), capping session material and notes; church admins approve notes
- [ ] Swap in the polished standard video and its transcript when ready; a generic "Sing" slide
- [x] Join links per cohort (churches needn't share members' details), with approval by admins or church admins;
      roles cycle none → church admin → admin

## Phase 4: Welcome page and outreach
- [ ] Welcome page with rotating approved quotes ("what people have said") and the key practical takeaways
- [ ] Book us / Recommend us (form → email to Tim)
- [ ] Share buttons (email, WhatsApp, socials) with #languagegateways #flourishingindiversity appended

## Phase 5: AI features (Claude API through a Supabase Edge Function)
- [ ] Précis of a segment plus the comments the user can see
- [ ] Personal takeaway summary from the user's own notes and progress

## Phase 6: Listen
- [ ] Text-to-speech audio per segment and per session; a private podcast feed; regenerated when approved comments change

## Phase 7: Scale
- [ ] Sessions 2–5 (Babel, Pentecost, Hebrew, Greek)
- [ ] More churches and cohorts; approved contributions feed the shared "standard" course
- [ ] Revisit sensitive profile fields (denomination, years as a Christian, location) with explicit consent and a privacy notice (UK GDPR / Data Protection (Jersey) Law 2018)
