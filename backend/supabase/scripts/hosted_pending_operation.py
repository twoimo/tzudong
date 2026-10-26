"""Candidate shared-custody caller. No CLI/scheduler switch or provider calls.

The DB owns operation/identity custody. Only an invocation receiving claimed=true from its own fresh claim CAS may send
apply once. Existing PREPARED custody needs its original UUID and exact binding.
CLAIMED/HELD and ambiguous replies remain read-only; zero rows prove no rollback.
"""
from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
import uuid
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

from backend.supabase.scripts.hosted_data_plane import (
    HOSTED_URL, HostedDataPlaneError, APPLY_CANDIDATE_LABELS,
    classify_evaluation_row, load_evaluation_rows, pending_insert_payload,
    preview_hash, row_youtube_id,
)


def deny(code):
    raise HostedDataPlaneError(code) from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        deny('pending_transport_failed')


def rpc_transport(action, body, *, service_role_key):
    if action not in ('prepare','claim','apply','read') or not service_role_key:
        deny('pending_transport_invalid')
    url=HOSTED_URL+'/rest/v1/rpc/hosted_pending_'+action
    data=None if action=='read' else json.dumps(body,allow_nan=False).encode()
    if action=='read':
        query={k:v for k,v in body.items() if v is not None}
        if 'video_ids' in query:
            videos=query['video_ids']
            if not isinstance(videos,list) or not 1<=len(videos)<=100 or any(not re.fullmatch('[A-Za-z0-9_-]{11}',v) for v in videos):deny('pending_video_set_invalid')
            query['video_ids']='{'+','.join(videos)+'}'
        url+='?'+urlencode(query)
    req=Request(url,data=data,method='GET' if action=='read' else 'POST',headers={
        'Authorization':'Bearer '+service_role_key,'apikey':service_role_key,
        'Content-Type':'application/json','Accept':'application/json'})
    try:
        with build_opener(NoRedirect()).open(req,timeout=15) as response:
            raw=response.read(262145)
            if len(raw)>262144:deny('pending_transport_failed')
            return json.loads(raw)
    except HTTPError as error:
        # Only this fixed discovery error permits smaller read-only requests.
        # Keep arbitrary transport failures and all writes on the no-retry path.
        if action=='read' and body.get('video_ids') and body.get('request_id') is None:
            try:
                with error:
                    raw=error.read(4097)
                detail=json.loads(raw) if len(raw)<=4096 else None
            except (OSError,ValueError):
                detail=None
            if (isinstance(detail,dict) and detail.get('code')=='54000'
                    and detail.get('message')=='PENDING_DISCOVERY_UNBOUNDED'):
                deny('pending_discovery_unbounded')
        deny('pending_transport_failed')
    except (URLError,OSError,ValueError):
        deny('pending_transport_failed')


@dataclass(frozen=True)
class CandidateSet:
    revision: str
    freshness: dict
    rows: list
    fingerprint: str
    reobserve: object

    def assert_current(self):
        if preview_hash({'revision':self.revision,'freshness':self.freshness,'rows':self.rows})!=self.fingerprint:
            deny('pending_candidate_set_changed')
        current=self.reobserve()
        if current.fingerprint!=self.fingerprint:
            deny('pending_source_input_changed')


