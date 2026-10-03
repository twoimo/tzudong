#!/usr/bin/env python3
"""Bounded durable review worker; scheduling does not require LLM supervision.

Approval is deterministic SQL. Rechecks use original crawl + transcript inputs,
the existing rule/parser/transform and one Gemini call in isolated scratch data.
No generic pipeline hosted-write latch is changed; writes use only this feature's
policy-bound, input-bound, idempotent RPCs. No raw source/provider output logs.
"""
from __future__ import annotations
import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.utils.supabase_rest import resolve_privileged_supabase_rest_credentials
from backend.pipeline_control.targets import admitted_target

RESULT_FIELDS = {'evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address','jibun_address','english_address','address_elements','naver_name','google_name','categories'}
MAPPED_FIELDS = {'roadAddress':'road_address','jibunAddress':'jibun_address','englishAddress':'english_address','addressElements':'address_elements','category':'categories'}


class WorkerFailure(Exception):
    def __init__(self, code): super().__init__(code); self.code = code


def youtube_id(link):
    if not isinstance(link,str): raise WorkerFailure('source_unavailable')
    try:
        parsed=urlsplit(link)
        port=parsed.port
    except ValueError: raise WorkerFailure('source_unavailable') from None
    if parsed.scheme not in ('http','https') or parsed.hostname not in ('youtube.com','www.youtube.com','youtu.be') or parsed.username or parsed.password or port:
        raise WorkerFailure('source_unavailable')
    match=re.search(r'(?:[?&]v=|youtu\.be/|/shorts/|/live/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)',link)
    if not match: raise WorkerFailure('source_unavailable')
    return match.group(1)


def last_record(path):
    if not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise WorkerFailure('source_unavailable')
    last = None
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            if line.strip(): last = json.loads(line)
    if not isinstance(last,dict): raise WorkerFailure('source_unavailable')
    return last


def cached_source_record(path, directory, original, video_id, channel):
    latest=last_record(path)
    references=original.get('recollect_version') or {}
    if not isinstance(references,dict) or any(type(value) is not int or value<0 for value in references.values()):
        raise WorkerFailure('source_unavailable')
    def identity(record):
        if not isinstance(record,dict) or youtube_id(record.get('youtube_link'))!=video_id:
            raise WorkerFailure('source_unavailable')
        if record.get('channel_name') is not None and record['channel_name']!=channel:
            raise WorkerFailure('source_unavailable')
        if record.get('video_id') is not None and record['video_id']!=video_id:
            raise WorkerFailure('source_unavailable')
        if 'recollect_id' in record and (type(record['recollect_id']) is not int or record['recollect_id']<0):
            raise WorkerFailure('source_unavailable')
        nested=record.get('recollect_version') or {}
        if not isinstance(nested,dict) or any(type(value) is not int or value<0 for value in nested.values()):
            raise WorkerFailure('source_unavailable')
    def matches(record):
        if directory=='crawling':
            cached=record.get('recollect_version') or {}
            return all(cached.get(key,0)==value for key,value in references.items() if key in ('meta','transcript'))
        if directory in references:
            # Legacy collectors used zero when an optional recollect_id was absent.
            return record.get('recollect_id',0)==references[directory]
        return True
    identity(latest)
    if matches(latest):return latest
    selected=None
    with path.open(encoding='utf-8') as stream:
        for line in stream:
            if not line.strip():continue
            record=json.loads(line);identity(record)
            if matches(record):selected=record
    if selected is None:raise WorkerFailure('source_unavailable')
    return selected


