"""Load a session into Supabase: the shared teaching, and each cohort's session material.

    python3 pipeline/load_session.py Sessions/fid-1 --check      # validate only, no network
    python3 pipeline/load_session.py Sessions/fid-1              # load (a new session stays a draft for admins)
    python3 pipeline/load_session.py Sessions/fid-1 --publish    # load and publish to members
    python3 pipeline/load_session.py Sessions/fid-1 --cohort freedom-church-jersey-2026-09
                                                                 # load just that cohort's material
    python3 pipeline/load_session.py Sessions/fid-1 --check-links   # also check each song's YouTube link (needs internet)

Every load checks every video's YouTube link first (songs, and any ![caption](youtube:ID) in a transcript or talk),
and stops if one is wrong, printing each video's YouTube title
so you can see it's the right one.

Folder layout (see docs/LOADING-SESSIONS.md):

    session.json                 the session and its parts: titles, slides, video times, transcript files, themes
    slides/                      slide-01.jpg …
    transcripts/<part>.md        the standard transcript of each part (Watch tab)
    perspectives.csv             words seen through other languages, from the teaching (Words page)
    cohorts/<cohort-id>/         one folder per cohort that has had this session (Read tab):
      talk/<part>.md             what was said with this cohort
      songs.csv                  segment,title,translation,language,url,story (in the order sung)
      tables/<part>.md           what the tables said, under "## <theme>" headings from the part's themes
      prayers/<part>.md          the tables' prayers, the same way
      perspectives.csv           segment,concept,language,term,romanisation,insight (Words page)

Re-running is safe: parts are upserted, each loaded cohort's material and words for this session are replaced, and
slides are overwritten. People's progress and notes are kept.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (Project Settings → API Keys → secret key) in the
environment or in a .env file at the repo root. The secret key bypasses row-level security:
never commit it or put it in the site.
"""
import argparse, csv, json, os, re, ssl, sys, urllib.error, urllib.parse, urllib.request
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


def youtube_id(url):
    m = YOUTUBE.search(url or '')
    return m.group(1) if m else None


OEMBED_PROBLEMS = {
    400: "YouTube doesn't recognise this as a video",
    401: "the owner doesn't allow it to be embedded, so it won't play on the site",
    403: "the video is private or restricted",
    404: "the video wasn't found (removed or private)",
}


def collect_videos(manifest, cohorts):
    """Every video that will be shown: songs, and ![caption](youtube:ID) in transcripts and talks."""
    found = []
    for seg in manifest['segments']:
        for cap, vid in re.findall(r'!\[([^\]]*)\]\(youtube:([^)]*)\)', seg['transcript_text']):
            found.append((f"{seg['id']} transcript: {cap.strip() or vid}", vid, f'https://www.youtube.com/watch?v={vid}'))
    for cohort, items in cohorts.items():
        for item in items:
            if item['kind'] == 'song':
                found.append((item['title'], youtube_id(item['url']), item['url']))
            for cap, vid in re.findall(r'!\[([^\]]*)\]\(youtube:([^)]*)\)', item['body']) if item['kind'] == 'talk' else []:
                found.append((f"{item['segment']} talk: {cap.strip() or vid}", vid, f'https://www.youtube.com/watch?v={vid}'))
    return found


def verify_links(videos):
    """Look each video up on YouTube. Prints its YouTube title; returns (problems, couldn't-check count)."""
    problems, unchecked, cache = [], 0, {}
    for label, vid, url in videos:
        if vid not in cache:
            link = urllib.parse.quote(f'https://www.youtube.com/watch?v={vid}', safe='')
            req = urllib.request.Request(f'https://www.youtube.com/oembed?url={link}&format=json')
            try:
                with urllib.request.urlopen(req, context=SSL, timeout=15) as r:
                    cache[vid] = ('ok', json.loads(r.read().decode()))
            except urllib.error.HTTPError as e:
                cache[vid] = ('bad', OEMBED_PROBLEMS.get(e.code, f'YouTube answered {e.code}'))
            except Exception as e:
                cache[vid] = ('offline', str(e))
        kind, info = cache[vid]
        if kind == 'ok':
            print(f"  {label}  →  YouTube: \"{info.get('title')}\" ({info.get('author_name')})  ✓ plays on this site")
        elif kind == 'bad':
            print(f"  {label}  →  ✗ {info}")
            problems.append(f"{label}: {url}: {info}")
        else:
            print(f"  {label}  →  (couldn't reach YouTube to check: {info})")
            unchecked += 1
    return problems, unchecked


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