def admit_current_candidate_set(*,evaluation,crawling,channel,videos,revision,environment,evaluator=None):
    """Reuse the promoted producer freshness check; never invent missing receipts.

    The producer freshness API is required; missing receipts hold rather than
    manufacturing a fingerprint for a legacy local output.
    Every applicable row for each requested video is read from the whole transforms
    file; callers cannot supply a cherry-picked A-only payload list.
    """
    if evaluator is None:
        from backend.bin import evaluate_new_youtube_videos as evaluator
    if not hasattr(evaluator,'_fresh_locally_evaluated_ids') or not hasattr(evaluator,'_cache_snapshot'):
        deny('pending_freshness_contract_unavailable')
    if not isinstance(revision,str) or not re.fullmatch('[0-9a-f]{40}',revision):
        deny('pending_source_invalid')
    videos=sorted(set(videos))
    if not videos or any(not isinstance(v,str) or not re.fullmatch('[A-Za-z0-9_-]{11}',v) for v in videos):
        deny('pending_video_set_invalid')
    evaluation,crawling=Path(evaluation),Path(crawling)
    root=Path(evaluator.REPO_ROOT)
    def snapshot(*,candidate_scope=False):
        if candidate_scope:
            try:
                watched=evaluator._cache_snapshot(crawling,evaluation,videos,environment,candidate_scope=True)
            except TypeError:
                deny('pending_freshness_contract_unavailable')
        else:
            watched=evaluator._cache_snapshot(crawling,evaluation,videos,environment)
        from backend.supabase.scripts import hosted_data_plane
        for path in (Path(evaluator.__file__),Path(__file__),Path(hosted_data_plane.__file__)):
            st=path.stat()
            watched[path]=(st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)
        return watched
    def observe():
        if current_source_revision(root)!=revision:deny('pending_source_input_changed')
        before=snapshot()
        scoped=snapshot(candidate_scope=True)
        if any(path not in before or before[path]!=signature for path,signature in scoped.items()):
            deny('pending_source_input_changed')
        fresh=evaluator._fresh_locally_evaluated_ids(evaluation,crawling,channel,environment)
        if not set(videos)<=fresh:deny('pending_local_input_stale')
        all_rows=load_evaluation_rows(str(evaluation/'evaluation/transforms.jsonl'))
        rows=[pending_insert_payload(r) for r in all_rows if row_youtube_id(r) in videos
              and classify_evaluation_row(r,[]) in APPLY_CANDIDATE_LABELS]
        if not rows or len(rows)>200:deny('pending_candidate_set_invalid')
        inputs=[];sources=[]
        # Keep the whole-output cache check and broad before/after race guard.
        # Its global transform output/receipt and unrelated groups are not
        # persistent inputs of this video's custody: rows below bind every
        # admitted sibling while scoped paths bind its own inputs/receipts.
        for path in sorted(scoped,key=str):
            path=Path(path)
            # Never copy/hash secret values into a receipt. Producer probes bind
            # their resolved public settings; stat changes still invalidate here.
            if path.name.startswith('.env'):continue
            try:
                relative=str(path.resolve().relative_to(root.resolve()))
            except ValueError:deny('pending_input_path_invalid')
            digest=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            target=sources if any(part in ('scripts','utils','config') for part in path.parts) else inputs
            target.append([relative,digest])
        if before!=snapshot() or current_source_revision(root)!=revision:
            deny('pending_source_input_changed')
        freshness={'contract':'local-pipeline-candidate-set-v1','complete':True,
                   'inputSha256':preview_hash({'files':inputs,'videos':videos,'rows':rows}),
                   'sourceSha256':preview_hash({'revision':revision,'files':sources})}
        fingerprint=preview_hash({'revision':revision,'freshness':freshness,'rows':rows})
        return CandidateSet(revision,freshness,rows,fingerprint,observe)
    return observe()


def reconcile_request(request_id,*,transport):
    try:
        result=transport('read',{'request_id':str(uuid.UUID(request_id))})
        if (not isinstance(result,dict) or result.get('requestId')!=request_id
                or result.get('state') not in ('prepared','claimed','committed','held')
                or result.get('replayAllowed') is not False):
            deny('pending_readback_invalid')
        return result
    except Exception:
        return {'requestId':request_id,'state':'unconfirmed','replayAllowed':False}


def _valid_freshness(value):
    return (isinstance(value,dict) and set(value)=={'contract','complete','inputSha256','sourceSha256'}
        and value['contract']=='local-pipeline-candidate-set-v1' and value['complete'] is True
        and all(isinstance(value[k],str) and re.fullmatch('[0-9a-f]{64}',value[k])
                for k in ('inputSha256','sourceSha256')))


def _prepared_binding(operation,revision,freshness=None):
    if (not isinstance(operation,dict) or operation.get('state')!='prepared'
        or operation.get('replayAllowed') is not False or operation.get('sourceRevision')!=revision
        or not _valid_freshness(operation.get('freshness'))
        or (freshness is not None and operation['freshness']!=freshness)
        or not isinstance(operation.get('bindingSha'),str)
        or not re.fullmatch('[0-9a-f]{64}',operation['bindingSha'])):
        deny('pending_original_request_changed')
    return operation['bindingSha']


