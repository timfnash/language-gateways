"""Load a session into Supabase: the shared teaching, and each cohort's session material.

    python3 pipeline/load_session.py Sessions/fid-1 --check      # validate only, no network
    python3 pipeline/load_session.py Sessions/fid-1              # load (a new session stays a draft for admins)
    python3 pipeline/load_session.py Sessions/fid-1 --publish    # load and publish to members
    python3 pipeline/load_session.py Sessions/fid-1 --cohort freedom-church-jersey-2026-09
                                                                 # load just that cohort's material
    python3 pipeline/load_session.py Sessions/fid-1 --songs      # also (re)load songs from the songs.csv files

Songs are normally edited on the Admin page, so a reload leaves them alone; --songs replaces the songs of each
loaded cohort (and the standard songs) with the contents of the songs.csv files.

Folder layout (see docs/LOADING-SESSIONS.md):

    session.json                 the session and its parts: titles, slides, video times, transcript files
    songs.csv                    standard songs (segment,title,translation,language,url,story), used by any
                                 cohort that has no songs of its own for that part
    slides/                      slide-01.jpg …
    transcripts/<part>.md        the standard transcript of each part (Watch tab)
    cohorts/<cohort-id>/         one folder per cohort that has had this session (Read tab):
      talk/<part>.md             what was said with this cohort
      songs.csv                  segment,title,translation,language,url,story
      tables/<part>-<n>.md       table write-ups ("Table n")
      prayers/<part>-<n>.md      prayers ("Table n")

Re-running is safe: parts are upserted, each loaded cohort's material for this session is replaced, and
slides are overwritten. People's progress and notes are kept.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (Project Settings → API Keys → secret key) in the
environment or in a .env file at the repo root. The secret key bypasses row-level security:
never commit it or put it in the site.
"""
import argparse, csv, json, os, re, ssl, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUCKET = 'course-media'

# python.org's Python doesn't use the macOS certificate store; fall back to the system bundle.
SSL = ssl.create_default_context(cafile='/etc/ssl/cert.pem' if Path('/etc/ssl/cert.pem').exists() else None)


def load_env():
    env = dict(os.environ)
    dotenv = REPO / '.env'
    if dotenv.exists():
        for line in dotenv.read_text().splitlines():
            m = re.match(r'\s*([A-Z_]+)\s*=\s*(.*?)\s*$', line)
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip('\'"')
    return env


YOUTUBE = re.compile(r'(?:youtube\.com/watch\?(?:.*&)?v=|youtu\.be/|youtube\.com/embed/)([A-Za-z0-9_-]{6,20})')


def check_markdown(where, text, slides, problems):
    for vid in re.findall(r'\]\(youtube:([^)]*)\)', text):
        if not re.fullmatch(r'[A-Za-z0-9_-]{6,20}', vid):
            problems.append(f"{where}: youtube:{vid} doesn't look like a YouTube video ID")
    for n in re.findall(r'\]\(slide:(\d+)\)', text):
        if not 1 <= int(n) <= slides:
            problems.append(f"{where}: slide:{n} but the part has {slides} slides")
    for marker in ('<!-- contributions -->', '<!-- songs -->'):
        if text.count(marker) > 1:
            problems.append(f"{where}: more than one {marker} marker")


def read_songs(path, parts, problems):
    """songs.csv rows → {part id: [{title, translation, language, url, story}, …]}."""
    songs = {}
    with open(path, newline='') as fh:
        for n, row in enumerate(csv.DictReader(fh), 2):
            row = {k: (v or '').strip() for k, v in row.items() if k}
            if row.get('segment') not in parts:
                problems.append(f"{path} row {n}: unknown part {row.get('segment')!r}"); continue
            if not YOUTUBE.search(row.get('url', '')):
                problems.append(f"{path} row {n}: {row.get('url')!r} isn't a YouTube link"); continue
            if not row.get('title'):
                problems.append(f"{path} row {n}: the song needs a title"); continue
            songs.setdefault(row['segment'], []).append({k: row.get(k) or None for k in ('title', 'translation', 'language', 'url')}
                                                          | {'story': row.get('story', '')})
    return songs


