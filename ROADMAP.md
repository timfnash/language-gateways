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
Built and tested; loading and publishing Session One is in `docs/LOADING-SESSIONS.md`.

- [x] Tables: `sessions`, `segments` (text, slides, youtube_start/end), with content in Supabase and not the repo
- [x] Segment views: **Read** (write-up plus slides), **Watch** (YouTube embed limited to the segment), **Slides** (carousel)
- [x] `progress` table: user × segment × mode (read / watch / slides / listen), with timestamps
- [x] Dashboard: "continue where you left off" and completion ticks
- [x] Table write-ups and prayers stored per cohort (`contributions`), so other churches don't see them unless shared
- [ ] Load and publish Session One (6 segments: Welcome and worship, Creation and language, Discussion 1, Salvation, Discussion 2, Prayer and blessing)

## Phase 2: Personal notes
- [ ] Notes per segment, with the prompt "What has struck you here?"
- [ ] Voice notes: record in the browser, transcribe, edit, then save

## Phase 3: Community
- [ ] Comments and suggestions per segment: private / my church / everyone, with an anonymous toggle
- [ ] Filter: show mine / my church's / all
- [ ] Admin approval queue for cross-church visibility; admin page for invitations (single + paste CSV)

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