def submit_once(candidate,*,transport,request_id=None,resume_binding=None):
    """Resume only original PREPARED custody; never replay an uncertain APPLY.

    PREPARE recomputes the SQL binding from the complete current input. Its
    existing response must retain the UUID/binding observed before that call.
    Only this invocation's unambiguous new claim CAS winner may APPLY once.
    A failed transport ends this invocation in read-only reconciliation.
    """
    candidate.assert_current()
    original=request_id is not None
    rid=request_id or str(uuid.uuid5(uuid.NAMESPACE_URL,'tzudong:pending:v1:'+candidate.fingerprint))
    rid=str(uuid.UUID(rid));sender=str(uuid.uuid4());apply_attempted=False
    if resume_binding is not None and (not original or not isinstance(resume_binding,str)
            or not re.fullmatch('[0-9a-f]{64}',resume_binding)):
        deny('pending_resume_invalid')
    def finish():
        result=reconcile_request(rid,transport=transport)
        try:
            candidate.assert_current()
            current=True
        except Exception:
            current=False
        return {**result,'sourceStillCurrent':current,'authorizesVideoSkip':False,'applyAttempted':apply_attempted}
    try:
        observed=transport('read',{'request_id':rid})
        binding=None
        if observed is not None:
            if (not isinstance(observed,dict) or observed.get('requestId')!=rid
                    or observed.get('replayAllowed') is not False):
                deny('pending_readback_invalid')
            if observed.get('state')!='prepared':return finish()
            binding=_prepared_binding(observed,candidate.revision,candidate.freshness)
            if resume_binding is not None and binding!=resume_binding:
                deny('pending_original_request_changed')
        elif original:
            # Disappearing/unknown original custody is never recreated.
            return finish()
        candidate.assert_current()
        prepared=transport('prepare',{'request_id':rid,'source_revision':candidate.revision,
                                      'freshness':candidate.freshness,'rows':candidate.rows})
        actual=prepared.get('requestId')
        if not isinstance(actual,str) or str(uuid.UUID(actual))!=actual:
            deny('pending_prepare_invalid')
        if binding is not None:
            if actual!=rid or prepared.get('bindingSha')!=binding or prepared.get('created') is not False:
                deny('pending_original_request_changed')
        else:
            # A race can discover a different original operation. Keep that
            # receipt, but only a subsequent original-custody admission resumes it.
            rid=actual
            if prepared.get('created') is not True:return finish()
            binding=prepared.get('bindingSha')
        if prepared.get('state')!='prepared':return finish()
        if not isinstance(binding,str) or not re.fullmatch('[0-9a-f]{64}',binding):
            deny('pending_prepare_invalid')
        candidate.assert_current()
        claim=transport('claim',{'request_id':rid,'sender_id':sender,'binding_sha':binding})
        if claim.get('claimed') is not True or claim.get('state')!='claimed':return finish()
        candidate.assert_current()
        apply_attempted=True
        transport('apply',{'request_id':rid,'sender_id':sender,'binding_sha':binding,'rows':candidate.rows})
    except Exception:
        return finish()
    return finish()


def current_source_revision(root):
    from backend.supabase.scripts.hosted_pending_source import (
        observe_source_revision, SourceAttestationError,
    )
    try:
        return observe_source_revision(root)
    except SourceAttestationError:
        deny('pending_source_invalid')


