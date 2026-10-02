"""Load a session's content folder into Supabase.

    python3 pipeline/load_session.py ~/Sessions/<folder> --check     # validate only, no network
    python3 pipeline/load_session.py ~/Sessions/<folder>             # load as a draft (admins only)
    python3 pipeline/load_session.py ~/Sessions/<folder> --publish   # load and publish to members

The folder holds slides/ (slide-01.jpg …) and content/ with session.json, one Markdown file per
segment and contributions/*.md (table write-ups and prayers, which belong to the cohort in
session.json). Re-running is safe: rows are upserted, the cohort's contributions for these
segments are replaced, and slides are overwritten.

Needs SUPABASE_URL and SUPABASE_SECRET_KEY (Project Settings → API Keys → secret key) in the
environment or in a .env file at the repo root. The secret key bypasses row-level security:
never commit it or put it in the site.
"""
import argparse, json, os, re, ssl, sys, urllib.error, urllib.request
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


def read_folder(folder):
    content = folder / 'content'
    manifest = json.loads((content / 'session.json').read_text())
    problems = []
    for seg in manifest['segments']:
        seg['body_text'] = (content / seg['body']).read_text()
        for name in seg['slides']:
            if not (folder / 'slides' / name).exists():
                problems.append(f"{seg['id']}: missing slides/{name}")
        for n in re.findall(r'\]\(slide:(\d+)\)', seg['body_text']):
            if not 1 <= int(n) <= len(seg['slides']):
                problems.append(f"{seg['id']}: slide:{n} but the segment has {len(seg['slides'])} slides")
        for c in seg['contributions']:
            c['body_text'] = (content / c['body']).read_text()
        if seg['body_text'].count('<!-- contributions -->') > 1:
            problems.append(f"{seg['id']}: more than one <!-- contributions --> marker")
    return manifest, problems


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
    args = ap.parse_args()

    folder = args.folder.expanduser()
    manifest, problems = read_folder(folder)
    session = manifest['session']
    for seg in manifest['segments']:
        print(f"{seg['id']}  {seg['title']}: {len(seg['slides'])} slides, "
              f"{len(seg['contributions'])} contributions, {len(seg['body_text'].split())} words")
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
    for i, name in enumerate(slides, 1):
        db.upload(f"{session['id']}/{name}", folder / 'slides' / name)
        print(f'\rUploaded {i}/{len(slides)} slides', end='', flush=True)
    print()

    db.upsert('courses', [manifest['course']])
    row = {k: session[k] for k in ('id', 'course', 'number', 'title', 'summary', 'youtube_id')}
    if args.publish:
        row['published_at'] = datetime.now(timezone.utc).isoformat()
    db.upsert('sessions', [row])
    db.upsert('segments', [{
        'id': seg['id'], 'session': session['id'], 'position': seg['position'], 'title': seg['title'],
        'summary': seg['summary'], 'body': seg['body_text'],
        'slides': [f"{session['id']}/{name}" for name in seg['slides']],
        'youtube_start': seg['youtube_start'], 'youtube_end': seg['youtube_end'],
    } for seg in manifest['segments']])

    ids = ','.join(seg['id'] for seg in manifest['segments'])
    db.request('DELETE', f"/rest/v1/contributions?cohort=eq.{manifest['cohort']}&segment=in.({ids})")
    rows = [{'segment': seg['id'], 'cohort': manifest['cohort'], 'kind': c['kind'], 'position': c['position'],
             'title': c['title'], 'body': c['body_text']}
            for seg in manifest['segments'] for c in seg['contributions']]
    if rows:
        db.request('POST', '/rest/v1/contributions', rows, {'Prefer': 'return=minimal'})

    state = 'published' if args.publish else 'loaded as a draft (only admins can see it; re-run with --publish)'
    print(f"Session {session['number']} {state}: {len(manifest['segments'])} segments, "
          f"{len(slides)} slides, {len(rows)} contributions.")


if __name__ == '__main__':
    main()