def result_fields(records, original):
    matches = [record for record in records if record.get('trace_id')==original.get('trace_id')]
    if not matches:
        matches = [record for record in records if record.get('origin_name')==original.get('origin_name')
                   and record.get('youtuber_review')==original.get('tzuyang_review') and record.get('youtube_link')==original.get('youtube_link')]
    if len(matches)!=1: raise WorkerFailure('result_invalid')
    source=matches[0]
    result={key:source[key] for key in RESULT_FIELDS if key in source}
    for source_key,destination in MAPPED_FIELDS.items():
        if source_key in source: result[destination]=source[source_key]
    if isinstance(result.get('categories'),str): result['categories']=[result['categories']]
    evaluation=result.get('evaluation_results')
    if not isinstance(evaluation,dict): raise WorkerFailure('evaluation_incomplete')
    for key in ['visit_authenticity','rb_inference_score','review_faithfulness_score']:
        metric=evaluation.get(key)
        value=metric.get('eval_value') if isinstance(metric,dict) else None
        maximum={'visit_authenticity':4,'rb_inference_score':2,'review_faithfulness_score':1}[key]
        if type(value) not in (int,float) or not math.isfinite(value) or not 0<=value<=maximum or (key!='review_faithfulness_score' and not float(value).is_integer()) or not isinstance(metric.get('eval_basis'),str) or metric['eval_basis'].strip() in ('','-','근거 내용 없음','평가 근거 없음'):
            raise WorkerFailure('evaluation_incomplete')
    for key in ['rb_grounding_TF','category_TF','category_validity_TF']:
        metric=evaluation.get(key)
        if not isinstance(metric,dict) or type(metric.get('eval_value')) is not bool:
            raise WorkerFailure('evaluation_incomplete')
        if key=='rb_grounding_TF' and (not isinstance(metric.get('eval_basis'),str) or metric['eval_basis'].strip() in ('','-','근거 내용 없음','평가 근거 없음')):
            raise WorkerFailure('evaluation_incomplete')
    location=evaluation.get('location_match_TF')
    if not isinstance(location,dict) or type(location.get('eval_value')) is not bool or not isinstance(location.get('evidence_families'),list) or not all(isinstance(f,str) and f.strip() for f in location['evidence_families']):
        raise WorkerFailure('evaluation_incomplete')
    if location['eval_value']:
        if location.get('match_status')!='matched' or len(set(location['evidence_families']))<2 or location.get('pending_reason') or location.get('falseMessage'):
            raise WorkerFailure('evaluation_incomplete')
    elif location.get('match_status') not in ('pending','failed','unmatched') or not any(isinstance(location.get(key),str) and location[key].strip() for key in ('pending_reason','falseMessage')):
        raise WorkerFailure('evaluation_incomplete')
    return result


def stored_extraction(original, video_id):
    required=['origin_name','reasoning_basis','tzuyang_review']
    if any(not isinstance(original.get(key),str) or not original[key].strip() for key in required): raise WorkerFailure('source_unavailable')
    origin=original.get('origin_address')
    if not isinstance(origin,dict) or not isinstance(origin.get('address'),str) or not origin['address'].strip(): raise WorkerFailure('source_unavailable')
    meta=original.get('youtube_meta')
    if not isinstance(meta,dict) or not isinstance(meta.get('title'),str) or not meta['title'].strip(): raise WorkerFailure('source_unavailable')
    references=original.get('recollect_version') or {}
    if not isinstance(references,dict): raise WorkerFailure('source_unavailable')
    link=original.get('youtube_link')
    if youtube_id(link)!=video_id:raise WorkerFailure('source_unavailable')
    return ({'youtube_link':link,'channel_name':original.get('channel_name'),'recollect_version':references,'source':'stored_original_extraction',
            'restaurants':[{'origin_name':original['origin_name'],'reasoning_basis':original['reasoning_basis'],'youtuber_review':original['tzuyang_review'],
                            'address':origin['address'],'lat':origin.get('lat'),'lng':origin.get('lng'),'category':original.get('categories') or []}]},
           {**meta,'youtube_link':link,'recollect_id':references.get('meta',0)})