def _fold_operations(operations,revision):
    """Uncertainty dominates history, regardless of server iteration order."""
    for operation in operations:
        if (not isinstance(operation,dict) or operation.get('replayAllowed') is not False
                or operation.get('state') not in ('prepared','claimed','held','committed')
                or not isinstance(operation.get('requestId'),str)
                or str(uuid.UUID(operation['requestId']))!=operation['requestId']):
            deny('pending_discovery_invalid')
    ordered=sorted(operations,key=lambda o:o['requestId'])
    blocked=[o for o in ordered if o['state'] in ('claimed','held')]
    prepared=[o for o in ordered if o['state']=='prepared']
    if blocked or len(prepared)>1:
        return {'state':'held','requestId':(blocked or prepared)[0]['requestId']}
    if prepared:
        original=prepared[0]
        if original.get('sourceRevision')!=revision:
            return {'state':'held','requestId':original['requestId']}
        binding=_prepared_binding(original,revision)
        return {'state':'prepared','requestId':original['requestId'],'bindingSha':binding}
    if not ordered:return {'state':'legacy_unresolved','requestId':None}
    # A malformed/stale committed readback cannot become a skip by list order.
    if any(o.get('currentSetPresent') is not True or o.get('originalRowsStillPresent') is not True for o in ordered):
        return {'state':'unconfirmed','requestId':None}
    current=[o for o in ordered if o.get('sourceRevision')==revision]
    chosen=(current or ordered)[0]
    return {'state':'delivered_snapshot' if current else 'source_changed','requestId':chosen['requestId']}


def observe_deliveries(videos,*,transport,revision):
    """Discovery is not current-input admission; PREPARED never authorizes skip."""
    videos=sorted(set(videos)); answer={}
    # Each overflow replaces one group by two strictly smaller groups. Even if
    # every singleton overflows, discovery terminates within 2*N-1 reads.
    groups=[videos[start:start+100] for start in reversed(range(0,len(videos),100))]
    while groups:
        group=groups.pop()
        try:
            value=transport('read',{'video_ids':group})
        except Exception as error:
            if (isinstance(error,HostedDataPlaneError)
                    and str(error)=='pending_discovery_unbounded' and len(group)>1):
                middle=len(group)//2
                groups.extend((group[middle:],group[:middle]))
                continue
            for video in group:answer[video]={'state':'unconfirmed','requestId':None}
            continue
        try:
            if not isinstance(value,dict) or value.get('videos')!=group or value.get('replayAllowed') is not False:
                deny('pending_discovery_invalid')
            holds=value.get('legacyHeld');ops=value.get('operations')
            if not isinstance(holds,list) or not set(holds)<=set(group) or not isinstance(ops,list) or len(ops)>100:
                deny('pending_discovery_invalid')
            grouped={video:[] for video in group}
            for operation in ops:
                rows=operation.get('currentRows') if isinstance(operation,dict) else None
                if (not isinstance(rows,list) or not rows or any(not isinstance(r,dict)
                        or not isinstance(r.get('video'),str) for r in rows)):
                    deny('pending_discovery_invalid')
                related={row['video'] for row in rows}&set(group)
                if not related:deny('pending_discovery_invalid')
                for video in related:grouped[video].append(operation)
            for video in group:
                answer[video]=_fold_operations(grouped[video],revision)
                if video in holds:answer[video]={'state':'legacy_held','requestId':None}
        except Exception:
            for video in group:answer[video]={'state':'unconfirmed','requestId':None}
    return answer


def local_video_inputs_present(crawling,evaluation,video):
    paths=[Path(crawling)/folder/(video+extension) for folder in ('meta','transcript','crawling')
           for extension in ('.jsonl','.json','.txt')]
    paths += [Path(evaluation)/'evaluation'/folder/(video+'.jsonl')
              for folder in ('selection','notSelection','rule_results','laaj_results')]
    if any(path.exists() for path in paths):return True
    transforms=Path(evaluation)/'evaluation/transforms.jsonl'
    # Orphan terminal rows never authorize remote receipt reuse.
    return any(row_youtube_id(row)==video for row in load_evaluation_rows(str(transforms)))


