#!/usr/bin/env python3
import argparse
import fcntl
import json
import mimetypes
import os
import sys
import time
from pathlib import Path
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

SCOPE='https://www.googleapis.com/auth/androidpublisher'
API='https://androidpublisher.googleapis.com/androidpublisher/v3'
UPLOAD='https://androidpublisher.googleapis.com/upload/androidpublisher/v3'
DEFAULT_PACKAGE='fr.petitannonces.petitannoncesapp'
DEFAULT_KEY='/var/www/petitannonces/shared/android-firebase/fcm-service-account.json'
DEFAULT_AAB='/var/www/petitannonces/repository/apps/mobile/dist-android-production/petitannonces-production.aab'
LOCK_FILE='/tmp/petitannonces-google-play-publisher.lock'

def fail(message, code=1):
    print(f'[play-publisher] ERROR: {message}', file=sys.stderr)
    raise SystemExit(code)

def err_message(resp):
    try:
        data=resp.json()
        return str(data.get('error',{}).get('message') or data)[:600]
    except Exception:
        return resp.text[:600]

def session_for(key: Path):
    if not key.is_file(): fail(f'service account key not found: {key}')
    creds=service_account.Credentials.from_service_account_file(str(key),scopes=[SCOPE])
    return AuthorizedSession(creds)

def insert_edit(sess, package):
    transient={429,500,502,503,504}
    last=None
    for attempt in range(4):
        r=sess.post(f'{API}/applications/{package}/edits',json={})
        last=r
        if r.status_code in (200,201):
            eid=r.json().get('id')
            if not eid: fail('Play edit id missing')
            return eid
        if r.status_code not in transient or attempt==3:
            break
        time.sleep((2,5,10)[attempt])
    fail(f'cannot create Play edit ({last.status_code}): {err_message(last)}')

def delete_edit(sess, package, edit_id):
    sess.delete(f'{API}/applications/{package}/edits/{edit_id}')

def check(sess, package):
    edit_id=insert_edit(sess,package)
    delete_edit(sess,package,edit_id)
    print(f'[play-publisher] access OK for {package}')

def status(sess, package, track):
    edit_id=insert_edit(sess,package)
    try:
        r=sess.get(f'{API}/applications/{package}/edits/{edit_id}/tracks/{track}')
        if r.status_code!=200: fail(f'cannot read track ({r.status_code}): {err_message(r)}')
        releases=r.json().get('releases',[])
        if not releases:
            print(f'[play-publisher] track={track} has no releases'); return
        for release in releases:
            versions=','.join(str(v) for v in release.get('versionCodes',[]))
            print(f"[play-publisher] track={track} status={release.get('status','')} versionCodes={versions} name={release.get('name','')}")
    finally:
        delete_edit(sess,package,edit_id)

def store_status(sess, package, language):
    edit_id=insert_edit(sess,package)
    try:
        r=sess.get(f'{API}/applications/{package}/edits/{edit_id}/listings')
        if r.status_code!=200: fail(f'cannot read store listings ({r.status_code}): {err_message(r)}')
        locales=sorted(x.get('language','') for x in r.json().get('listings',[]) if x.get('language'))
        print(f"[play-publisher] store locales={','.join(locales)}")
        for image_type in ('icon','phoneScreenshots','sevenInchScreenshots','tenInchScreenshots'):
            ir=sess.get(f'{API}/applications/{package}/edits/{edit_id}/listings/{language}/{image_type}')
            if ir.status_code!=200: fail(f'cannot read {image_type} ({ir.status_code}): {err_message(ir)}')
            print(f"[play-publisher] language={language} {image_type}={len(ir.json().get('images',[]))}")
    finally:
        delete_edit(sess,package,edit_id)

def bundle_status(sess, package):
    edit_id=insert_edit(sess,package)
    try:
        r=sess.get(f'{API}/applications/{package}/edits/{edit_id}/bundles')
        if r.status_code!=200: fail(f'cannot read bundles ({r.status_code}): {err_message(r)}')
        bundles=r.json().get('bundles',[])
        versions=','.join(str(x.get('versionCode')) for x in bundles if x.get('versionCode') is not None)
        print(f'[play-publisher] bundles={versions}')
    finally:
        delete_edit(sess,package,edit_id)

def upload(sess, package, edit_id, aab: Path):
    if not aab.is_file(): fail(f'AAB not found: {aab}')
    with aab.open('rb') as fh:
        r=sess.post(
            f'{UPLOAD}/applications/{package}/edits/{edit_id}/bundles?uploadType=media',
            data=fh,
            headers={'Content-Type':'application/octet-stream'},
            timeout=900,
        )
    if r.status_code not in (200,201): fail(f'AAB upload failed ({r.status_code}): {err_message(r)}')
    vc=r.json().get('versionCode')
    if not vc: fail('Google Play did not return versionCode')
    return str(vc)

def set_track(sess, package, edit_id, track, version_code, release_name, release_notes='', release_notes_language='fr-FR'):
    release={'versionCodes':[version_code],'status':'completed','name':release_name}
    if release_notes.strip():
        release['releaseNotes']=[{'language':release_notes_language,'text':release_notes.strip()[:500]}]
    body={'releases':[release]}
    r=sess.put(f'{API}/applications/{package}/edits/{edit_id}/tracks/{track}',json=body)
    if r.status_code not in (200,201): fail(f'track update failed ({r.status_code}): {err_message(r)}')