def evaluate(original, crawling_root, run_command=subprocess.run):
    channel = original.get('channel_name')
    # Source roots are operator configuration, never provider/admin text.
    try:
        target = admitted_target(channel)
        if 'evaluate' not in target.get('capabilities',[]): raise ValueError('capability')
    except (ValueError, TypeError): raise WorkerFailure('source_unavailable') from None
    video_id = youtube_id(original.get('youtube_link'))
    source_root = Path(crawling_root)/channel
    source_files = [(directory, source_root/directory/(video_id+'.jsonl')) for directory in ['crawling','meta','transcript','visual-location']]
    selected_sources={directory:cached_source_record(path,directory,original,video_id,channel)
                      for directory,path in source_files if path.is_file()}
    with tempfile.TemporaryDirectory(prefix='tzudong-review-') as scratch:
        scratch=Path(scratch); crawl=scratch/'crawl'; evaluation=scratch/'evaluation'
        for directory,path in source_files:
            if directory in selected_sources:
                destination=crawl/directory/path.name; destination.parent.mkdir(parents=True,exist_ok=True)
                destination.write_text(json.dumps(selected_sources[directory],ensure_ascii=False)+'\n',encoding='utf-8')
        scripts=ROOT/'backend/restaurant-evaluation/scripts'
        def run(command):
            try:
                completed=run_command(command,cwd=ROOT,env=os.environ.copy(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=480,check=False)
            except subprocess.TimeoutExpired: raise WorkerFailure('worker_timeout') from None
            if completed.returncode: raise WorkerFailure('evaluation_failed')
        if not (crawl/'crawling'/(video_id+'.jsonl')).is_file() or not (crawl/'meta'/(video_id+'.jsonl')).is_file():
            stored,meta=stored_extraction(original,video_id)
            for directory,record in [('crawling',stored),('meta',meta)]:
                destination=crawl/directory/(video_id+'.jsonl')
                if not destination.exists():
                    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(record,ensure_ascii=False)+'\n',encoding='utf-8')
        if not (crawl/'transcript'/(video_id+'.jsonl')).is_file():
            (crawl/'urls.txt').write_text('https://www.youtube.com/watch?v='+video_id+'\n',encoding='utf-8')
            run(['node',str(ROOT/'backend/bin/review_recheck_transcript.mjs'),channel,str(crawl)])
            cached_source_record(crawl/'transcript'/(video_id+'.jsonl'),'transcript',original,video_id,channel)
        common=['--channel',channel,'--evaluation-path',str(evaluation),'--video-id',video_id]
        run([sys.executable,str(scripts/'09-target-selection.py'),'--crawling-path',str(crawl),*common])
        selection_file=evaluation/'evaluation/selection'/(video_id+'.jsonl')
        selection=last_record(selection_file)
        selected=[row for row in selection.get('restaurants',[]) if row.get('origin_name')==original.get('origin_name')]
        if len(selected)!=1 or selection.get('evaluation_target',{}).get(original.get('origin_name')) is not True:
            raise WorkerFailure('source_unavailable')
        selection['restaurants']=selected
        selection['evaluation_target']={original['origin_name']:True}
        selection_file.write_text(json.dumps(selection,ensure_ascii=False)+'\n',encoding='utf-8')
        run([sys.executable,str(scripts/'10-rule-evaluation.py'),*common])
        rule_file=evaluation/'evaluation/rule_results'/(video_id+'.jsonl'); rule=last_record(rule_file)
        restaurants=[]; location=rule.get('evaluation_results',{}).get('location_match_TF',[])
        for source in rule.get('restaurants',[]):
            name=source.get('origin_name')
            if rule.get('evaluation_target',{}).get(name) is not True: continue
            # Evaluate only this leased restaurant, preserving the complete
            # video's transcript and existing location result for the parser.
            if name!=original.get('origin_name'): continue
            match=next((item for item in location if item.get('origin_name')==name),{})
            restaurants.append({**{key:value for key,value in source.items() if key!='origin_name'},'name':match.get('naver_name') or match.get('google_name') or name})
        if len(restaurants)!=1: raise WorkerFailure('source_unavailable')
        transcript=last_record(crawl/'transcript'/(video_id+'.jsonl')).get('transcript')
        if not isinstance(transcript,list) or not transcript: raise WorkerFailure('source_unavailable')
        template=(ROOT/'backend/restaurant-evaluation/prompts/evaluation_prompt.txt').read_text(encoding='utf-8')
        prompt=template.replace('{restaurant_data}',json.dumps({'youtube_link':rule.get('youtube_link'),'restaurants':restaurants},ensure_ascii=False))
        prompt+='\n<참고: YouTube 자막>\n'+json.dumps(transcript,ensure_ascii=False)+'\n</참고: YouTube 자막>'
        if len(prompt.encode())>2*1024*1024: raise WorkerFailure('source_unavailable')
        prompt_path=scratch/'prompt.txt'; prompt_path.write_text(prompt,encoding='utf-8'); prompt_path.chmod(0o600)
        response_path=scratch/'response.json'
        run(['node',str(ROOT/'backend/bin/review_recheck_gemini.mjs'),str(prompt_path),str(response_path)])
        run([sys.executable,str(scripts/'parse_laaj_evaluation.py'),*common,'--response-file',str(response_path),'--rule-file',str(rule_file)])
        run([sys.executable,str(scripts/'12-transform.py'),'--channel',channel,'--crawling-path',str(crawl),'--evaluation-path',str(evaluation)])
        transformed=evaluation/'evaluation/transforms.jsonl'
        if not transformed.is_file(): raise WorkerFailure('evaluation_incomplete')
        with transformed.open(encoding='utf-8') as stream: records=[json.loads(line) for line in stream if line.strip()]
        return result_fields(records,original)


