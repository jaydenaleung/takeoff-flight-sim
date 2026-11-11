#!/usr/bin/env python3
"""Deploy a built site to Firebase Hosting with the REST API (no firebase-tools needed).

    npm run build
    FIREBASE_ACCESS_TOKEN=$(gcloud auth print-access-token) python3 tools/deploy_rest.py dist

The token is a Google OAuth access token for an account that may deploy to the project. When a
network proxy injects the credential, FIREBASE_ACCESS_TOKEN can be left unset.
"""
import gzip
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

SITE = os.environ.get('FIREBASE_SITE', 'takeoff-flight-sim')
API = 'https://firebasehosting.googleapis.com/v1beta1'
TOKEN = os.environ.get('FIREBASE_ACCESS_TOKEN', 'supplied-by-proxy')


def call(method, url, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    ctype = 'application/octet-stream' if raw is not None else 'application/json'
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': ctype})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            text = r.read()
            return json.loads(text) if text and raw is None else {}
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {url.split("?")[0]} failed: HTTP {e.code}\n{e.read().decode()[:800]}')


def main():
    dist = sys.argv[1] if len(sys.argv) > 1 else 'dist'
    here = os.path.dirname(os.path.abspath(__file__))
    files, blobs = {}, {}
    for root, _, names in os.walk(dist):
        for n in names:
            path = os.path.join(root, n)
            rel = '/' + os.path.relpath(path, dist).replace(os.sep, '/')
            with open(path, 'rb') as f:
                gz = gzip.compress(f.read(), 9, mtime=0)
            digest = hashlib.sha256(gz).hexdigest()
            files[rel] = digest
            blobs[digest] = gz
    with open(os.path.join(here, '..', 'firebase.json'), encoding='utf-8') as f:
        cfg = json.load(f)['hosting']
    headers = [{'glob': h['source'], 'headers': {x['key']: x['value'] for x in h['headers']}}
               for h in cfg.get('headers', [])]
    version = call('POST', f'{API}/sites/{SITE}/versions', {'config': {'headers': headers}})
    name = version['name']
    print('version', name, '-', len(files), 'files')
    pop = call('POST', f'{API}/{name}:populateFiles', {'files': files})
    need = pop.get('uploadRequiredHashes', [])
    for i, digest in enumerate(need, 1):
        call('POST', f"{pop['uploadUrl']}/{digest}", raw=blobs[digest])
        print(f'  uploaded {i}/{len(need)}')
    call('PATCH', f'{API}/{name}?update_mask=status', {'status': 'FINALIZED'})
    release = call('POST', f'{API}/sites/{SITE}/releases?versionName={name}', {})
    print('released', release.get('name', ''))
    print(f'https://{SITE}.web.app')


if __name__ == '__main__':
    main()