def read_folder(folder):
    manifest = json.loads((folder / 'session.json').read_text())
    problems = []
    parts = {seg['id']: seg for seg in manifest['segments']}
    for seg in manifest['segments']:
        seg['transcript_text'] = (folder / seg['transcript']).read_text()
        for name in seg['slides']:
            if not (folder / 'slides' / name).exists():
                problems.append(f"{seg['id']}: missing slides/{name}")
        check_markdown(seg['transcript'], seg['transcript_text'], len(seg['slides']), problems)

    # Standard songs, shown to cohorts that have none of their own for a part.
    standard = read_songs(folder / 'songs.csv', parts, problems) if (folder / 'songs.csv').exists() else {}
    for seg in manifest['segments']:
        seg['songs'] = standard.get(seg['id'], [])

    cohorts = {}
    for cdir in sorted((folder / 'cohorts').glob('*/')) if (folder / 'cohorts').exists() else []:
        items = []
        for f in sorted((cdir / 'talk').glob('*.md')) if (cdir / 'talk').exists() else []:
            if f.stem not in parts:
                problems.append(f"{f}: no part called {f.stem}"); continue
            text = f.read_text()
            check_markdown(str(f.relative_to(folder)), text, len(parts[f.stem]['slides']), problems)
            items.append({'segment': f.stem, 'kind': 'talk', 'position': 1, 'title': 'What was said', 'body': text})
        for kind, sub in (('table', 'tables'), ('prayers', 'prayers')):
            for f in sorted((cdir / sub).glob('*.md')) if (cdir / sub).exists() else []:
                m = re.fullmatch(r'(.+)-(\d+)', f.stem)
                if not m or m.group(1) not in parts:
                    problems.append(f"{f}: name it <part>-<table number>.md, e.g. fid-1-3-1.md"); continue
                items.append({'segment': m.group(1), 'kind': kind, 'position': int(m.group(2)),
                              'title': f'Table {m.group(2)}', 'body': f.read_text()})
        if (cdir / 'songs.csv').exists():
            for part, songs in read_songs(cdir / 'songs.csv', parts, problems).items():
                for n, song in enumerate(songs, 1):
                    items.append({'segment': part, 'kind': 'song', 'position': n, 'title': song['title'],
                                  'body': song['story'], 'url': song['url'], 'language': song['language'],
                                  'translation': song['translation']})
        cohorts[cdir.name] = items
    return manifest, cohorts, problems


