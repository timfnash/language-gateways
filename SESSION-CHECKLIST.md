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
   - transcribe the tables and front audio
   - remove hallucinated repetition
   - tidy the front talk and place the slides
   - summarise each table's discussions, collect the prayers, pick quotes
   - write up what was said with this cohort, and its songs (Tim sends me the YouTube links in the order sung; the
     loader checks them), tables and prayers, in
     `Sessions/fid-<n>/cohorts/<cohort-id>/` (see `docs/LOADING-SESSIONS.md`)
4. Review the draft: quotes, spellings of non-English words, and that nobody but Tim is identifiable
5. Load it as a draft, check it on the site as an admin, then publish it to the cohort (`docs/LOADING-SESSIONS.md`)
6. Choose any quotes or takeaways to share across all churches
7. Keep the raw recordings in Drive or on your Mac. **Never commit them to the repo.**