def resolved_reflection(video,candidate,result):
    """All siblings must resolve; one success can never mask an uncertain row."""
    rows=result.get('rows') if isinstance(result,dict) else None
    valid=(isinstance(rows,list) and bool(rows) and result.get('state')=='committed'
      and result.get('replayAllowed') is False and result.get('sourceStillCurrent') is True
      and result.get('sourceRevision')==candidate.revision and result.get('freshness')==candidate.freshness
      and result.get('currentSetPresent') is True and result.get('originalRowsStillPresent') is True)
    if valid:
        try:
            for row in rows:
                valid=valid and row['video']==video and row['action'] in ('present','inserted') and bool(uuid.UUID(row['id'])) and bool(re.fullmatch('[a-f0-9]{64}',row['identitySha']))
        except (ValueError,TypeError,KeyError):valid=False
    if not valid:return {'applied':[],'skippedAlreadyPresent':[],'unresolved':[video]}
    return {'applied':[video] if any(row['action']=='inserted' for row in rows) else [],
            'skippedAlreadyPresent':[video] if all(row['action']=='present' for row in rows) else [],'unresolved':[]}


def payloads_sha(rows):
    ordered=sorted(rows,key=lambda item:(str(item.get('youtube_link') or ''),str(item.get('trace_id') or ''),str(item.get('origin_name') or '')))
    return preview_hash({'payloads':ordered})


def apply_current_sets(*,evaluation,crawling,channel,revision,environment,videos,transport,expected_payloads=None,evaluator=None):
    if not isinstance(expected_payloads,list):deny('pending_preview_required')
    reflection={'applied':[],'skippedAlreadyPresent':[],'unresolved':[]};receipts=[];attempts=0
    for video in sorted(set(videos)):
        result=None;original=None
        try:
            c=admit_current_candidate_set(evaluation=evaluation,crawling=crawling,channel=channel,
                videos=[video],revision=revision,environment=environment,evaluator=evaluator)
            approved=[r for r in expected_payloads if row_youtube_id(r)==video]
            if payloads_sha(c.rows)!=payloads_sha(approved):deny('pending_preview_payload_changed')
            # Observe shared custody before issuing any new request. No direct POST
            # fallback, no automatic release of a claimed/held legacy operation.
            observed=transport('read',{'video_ids':[video]})
            if (not isinstance(observed,dict) or observed.get('videos')!=[video]
                or observed.get('replayAllowed') is not False or not isinstance(observed.get('legacyHeld'),list)
                or not isinstance(observed.get('operations'),list) or len(observed['operations'])>100):
                deny('pending_discovery_invalid')
            if observed['legacyHeld']:deny('pending_legacy_held')
            ops=observed['operations']
            folded=_fold_operations(ops,revision)
            matching=[]
            if folded['state']=='prepared':
                original=next(o for o in ops if o['requestId']==folded['requestId'])
                binding=_prepared_binding(original,revision,c.freshness)
                if attempts>=3:deny('pending_batch_deferred')
                attempts+=1
                result=submit_once(c,transport=transport,request_id=original['requestId'],resume_binding=binding)
            else:
                if folded['state'] in ('held','unconfirmed'):
                    for o in ops:
                        if o['state'] in ('prepared','claimed','held'):
                            receipts.append({'video':video,'requestId':o['requestId'],'state':o['state'],'replayAllowed':False})
                    deny('pending_original_request_unconfirmed')
                matching=[o for o in ops if o.get('sourceRevision')==revision and o.get('freshness')==c.freshness]
                if matching:
                    if len(matching)!=1:deny('pending_discovery_invalid')
                    c.assert_current();result={**matching[0],'sourceStillCurrent':True}
                elif attempts<3:
                    attempts+=1;result=submit_once(c,transport=transport)
                else:deny('pending_batch_deferred')
            item=resolved_reflection(video,c,result)
            # An immutable historical receipt with inserted rows is a present
            # readback on this invocation; it is not a second apply.
            if (matching or result.get('applyAttempted') is False) and not item['unresolved']:
                item={'applied':[],'skippedAlreadyPresent':[video],'unresolved':[]}
            receipts.append({'video':video,'requestId':result.get('requestId'),'state':result.get('state'),
                             'replayAllowed':False})
        except Exception:
            if original is not None and result is None:
                receipts.append({'video':video,'requestId':original['requestId'],'state':original['state'],'replayAllowed':False})
            item={'applied':[],'skippedAlreadyPresent':[],'unresolved':[video]}
        for key in reflection:reflection[key].extend(item[key])
    return {'reflection':reflection,'requests':receipts,'replayAllowed':False}