class Supabase:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip('/'), key

    def request(self, method, path, body=None, headers=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        h = {'apikey': self.key, 'Content-Type': 'application/json'}  # new-style keys go in apikey only
        h.update(headers or {})
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, context=SSL) as r:
                text = r.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            sys.exit(f'{method} {path} failed: {e.code} {e.read().decode()}')

    def upsert(self, table, rows):
        return self.request('POST', f'/rest/v1/{table}', rows,
                            {'Prefer': 'resolution=merge-duplicates,return=minimal'})

    def upload(self, path, file):
        self.request('POST', f'/storage/v1/object/{BUCKET}/{path}', raw=file.read_bytes(),
                     headers={'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': '3600'})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder', type=Path)
    ap.add_argument('--check', action='store_true', help='validate the folder without loading anything')
    ap.add_argument('--publish', action='store_true', help='make the session visible to members')
    ap.add_argument('--cohort', help="load only this cohort's material (not the shared parts)")
    ap.add_argument('--songs', action='store_true', help='also replace songs with the songs.csv files (overwrites Admin edits)')
    args = ap.parse_args()

    folder = args.folder.expanduser()
    manifest, cohorts, problems = read_folder(folder)
    session = manifest['session']
    if args.cohort and args.cohort not in cohorts:
        problems.append(f"no folder cohorts/{args.cohort}")
    for seg in manifest['segments']:
        print(f"{seg['position']}. {seg['id']}  {seg['title']}: {len(seg['slides'])} slides, "
              f"{len(seg['transcript_text'].split())}-word transcript"
              + (f", {len(seg['songs'])} standard songs" if seg['songs'] else ''))
    for cohort, items in cohorts.items():
        counts = {k: sum(1 for i in items if i['kind'] == k) for k in ('talk', 'song', 'table', 'prayers')}
        print(f"cohort {cohort}: {counts['talk']} talks, {counts['song']} songs, {counts['table']} table write-ups, "
              f"{counts['prayers']} prayers")
    if problems:
        sys.exit('Problems:\n  ' + '\n  '.join(problems))
    if args.check:
        print('OK: nothing loaded (--check).')
        return

    env = load_env()
    if not env.get('SUPABASE_URL') or not env.get('SUPABASE_SECRET_KEY'):
        sys.exit('Set SUPABASE_URL and SUPABASE_SECRET_KEY (in the environment or .env).')
    db = Supabase(env['SUPABASE_URL'], env['SUPABASE_SECRET_KEY'])

    slides = sorted({name for seg in manifest['segments'] for name in seg['slides']})
    if not args.cohort:
        for i, name in enumerate(slides, 1):
            db.upload(f"{session['id']}/{name}", folder / 'slides' / name)
            print(f'\rUploaded {i}/{len(slides)} slides', end='', flush=True)
        print()

        db.upsert('courses', [manifest['course']])
        row = {k: session[k] for k in ('id', 'course', 'number', 'title', 'summary', 'youtube_id')}
        if args.publish:
            row['published_at'] = datetime.now(timezone.utc).isoformat()
        db.upsert('sessions', [row])
        # Positions are unique within a session, so reordering is done in two passes: first move every
        # segment to a temporary position (1000+), then set the real ones.
        rows = [{
            'id': seg['id'], 'session': session['id'], 'position': seg['position'], 'title': seg['title'],
            'summary': seg['summary'], 'transcript': seg['transcript_text'], 'body': seg['transcript_text'],
            **({'songs': seg['songs']} if args.songs else {}),
            'slides': [f"{session['id']}/{name}" for name in seg['slides']],
            'youtube_start': seg['youtube_start'], 'youtube_end': seg['youtube_end'],
        } for seg in manifest['segments']]
        db.upsert('segments', [{**r, 'position': 1000 + r['position']} for r in rows])
        db.upsert('segments', rows)

    ids = ','.join(seg['id'] for seg in manifest['segments'])
    loaded = 0
    for cohort, items in cohorts.items():
        if args.cohort and cohort != args.cohort:
            continue
        # Songs are edited on the Admin page; only --songs replaces them.
        kinds = 'talk,song,table,prayers' if args.songs else 'talk,table,prayers'
        db.request('DELETE', f"/rest/v1/contributions?cohort=eq.{cohort}&segment=in.({ids})&kind=in.({kinds})")
        rows = [{'cohort': cohort, 'url': None, 'language': None, 'translation': None, **i}
                for i in items if args.songs or i['kind'] != 'song']
        if rows:
            db.request('POST', '/rest/v1/contributions', rows, {'Prefer': 'return=minimal'})
        loaded += len(rows)

    if args.publish:
        state = 'published'
    else:
        published = db.request('GET', f"/rest/v1/sessions?id=eq.{session['id']}&select=published_at")[0]['published_at']
        state = 'updated (still published)' if published else 'loaded as a draft (only admins can see it; re-run with --publish)'
    what = f"{len(manifest['segments'])} parts, {len(slides)} slides, " if not args.cohort else ''
    print(f"Session {session['number']} {state}: {what}{loaded} items of session material"
          + (", songs replaced from songs.csv." if args.songs else " (songs left as they are; use --songs to load them)."))


if __name__ == '__main__':
    main()
