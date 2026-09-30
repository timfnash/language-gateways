# Session checklist

## Before
- [ ] Get the attendee list (church, cohort, email; names and languages optional) and import it into `invitations`
- [ ] Tell attendees the tables will be recorded, and how anonymised content will be used and shared
- [ ] Label each recorder with its table number, then put one on each table
- [ ] Set the recorders to their longest file length if possible
- [ ] Check the front mic and video camera
- [ ] Finalise the slides; song links go in the PowerPoint as hyperlinks
- [ ] Export the slides to PDF

## During
- [ ] Start all recorders before the welcome
- [ ] Note the clock time at each section change: Welcome · Songs · Teaching · Discussion 1 · Teaching · Discussion 2 · Prayer · Blessing
- [ ] Stop all recorders at the blessing

## After
1. Make a folder `~/Sessions/<YYYY-MM-DD>-<church>-S<n>/` with:
   - `tables/T1/`, `tables/T2/`, … (each recorder's files)
   - `front/` (front audio, videos, any transcript)
   - `slides/` (.pptx and .pdf)
   - `notes.txt` (the section times you noted)
2. Upload the video to YouTube (unlisted) and add its link to `notes.txt`
3. In Claude Code, in this project: **"Process session ~/Sessions/<folder>"**
   - transcribe the tables and front audio
   - remove hallucinated repetition
   - tidy the front talk, place the slides and add the song links
   - summarise each table's discussions, collect the prayers, pick quotes
   - draft the segments with YouTube start and end times
4. Review the draft: quotes, spellings of non-English words, and that nobody but Tim is identifiable
5. Approve it and publish to the cohort
6. Choose any quotes or takeaways to share across all churches
7. Keep the raw recordings in Drive or on your Mac. **Never commit them to the repo.**