def run_once(rpc, *, recheck_limit=0, crawling_root=None, evaluator=evaluate, request_id=None):
    if recheck_limit not in (0,1): raise ValueError('review_recheck_limit_invalid')
    summary=rpc('restaurant_review_automation_tick',{'request_id':request_id or str(uuid.uuid4())})
    summary['recheckAttempted']=False
    if summary.get('disabled') or recheck_limit==0: return summary
    token=str(uuid.uuid4())
    item=rpc('restaurant_review_automation_worker',{'action':'claim','item_id':None,'token':token,'result':{}})
    if not item or item.get('disabled'): return summary
    summary['recheckAttempted']=True
    args={'item_id':item['id'],'token':token}
    try:
        result=evaluator(item['restaurant'],crawling_root)
    except WorkerFailure as error:
        rpc('restaurant_review_automation_worker',dict(args,action='fail',result={'code':error.code}))
        return summary
    except Exception:
        rpc('restaurant_review_automation_worker',dict(args,action='fail',result={'code':'evaluation_failed'}))
        return summary
    # An uncertain completion response propagates. No second provider call or
    # opposite decision is issued; the durable item readback settles its state.
    rpc('restaurant_review_automation_worker',dict(args,action='complete',result=result))
    rpc('restaurant_review_automation_tick',{'request_id':str(uuid.uuid4())})
    return summary


def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument('--recheck-limit',type=int,choices=[0,1],default=0)
    parser.add_argument('--crawling-root',type=Path,default=ROOT/'backend/restaurant-crawling/data')
    parser.add_argument('--request-id',default=str(uuid.uuid4()))
    parser.add_argument('--receipt-file',type=Path)
    args=parser.parse_args(argv)
    uuid.UUID(args.request_id)
    # No inherited generic pipeline mutation context is removed or bypassed.
    credentials=resolve_privileged_supabase_rest_credentials()
    if credentials.url!='https://aqlcofblfxdrjhhdmarw.supabase.co': raise WorkerFailure('source_unavailable')
    def rpc(name,body):
        request=Request(credentials.url+'/rest/v1/rpc/'+name,data=json.dumps(body).encode(),method='POST',headers={
            'Content-Type':'application/json','apikey':credentials.service_role_key,'Authorization':'Bearer '+credentials.service_role_key})
        with urlopen(request,timeout=20) as response:
            payload=response.read(256*1024+1)
            if len(payload)>256*1024: raise WorkerFailure('result_invalid')
            return json.loads(payload)
    try:
        summary=run_once(rpc,recheck_limit=args.recheck_limit,crawling_root=args.crawling_root,request_id=args.request_id)
        receipt={key:value for key,value in summary.items() if key in ['id','disabled','scanned','approved','held','protected','recheck','recheckAttempted']}
        if args.receipt_file:
            with args.receipt_file.open('w',encoding='utf-8') as output:json.dump(receipt,output)
            args.receipt_file.chmod(0o600)
        print(json.dumps(receipt))
        return 0
    except Exception:
        print('REVIEW_AUTOMATION_RESULT_UNCONFIRMED',file=sys.stderr); return 1

if __name__=='__main__': raise SystemExit(main())