def read_sections(where, text, themes, problems):
    """A table write-up or prayers file → [(theme or None, Markdown)], split at its "## " headings. Every heading
    must be one of the part's "themes" in session.json, so each cohort's points line up under the same headings."""
    sections, theme, lines = [], None, []

    def flush():
        body = '\n'.join(lines).strip()
        if body:
            sections.append((theme, body))
    for line in text.splitlines():
        m = re.match(r'##\s+(.+?)\s*$', line)
        if m:
            flush()
            theme, lines = m.group(1), []
            if theme not in themes:
                problems.append(f"{where}: the heading {theme!r} isn't one of this part's \"themes\" in session.json")
        else:
            lines.append(line)
    flush()
    return sections


def read_perspectives(path, parts, problems):
    """perspectives.csv rows → [{segment, position, concept, language, term, romanisation, insight}, …]."""
    rows = []
    with open(path, newline='') as fh:
        for n, row in enumerate(csv.DictReader(fh), 2):
            row = {k: (v or '').strip() for k, v in row.items() if k}
            if row.get('segment') not in parts:
                problems.append(f"{path} row {n}: unknown part {row.get('segment')!r}"); continue
            missing = [k for k in ('concept', 'language', 'term') if not row.get(k)]
            if missing:
                problems.append(f"{path} row {n}: needs {', '.join(missing)}"); continue
            rows.append({'segment': row['segment'], 'position': n - 1, 'concept': row['concept'],
                         'language': row['language'], 'term': row['term'],
                         'romanisation': row.get('romanisation') or None, 'insight': row.get('insight', '')})
    return rows


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

    if (folder / 'songs.csv').exists():
        problems.append("songs.csv at the top of the session folder is no longer used (there are no standard songs): "
                        "put each cohort's songs in cohorts/<cohort-id>/songs.csv")

    # Words seen through other languages: None holds the teaching's, then one list per cohort.
    perspectives = {None: read_perspectives(folder / 'perspectives.csv', parts, problems)
                    if (folder / 'perspectives.csv').exists() else []}
    cohorts = {}
    for cdir in sorted((folder / 'cohorts').glob('*/')) if (folder / 'cohorts').exists() else []:
        items = []
        for f in sorted((cdir / 'talk').glob('*.md')) if (cdir / 'talk').exists() else []:
            if f.stem not in parts:
                problems.append(f"{f}: no part called {f.stem}"); continue
            text = f.read_text()
            check_markdown(str(f.relative_to(folder)), text, len(parts[f.stem]['slides']), problems)
            items.append({'segment': f.stem, 'kind': 'talk', 'position': 1, 'title': 'What was said', 'body': text})
        # One file per part, organised by theme (not by table): each "## " section is stored with its theme as
        # its title, and the theme's place in the part's list as its position.
        for kind, sub in (('table', 'tables'), ('prayers', 'prayers')):
            for f in sorted((cdir / sub).glob('*.md')) if (cdir / sub).exists() else []:
                if f.stem not in parts:
                    problems.append(f"{f}: name it after its part, e.g. {sub}/fid-1-3.md (one file per part, "
                                    f"with \"## <theme>\" headings; files per table are no longer used)"); continue
                themes = parts[f.stem].get('themes', [])
                for theme, body in read_sections(str(f.relative_to(folder)), f.read_text(), themes, problems):
                    items.append({'segment': f.stem, 'kind': kind,
                                  'position': themes.index(theme) + 1 if theme in themes else 0,
                                  'title': theme or '', 'body': body})
        if (cdir / 'songs.csv').exists():
            for part, songs in read_songs(cdir / 'songs.csv', parts, problems).items():
                for n, song in enumerate(songs, 1):
                    items.append({'segment': part, 'kind': 'song', 'position': n, 'title': song['title'],
                                  'body': song['story'], 'url': song['url'], 'language': song['language'],
                                  'translation': song['translation']})
        cohorts[cdir.name] = items
        if (cdir / 'perspectives.csv').exists():
            perspectives[cdir.name] = read_perspectives(cdir / 'perspectives.csv', parts, problems)
    return manifest, cohorts, perspectives, problems


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
    ap.add_argument('--check-links', action='store_true', help="with --check: also look up each video's YouTube link")
    args = ap.parse_args()

    folder = args.folder.expanduser()
    manifest, cohorts, perspectives, problems = read_folder(folder)
    session = manifest['session']
    if args.cohort and args.cohort not in cohorts:
        problems.append(f"no folder cohorts/{args.cohort}")
    for seg in manifest['segments']:
        print(f"{seg['position']}. {seg['id']}  {seg['title']}: {len(seg['slides'])} slides, "
              f"{len(seg['transcript_text'].split())}-word transcript")
    for cohort, items in cohorts.items():
        counts = {k: sum(1 for i in items if i['kind'] == k) for k in ('talk', 'song', 'table', 'prayers')}
        print(f"cohort {cohort}: {counts['talk']} talks, {counts['song']} songs, {counts['table']} table themes, "
              f"{counts['prayers']} prayer themes, {len(perspectives.get(cohort, []))} words")
    print(f"teaching: {len(perspectives[None])} words")
    if problems:
        sys.exit('Problems:\n  ' + '\n  '.join(problems))
    if not args.check or args.check_links:
        videos = collect_videos(manifest, cohorts)
        if videos:
            print('Checking video links on YouTube:')
            bad, unchecked = verify_links(videos)
            if bad:
                sys.exit('Problems with video links:\n  ' + '\n  '.join(bad))
            if unchecked:
                print(f"  ({unchecked} link(s) couldn't be checked: no connection to YouTube. Carrying on.)")
    if args.check:
        print('OK: nothing loaded (--check).')
        return

    env = load_env()
    if not env.get('SUPABASE_URL') or not env.get('SUPABASE_SECRET_KEY'):
        sys.exit('Set SUPABASE_URL and SUPABASE_SECRET_KEY (in the environment or .env).')
    db = Supabase(env['SUPABASE_URL'], env['SUPABASE_SECRET_KEY'])
    # Check the database is up to date before changing anything (the newest table the loader writes to).
    try:
        urllib.request.urlopen(urllib.request.Request(f"{db.url}/rest/v1/perspectives?select=id&limit=1",
                                                      headers={'apikey': db.key}), context=SSL)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit('The database has no perspectives table yet: run '
                     'supabase/migrations/20261010000000_move_people_songs_and_words.sql in the Supabase SQL editor first.')
        raise

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
            'slides': [f"{session['id']}/{name}" for name in seg['slides']],
            'youtube_start': seg['youtube_start'], 'youtube_end': seg['youtube_end'],
        } for seg in manifest['segments']]
        db.upsert('segments', [{**r, 'position': 1000 + r['position']} for r in rows])
        db.upsert('segments', rows)

    ids = ','.join(seg['id'] for seg in manifest['segments'])
    loaded = 0
    if not args.cohort:
        db.request('DELETE', f"/rest/v1/perspectives?cohort=is.null&segment=in.({ids})")
        if perspectives[None]:
            db.request('POST', '/rest/v1/perspectives', [{'cohort': None, **p} for p in perspectives[None]],
                       {'Prefer': 'return=minimal'})
    for cohort, items in cohorts.items():
        if args.cohort and cohort != args.cohort:
            continue
        db.request('DELETE', f"/rest/v1/contributions?cohort=eq.{cohort}&segment=in.({ids})")
        rows = [{'cohort': cohort, 'url': None, 'language': None, 'translation': None, **i} for i in items]
        if rows:
            db.request('POST', '/rest/v1/contributions', rows, {'Prefer': 'return=minimal'})
        loaded += len(rows)
        db.request('DELETE', f"/rest/v1/perspectives?cohort=eq.{cohort}&segment=in.({ids})")
        if perspectives.get(cohort):
            db.request('POST', '/rest/v1/perspectives', [{'cohort': cohort, **p} for p in perspectives[cohort]],
                       {'Prefer': 'return=minimal'})

    if args.publish:
        state = 'published'
    else:
        published = db.request('GET', f"/rest/v1/sessions?id=eq.{session['id']}&select=published_at")[0]['published_at']
        state = 'updated (still published)' if published else 'loaded as a draft (only admins can see it; re-run with --publish)'
    what = f"{len(manifest['segments'])} parts, {len(slides)} slides, " if not args.cohort else ''
    print(f"Session {session['number']} {state}: {what}{loaded} items of session material.")


if __name__ == '__main__':
    main()
