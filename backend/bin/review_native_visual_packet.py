"""Local provenance for one selected job; no authority, extraction or SDK call.

The native observer report is text evidence, never transcript or model-seen pixels.
The existing authenticated worker/policy owns claim and completion authority.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import subprocess
import unicodedata
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[2]
TARGETS = {
    '252df2a1-7623-4725-93ad-f777db40209c': ('Ck5UrobZuKA','intro'),
    '218457d8-5f7c-4e4d-8dcf-fc986c0780b6': ('gV9QMjeRV8s','intro'),
    '5d14e8a2-2f12-47f8-80d9-94b4692168bc': ('DNGGl1-jFcU','cutlet-intro'),
    '769a87f9-efc3-4603-93be-7ae1bb4d8c10': ('DNGGl1-jFcU','chicken-overlay-refinement'),
    'a08b0767-c015-4d37-9fdf-b446eff82abc': ('jkDzCwDpfV8','cue-84-94'),
}
CORRECTIONS = {
    '769a87f9-efc3-4603-93be-7ae1bb4d8c10': ('치킨꼬꼬','신포동','7-40','5-10','우현로49번길','25'),
    'a08b0767-c015-4d37-9fdf-b446eff82abc': ('명동식당','경동','179-2','13-2','답동로30번길','25'),
}
CODE = ['backend/bin/review_native_visual_packet.py',
        'backend/bin/run_restaurant_evidence_recovery.py',
        'backend/bin/run_restaurant_review_automation.py',
        'backend/bin/review_rule_evaluation.py', 'backend/bin/review_decision_gemini.mjs',
        'backend/bin/review_recovery_privacy.mjs', 'apps/web/lib/privacy/sanitize.ts',
        'backend/restaurant-evaluation/scripts/10-rule-evaluation.py',
        'backend/restaurant-evaluation/prompts/evaluation_prompt.txt',
        'backend/utils/gemini-client.mjs', 'backend/package-lock.json']


def need(value):
    from backend.bin.run_restaurant_review_automation import WorkerFailure
    if not value: raise WorkerFailure('source_input_invalid')


def sha(raw): return hashlib.sha256(raw).hexdigest()


def digest(value):
    from backend.bin.run_restaurant_evidence_recovery import digest as canonical_digest
    return canonical_digest(value)


def private(path, directory=False):
    path = Path(path); info = path.lstat()
    need(path.is_absolute() and path.resolve() == path and info.st_uid == os.getuid()
         and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600)
         and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1))
    return path


def read(path, limit):
    path = private(path); need(path.stat().st_size <= limit)
    return path.read_bytes()


def custody(directory):
    return sha((socket.gethostname()+'\n'+str(os.getuid())+'\n'+str(directory)).encode())


def source_recipe():
    """Local protected-release checkout anchor; no GitHub/network/auth probe.

    Branch protection itself remains the existing release/operator boundary.
    A local origin/main ref is not a fresh hosted protection attestation.
    """
    def git(*args):
        p = subprocess.run(['git',*args],cwd=ROOT,stdout=subprocess.PIPE,
                           stderr=subprocess.DEVNULL,timeout=10,check=False)
        need(p.returncode == 0 and len(p.stdout) <= 65536)
        return p.stdout.decode().strip()
    head = git('rev-parse','HEAD')
    need(head == git('rev-parse','refs/remotes/origin/main')
         and git('status','--porcelain') == ''
         and git('remote','get-url','origin') == 'https://github.com/twoimo/tzudong.git')
    return {'mainSha':head,'treeSha':git('rev-parse','HEAD^{tree}'),
            'codeSha256':digest([sha((ROOT/p).read_bytes()) for p in CODE])}


def compact(text):
    need(isinstance(text,str) and 0 < len(text.strip()) <= 256)
    return ''.join(unicodedata.normalize('NFC',text).split())


def instant(value):
    result = datetime.fromisoformat(value); need(result.tzinfo is not None)
    return result


def correction_join(packet, public):
    """Two explicit, source-backed parcel corrections; no administrative alias."""
    intent = packet['correctionIntent']; rid = packet['restaurantId']; need(rid in CORRECTIONS)
    name,locality,parcel,old,road,number = CORRECTIONS[rid]
    rows = public.get('restaurants',[public]); rows = [r for r in rows if r.get('restaurantId') == rid]; need(len(rows) == 1)
    row = rows[0]; candidates = row['candidates']; need(len(candidates) == 1); candidate = candidates[0]
    need(public['provider'] == 'naver_local_search' and type(row['httpStatus']) is int and row['httpStatus'] == 200
         and row['state'] == 'public_place_candidates_observed' and type(row['queriesAttempted']) is int and row['queriesAttempted'] == 1)
    need(row.get('videoId',packet['videoId']) == packet['videoId']
         and compact(row['name']) == compact(candidate['name']) == compact(name) == compact(packet['observation']['signName'])
         and row['videoAddress'] == packet['observation']['addressOverlay'])
    for address,parts in [(row['videoAddress'],[locality,parcel]),(row['storedOriginAddress'],[locality,old]),
                          (candidate['parcelAddress'],[locality,parcel]),(candidate['roadAddress'],[road,number])]:
        words = unicodedata.normalize('NFC',address).split()
        need(words[0] in ('인천','인천광역시') and words[-2:] == parts)
    locator = urlsplit(row['apiSourceUrl']); query = parse_qs(locator.query)
    need(locator.scheme == 'https' and locator.netloc == 'openapi.naver.com' and locator.path == '/v1/search/local.json'
         and set(query) == {'query','display'} and query['query'] == [row['query']] and query['display'] == ['5']
         and name in row['query'] and candidate['apiSourceUrl'] == row['apiSourceUrl'])
    observed = instant(row['observedAt'])
    need(observed == instant(candidate['observedAt']) and instant(packet['observer']['observedAt']) <= observed <= datetime.now(timezone.utc))
    if 'videoObservationReceipt' in row:need(row['videoObservationReceipt']['sha256'] == packet['files']['receipt']['sha256'])
    need(intent == {'kind':'derive_fresh_location_preserve_origin','candidateSha256':digest(candidate),
                    'observedAddress':row['videoAddress'],'parcelAddress':candidate['parcelAddress'],'roadAddress':candidate['roadAddress']})
    return {'kind':'independent_public_place_receipt','originAddress':row['storedOriginAddress'],
            'observedAddress':row['videoAddress'],'providerParcelAddress':candidate['parcelAddress'],
            'providerRoadAddress':candidate['roadAddress'],'providerObservedAt':row['observedAt'],
            'apiSourceUrl':row['apiSourceUrl'],'candidateSha256':digest(candidate),
            'sourceOriginConflict':True,'administrativeEquivalenceClaimed':False,
            'joinScope':'literal_locality_parcel_and_provider_road','independentEvidenceFamiliesAdded':[]}


def check_source_privacy(observations, observer_id, title, transcript, node):
    """Screen every source value under the unchanged central per-value bounds.

    Pages preserve complete segment objects and strings. Nothing is truncated
    or split inside a value; an unsafe late page rejects the entire input.
    """
    from backend.bin.run_restaurant_evidence_recovery import privacy_check
    need(isinstance(transcript,list) and bool(transcript))
    privacy_check({'observations':observations,'observerId':observer_id,'title':title},node)
    for start in range(0,len(transcript),32):
        privacy_check({'transcript':transcript[start:start+32]},node)


def inspect_sources(packet, directory, *, cue_only=False, allow_conflict=False):
    """Validate local bytes and declared native observation, not job authority."""
    from backend.bin.run_restaurant_review_automation import review_target, validate_transcript, youtube_id
    files = packet['files']
    need(TARGETS.get(packet['restaurantId']) == (packet['videoId'],packet['sceneId']))
    need(set(files) == {'receipt','publisher','clip','frame'} | (set() if cue_only else {'transcript'}))
    limits = {'receipt':16384,'publisher':32768,'clip':16*1024*1024,'frame':2*1024*1024,'transcript':2*1024*1024}
    data = {}
    for kind, ref in files.items():
        need(isinstance(ref,dict) and set(ref) == {'path','sha256'})
        path = Path(ref['path']); need(path.parent == directory)
        raw = read(path,limits[kind]); need(sha(raw) == ref['sha256']); data[kind] = raw
    receipt = json.loads(data['receipt']); publisher = json.loads(data['publisher'])
    need(receipt['videoId'] == packet['videoId']); transcript_sha = receipt.get('transcriptSha256')
    if 'clips' in receipt:
        clips = receipt['clips']; selected = [c for c in clips if c['id'] == packet['sceneId']]; need(len(selected) == 1)
        selected = selected[0]
        if selected.get('parentClipSha256'):
            parents = [c for c in clips if c['clipSha256'] == selected['parentClipSha256']]; need(len(parents) == 1)
            selected = {**parents[0],**selected}
        need(selected['observedVideoId'] == packet['videoId'] and selected['observedChannelId'] == packet['publisherId'])
        receipt = {**selected,'videoId':receipt['videoId']}
    else:need(receipt['exit'] == 0 and packet['sceneId'] in ('intro','cue-84-94'))
    need(receipt['state'] == 'selected_cue_frames_inspected' and receipt['publisherBindingObserved'] is True
         and type(receipt['inspectedFrames']) is int and receipt['inspectedFrames'] > 0)
    matches = [r for r in publisher['items'] if r.get('videoId') == packet['videoId']]
    need(publisher['httpStatus'] == 200 and len(matches) == 1
         and matches[0]['channelMatchesConfiguredTzuyang'] is True
         and youtube_id(matches[0]['sourceUrl']) == packet['videoId']
         and packet['publisherId'] == review_target('tzuyang')['channel_id'])
    need(data['clip'][4:8] == b'ftyp' and receipt['clipSha256'] == files['clip']['sha256'])
    frame = data['frame']
    need(frame[:8] == b'\x89PNG\r\n\x1a\n' and frame[12:16] == b'IHDR' and len(frame) >= 33)
    width,height = struct.unpack('>II',frame[16:24]); need(16 <= width <= 1280 and 16 <= height <= 1280)
    observation = packet['observation']
    need(isinstance(observation,dict) and set(observation) == {'signName','branchQualifier','addressOverlay','sourceApproxSeconds'})
    source = receipt['observation']
    if not allow_conflict and (source.get('addressConflict') is True or source.get('publisherAddressMatchesHeldOriginal') is False):
        from backend.bin.run_restaurant_review_automation import WorkerFailure
        raise WorkerFailure('source_identity_mismatch')
    need(observation == {'signName':source.get('pixelName',source.get('pixelSignName')),'branchQualifier':source.get('pixelNameQualifier'),
                         'addressOverlay':source['publisherAddressOverlay'],'sourceApproxSeconds':source['sourceApproxSeconds']})
    seconds = observation['sourceApproxSeconds']
    need(type(seconds) in (int,float) and 0 <= seconds < 86400)
    frames = [f for f in receipt['frames'] if f.get('sourceSeconds',f.get('sourceApproxSeconds')) == seconds and f['sha256'] == files['frame']['sha256']]
    need(len(frames) == 1 and receipt['requestedRangeSeconds'][0] <= seconds <= receipt['requestedRangeSeconds'][1]
         and abs(seconds-receipt['requestedRangeSeconds'][0]-frames[0]['clipSeconds']) < 0.001)
    observer = packet['observer']
    need(isinstance(observer,dict) and set(observer) == {'id','method','observedAt','recordSha256'}
         and isinstance(observer['id'],str) and re.fullmatch('[A-Za-z0-9_.-]{1,80}',observer['id'])
         and observer['method'] == 'native_image_view' and observer['observedAt'] == receipt.get('inspectedAt',frames[0].get('inspectedAt'))
         and observer['recordSha256'] == files['receipt']['sha256']
         and instant(receipt['startedAt']) <= instant(observer['observedAt']) <= datetime.now(timezone.utc))
    if cue_only:return matches[0],None
    need(transcript_sha is None or transcript_sha == files['transcript']['sha256'])
    transcript = json.loads(data['transcript'])
    need(youtube_id(transcript['youtube_link']) == packet['videoId'] and transcript['channel_name'] == 'tzuyang'
         and type(transcript['recollect_id']) is int and transcript['recollect_id'] >= 0)
    validate_transcript(transcript)
    quotes = packet['reviewQuotes']; need(isinstance(quotes,list) and 1 <= len(quotes) <= 8)
    for q in quotes:
        need(isinstance(q,dict) and set(q) == {'segment','start','text'} and type(q['segment']) is int
             and 0 <= q['segment'] < len(transcript['transcript']))
        segment = transcript['transcript'][q['segment']]
        need(type(q['start']) in (int,float) and q['start'] == segment['start']
             and isinstance(q['text'],str) and 0 < len(q['text']) <= 1024 and q['text'] in segment['text'])
    # Selected quotes help locate evidence; they must never remove potentially
    # qualifying or contradictory context from the existing one judgment.
    return matches[0],{'youtube_link':transcript['youtube_link'],'channel_name':'tzuyang',
                      'recollect_id':transcript['recollect_id'],'transcript':transcript['transcript'],
                      'source':'native_verified_full_transcript'}


@dataclass(frozen=True)
class NativeInputs:
    records: dict
    report: dict
    proof: dict
    semantic_sha256: str
    input_sha256: str

    def for_original(self, original, context):
        need(context == {'inputSha256':self.input_sha256} and digest(original) == self.semantic_sha256)
        return self.records


def validate_packet(path, binding, *, original=None, node='node'):
    """Preclaim bytes/metadata check; raw full original required to materialize."""
    from backend.bin.run_restaurant_evidence_recovery import canonical_uuid, jsonb_text, VOLATILE, privacy_check
    from backend.bin.run_restaurant_review_automation import recollect_references, youtube_id
    try:
        path = private(path); directory = private(path.parent,True); raw = read(path,32768)
        packet = json.loads(raw)
        need(set(packet)-{'corroboration','correctionIntent'} == {'schemaVersion','kind','projectRef','jobId','restaurantId','rowSha256','inputSha256',
                             'videoId','sceneId','publisherId','sourceRecipe','custodySha256','files','observer','observation','reviewQuotes'})
        corroboration_sha = None; public = None; correction = None
        if 'corroboration' in packet:
            ref = packet['corroboration']
            need(set(ref) == {'kind','path','sha256'} and ref['kind'] == 'independent_public_place_receipt'
                 and Path(ref['path']).parent == directory)
            public_bytes = read(ref['path'],65536); corroboration_sha = sha(public_bytes); need(corroboration_sha == ref['sha256'])
            public = json.loads(public_bytes)
        need(packet['schemaVersion'] == 1 and packet['kind'] == 'native_observer_report'
             and packet['projectRef'] == 'aqlcofblfxdrjhhdmarw' and packet['custodySha256'] == custody(directory))
        for key in ('jobId','restaurantId'):canonical_uuid(packet[key])
        need(TARGETS.get(packet['restaurantId']) == (packet['videoId'],packet['sceneId']))
        need(all(packet[key] == binding[key] for key in ('jobId','restaurantId','videoId','rowSha256','inputSha256')))
        need(packet['sourceRecipe'] == source_recipe())
        if 'correctionIntent' in packet:
            need(public is not None); correction = correction_join(packet,public)
        meta,transcript = inspect_sources(packet,directory,allow_conflict=correction is not None)
        o = packet['observation']
        compact(o['signName']);compact(o['addressOverlay'])
        need(o['branchQualifier'] is None or isinstance(o['branchQualifier'],str) and 0 < len(o['branchQualifier']) <= 64)
        report = {'kind':'native_observer_report','modality':'owner_attested_text_only','videoId':packet['videoId'],
                  'frameSha256':packet['files']['frame']['sha256'],'timePrecision':'approximate',
                  'sourceApproxSeconds':o['sourceApproxSeconds'],'observations':{k:o[k] for k in ('signName','branchQualifier','addressOverlay')},
                  'observationProvenance':{k:packet['observer'][k] for k in ('method','observedAt','recordSha256')},
                  'pixelsProvidedToJudge':False,'providerSigned':False,
                  'reviewQuoteAttribution':'selected_video_quotes_not_independent_target_review_proof',
                  'reviewQuotes':packet['reviewQuotes'],'fullTranscriptProvidedToJudge':True,
                  'independentEvidenceFamiliesAdded':[]}
        report['locationCorroboration'] = correction
        if correction is not None:
            privacy_check({k:correction[k] for k in ('originAddress','observedAddress','providerParcelAddress','providerRoadAddress','apiSourceUrl')},node)
        check_source_privacy(report['observations'],packet['observer']['id'],meta['title'],transcript['transcript'],node)
        if original is None:return {'packetSha256':sha(raw)}
        need(digest(original) == binding['rowSha256']
             and digest({k:v for k,v in original.items() if k not in VOLATILE}) == binding['inputSha256'])
        need(original['id'] == packet['restaurantId'] and original['status'] == 'hold'
             and original.get('channel_name') in (None,'','tzuyang')
             and youtube_id(original['youtube_link']) == packet['videoId']
             and not original.get('created_by') and not original.get('updated_by_admin_id')
             and original.get('source_type') not in ('admin','manual','user') and original.get('is_not_selected') is not True)
        original_address = original['origin_address']['address']
        if (compact(original['origin_name']) != compact(o['signName'])
                or compact(original_address) != compact(o['addressOverlay']) and correction is None
                or correction is not None and compact(original_address) != compact(correction['originAddress'])):
            from backend.bin.run_restaurant_review_automation import WorkerFailure
            raise WorkerFailure('source_identity_mismatch')
        need(isinstance(original['tzuyang_review'],str) and original['tzuyang_review'].strip()
             and isinstance(original['trace_id'],str) and original['trace_id'].strip())
        refs = recollect_references(original.get('recollect_version'))
        basis = f"Native observer report (not transcript; source time approximately {o['sourceApproxSeconds']}s): "
        basis += o['signName']+' / '+(o['branchQualifier'] or '')+' / '+o['addressOverlay']
        restaurant = {'origin_name':original['origin_name'],'address':o['addressOverlay'] if correction is None else correction['providerRoadAddress'],'reasoning_basis':basis,
                      'youtuber_review':original['tzuyang_review'],'category':original.get('categories') or []}
        privacy_check({'restaurant':restaurant},node)
        records = {'meta':{'youtube_link':original['youtube_link'],'channel_name':'tzuyang','channel_id':packet['publisherId'],
                           'title':meta['title'],'recollect_id':0},'transcript':transcript,
                   'crawling':{'youtube_link':original['youtube_link'],'channel_name':'tzuyang','source':'native_observer_report',
                               'recollect_version':{'meta':0,'transcript':transcript['recollect_id']},'restaurants':[restaurant]}}
        proof = {'schemaVersion':1,'kind':'native_observer_report','videoId':packet['videoId'],'packetSha256':sha(raw),
                 'corroborationSha256':corroboration_sha,'corroborationUse':'preserve_only' if correction is None else 'explicit_derived_location_no_family_added',
                 'sourceFileSha256':{k:v['sha256'] for k,v in packet['files'].items()},'inputSha256':binding['inputSha256'],
                 'reviewQuotesSha256':digest(packet['reviewQuotes']),
                 'claimRecollectReferences':refs,'freshVersions':records['crawling']['recollect_version'],
                 'metadataUploaderVerified':False,'publisherVerification':'owner_public_metadata_receipt'}
        return NativeInputs(records,report,proof,digest(json.loads(jsonb_text(original))),binding['inputSha256'])
    except Exception as error:
        from backend.bin.run_restaurant_review_automation import WorkerFailure
        if isinstance(error,WorkerFailure) and error.code == 'source_identity_mismatch':raise
        raise WorkerFailure('source_input_invalid') from None