def replace_images(sess, package, edit_id, language, image_type, files):
    r=sess.delete(f'{API}/applications/{package}/edits/{edit_id}/listings/{language}/{image_type}')
    if r.status_code not in (200,204):
        fail(f'cannot clear {image_type} ({r.status_code}): {err_message(r)}')
    for path in files:
        content_type=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        with path.open('rb') as fh:
            r=sess.post(
                f'{UPLOAD}/applications/{package}/edits/{edit_id}/listings/{language}/{image_type}?uploadType=media',
                data=fh,
                headers={'Content-Type':content_type},
                timeout=180,
            )
        if r.status_code not in (200,201):
            fail(f'{image_type} upload failed for {path.name} ({r.status_code}): {err_message(r)}')

def update_store_assets(sess, package, edit_id, language, directory: Path):
    if not directory.is_dir(): fail(f'store assets directory not found: {directory}')
    icon=directory/'icon.png'
    groups=[
        ('phoneScreenshots','phone-*.jpg','phone-*.png'),
        ('sevenInchScreenshots','tablet7-*.jpg','tablet7-*.png'),
        ('tenInchScreenshots','tablet10-*.jpg','tablet10-*.png'),
    ]
    if not icon.is_file(): fail(f'Play Store icon missing: {icon}')
    replace_images(sess,package,edit_id,language,'icon',[icon])
    counts={}
    for image_type,jpg_glob,png_glob in groups:
        files=sorted(directory.glob(jpg_glob))+sorted(directory.glob(png_glob))
        if not files:
            continue
        if len(files)>8: fail(f'Google Play accepts at most 8 images for {image_type}')
        replace_images(sess,package,edit_id,language,image_type,files)
        counts[image_type]=len(files)
    if not counts.get('phoneScreenshots'): fail(f'Play Store phone screenshots missing in: {directory}')
    print(f'[play-publisher] store assets updated language={language} icon=1 '+', '.join(f'{k}={v}' for k,v in counts.items()))

def commit(sess, package, edit_id):
    r=sess.post(f'{API}/applications/{package}/edits/{edit_id}:commit',json={})
    if r.status_code not in (200,201): fail(f'edit commit failed ({r.status_code}): {err_message(r)}')

def main():
    lock=open(LOCK_FILE,'a+')
    fcntl.flock(lock.fileno(),fcntl.LOCK_EX)
    ap=argparse.ArgumentParser(description='Petit Annonces direct Google Play publisher')
    ap.add_argument('action', choices=['check','status','store-status','bundle-status','promote','upload'])
    ap.add_argument('--package', default=os.getenv('PA_ANDROID_PACKAGE', DEFAULT_PACKAGE))
    ap.add_argument('--key', default=os.getenv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', DEFAULT_KEY))
    ap.add_argument('--aab', default=os.getenv('PA_ANDROID_AAB', DEFAULT_AAB))
    ap.add_argument('--track', default=os.getenv('PA_PLAY_TRACK','internal'))
    ap.add_argument('--release-name', default=os.getenv('PA_PLAY_RELEASE_NAME','Petit Annonces internal'))
    ap.add_argument('--release-notes', default=os.getenv('PA_PLAY_RELEASE_NOTES',''))
    ap.add_argument('--release-notes-language', default=os.getenv('PA_PLAY_RELEASE_NOTES_LANGUAGE','fr-FR'))
    ap.add_argument('--store-assets-dir', default=os.getenv('PA_PLAY_STORE_ASSETS_DIR',''))
    ap.add_argument('--language', default=os.getenv('PA_PLAY_STORE_LANGUAGE','fr-FR'))
    ap.add_argument('--version-code', default=os.getenv('PA_PLAY_VERSION_CODE',''))
    args=ap.parse_args()
    if args.track not in {'internal','alpha','beta','production'}:
        fail(f'unsupported track: {args.track}')
    sess=session_for(Path(args.key))
    if args.action=='check':
        check(sess,args.package); return
    if args.action=='status':
        status(sess,args.package,args.track); return
    if args.action=='store-status':
        store_status(sess,args.package,args.language); return
    if args.action=='bundle-status':
        bundle_status(sess,args.package); return
    if args.track!='internal' and os.getenv('PA_ALLOW_NON_INTERNAL_PLAY_UPLOAD')!='true':
        fail('non-internal upload blocked; set PA_ALLOW_NON_INTERNAL_PLAY_UPLOAD=true explicitly')
    edit_id=insert_edit(sess,args.package)
    committed=False
    try:
        if args.action=='promote':
            if not args.version_code: fail('--version-code is required for promote')
            vc=str(args.version_code)
        else:
            vc=upload(sess,args.package,edit_id,Path(args.aab))
        if args.store_assets_dir:
            update_store_assets(sess,args.package,edit_id,args.language,Path(args.store_assets_dir))
        set_track(sess,args.package,edit_id,args.track,vc,args.release_name,args.release_notes,args.release_notes_language)
        commit(sess,args.package,edit_id)
        committed=True
        verb='promoted' if args.action=='promote' else 'uploaded'
        print(f'[play-publisher] {verb} versionCode={vc} to track={args.track}')
    finally:
        if not committed:
            delete_edit(sess,args.package,edit_id)

if __name__=='__main__': main()
