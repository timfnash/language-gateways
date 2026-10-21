# Session checklist

## Before
- [ ] Get the attendee list (church, cohort, email; names and languages optional) and import it into `invitations`
- [ ] Tell attendees the tables will be recorded, and how anonymised content will be used and shared
- [ ] Label each recorder with its table number, then put one on each table
- [ ] Set the recorders to their longest file length if possible
- [ ] Check the front mic and video camera
- [ ] Finalise the slides (the songs part uses the generic SONGS slide, `Sessions/shared/slide-songs.jpg`)
- [ ] Export the slides to PDF

## During
- [ ] Start all recorders before the welcome
- [ ] Note the clock time at each section change: Welcome · Songs · Teaching · Discussion 1 · Teaching · Discussion 2 · Prayer · Blessing
- [ ] Stop all recorders at the blessing

## After
1. Make a folder `Sessions/<YYYY-MM-DD>-<church>-S<n>/` in this project (git ignores `Sessions/`) with:
   - `tables/T1/`, `tables/T2/`, … (each recorder's files). Alternatively, put all the files straight into
     `tables/` and list in `notes.txt` which recorder was on which table
   - `front/` (front audio, videos, any transcript)
   - `slides/`: each visible slide as a JPEG named `slide-01.jpg`, `slide-02.jpg`, … From Google Slides:
     File → Download → JPEG for each slide (or PowerPoint → Export → JPEG), then rename. Also keep the .pptx for the song links
   - `notes.txt` (the section times you noted)
2. Upload the video to YouTube (unlisted) and add its link to `notes.txt`
3. In a new Claude Code session in this project: **"Process session Sessions/<folder> following SESSION-CHECKLIST.md"**
   - transcribe the tables and front audio (Whisper can't read `.m4a`: convert it first with macOS's
     `afconvert -f WAVE -d LEI16@16000 -c 1 in.m4a out.wav`; render slides from the PDF with PyMuPDF at 2000 px wide
     if there are no JPEG exports)
   - remove hallucinated repetition
   - tidy the front talk and place the slides
   - summarise each table's discussions, collect the prayers, pick quotes
   - write up what was said with this cohort, and its songs (Tim sends me the YouTube links in the order sung; the
     loader checks them), tables and prayers, in
     `Sessions/fid-<n>/cohorts/<cohort-id>/` (see `docs/LOADING-SESSIONS.md`)
   - Part boundaries: if the YouTube video is the same length as the front audio (Session Three), it is
     unedited and the audio's times are the video's times; if the table discussions were cut out, ask Tim to paste
     YouTube's transcript with times. Check the boundaries on the Watch tab
   - Leave out of the written record anything personal that isn't course content (for example a prayer about someone's
     health) and tell Tim it is still in the video
   - A table whose recording is too faint to transcribe gets no write-up: say so rather than guessing
   - Table discussions and prayers go by theme, not table, and appear in the record where they happened
   - If the video is edited after the session (Session Four), load a draft first with the audio's times as
     placeholders and the YouTube ID set, then reload with the edited video's part times (Tim pastes YouTube's
     transcript with times, or gives the start of each part) before publishing
   - If songs weren't played (Session Four: no internet), still list them in `songs.csv` and say in each story
     that they weren't played on the night; the loader checks the links
   - The Whisper transcripts mishear names and non-English words (Swahili, Hebrew, Greek): check spellings with
     Tim, and leave out personal prayers, welcomes and life stories that aren't course content
   - The Full Record .docx is built with python-docx from the loaded session folder, in the brand style: Jost,
     purple `#510074` / `#3A0054` headings, gold `#8C6F1E` / `#C3A14E` rules and quote bars, 5.83 in slide images
4. Review the draft: quotes, spellings of non-English words, and that nobody but Tim is identifiable
5. Load it as a draft, check it on the site as an admin, then publish it to the cohort (`docs/LOADING-SESSIONS.md`)
6. Choose any quotes or takeaways to share across all churches
7. Keep the raw recordings in Drive or on your Mac. **Never commit them to the repo.**
