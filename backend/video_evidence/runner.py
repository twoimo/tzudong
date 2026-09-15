#!/usr/bin/env python3
"""Produce a bounded evidence pack using real captions and focused video frames.

Caption mode never opens/decodes a video. Efficient mode decodes keyframes;
balanced mode uses scene changes with uniform fallback. Cues reserve their
budget before general coverage. Frame receipts record actual sampling scope.
"""
from __future__ import annotations
import argparse
import contextlib
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import tempfile
import time

from .vendor.claude_video import frames, transcribe

ROOT = Path(__file__).resolve().parents[2]


class EvidenceError(Exception):
    pass


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def captions(path):
    if path is None:return []
    if path.is_symlink() or not path.is_file() or path.stat().st_size>8*1024*1024:
        raise EvidenceError('CAPTIONS_INPUT_INVALID')
    if path.suffix=='.vtt':return transcribe.parse_vtt(str(path))
    records=[json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not records:return []
    raw=records[-1].get('transcript',[])
    segments=[]
    for row in raw:
        start=float(row['start'])
        duration=float(row.get('duration') or 0)
        end=float(row['end']) if row.get('end') is not None else start+duration
        if not math.isfinite(start+end) or start<0 or end<start or not isinstance(row['text'],str):
            raise EvidenceError('CAPTIONS_INPUT_INVALID')
        segments.append({'start':start,'end':end,'text':row['text']})
    return transcribe._dedupe(segments)


def safe_segments(segments):
    # Sanitize each cue independently so a contact line cannot erase an entire
    # video's remaining business evidence. No raw transcript is persisted here.
    run=subprocess.run(['bun',str(ROOT/'apps/web/scripts/sanitize-evaluation-evidence.ts')],
        input=json.dumps(segments).encode(),capture_output=True,timeout=30)
    if run.returncode:raise EvidenceError('CAPTIONS_PRIVACY_UNAVAILABLE')
    return [item['row'] for item in json.loads(run.stdout)]


def inspect(*,video:Path|None,caption_path:Path|None,output_root:Path,mode='efficient',
            start=0.0,end=None,timestamps=(),max_frames=12,resolution=768):
    if mode not in {'transcript','efficient','balanced'} or not 1<=max_frames<=100 or not 256<=resolution<=1024:
        raise EvidenceError('EVIDENCE_OPTIONS_INVALID')
    if not math.isfinite(start) or start<0 or (end is not None and (not math.isfinite(end) or end<=start)):
        raise EvidenceError('EVIDENCE_RANGE_INVALID')
    if any(not math.isfinite(t) or t<0 for t in timestamps):raise EvidenceError('EVIDENCE_CUES_INVALID')
    began=time.monotonic()
    segments=captions(caption_path)
    source_caption_hash=digest(caption_path) if caption_path else None
    if mode=='transcript' and not timestamps:
        if not segments:raise EvidenceError('CAPTIONS_UNAVAILABLE')
        duration=max(s['end'] for s in segments)
        selected=[];frame_info={'engine':'none','selected_count':0,'candidate_count':0}
    else:
        if video is None or video.is_symlink() or not video.is_file() or video.stat().st_size>2*1024**3:
            raise EvidenceError('VIDEO_INPUT_INVALID')
        try:
            meta=frames.get_metadata(str(video))
        except (Exception,SystemExit):raise EvidenceError('VIDEO_PROBE_UNAVAILABLE') from None
        duration=meta['duration_seconds']
        if start>=duration:raise EvidenceError('EVIDENCE_RANGE_INVALID')
    stop=min(end if end is not None else duration,duration)
    if stop<=start:raise EvidenceError('EVIDENCE_RANGE_INVALID')
    # A visual pass must be focused. Longer videos are reviewed in separately
    # addressable packs rather than silently dropping the tail of the range.
    if (mode!='transcript' or timestamps) and stop-start>180:
        raise EvidenceError('FOCUSED_RANGE_REQUIRED')
    output_root.mkdir(mode=0o700,parents=True,exist_ok=True)
    if output_root.is_symlink():raise EvidenceError('EVIDENCE_OUTPUT_INVALID')
    work=Path(tempfile.mkdtemp(prefix='video-evidence-',dir=output_root))
    if mode!='transcript' or timestamps:
        try:
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                pinned,pinned_info=frames.extract_at_timestamps(str(video),work/'cues',list(timestamps),
                    resolution=resolution,max_frames=max_frames,start_seconds=start,end_seconds=stop)
                remaining=max_frames-len(pinned)
                sampled=[];frame_info={'engine':'timestamps','candidate_count':0,'selected_count':0}
                if mode!='transcript' and remaining>0:
                    if mode=='efficient':
                        sampled,frame_info=frames.extract_keyframes(str(video),work/'coverage',resolution=resolution,
                            max_frames=remaining,start_seconds=start,end_seconds=stop)
                    else:
                        fps,target=frames.auto_fps_focus(stop-start,remaining)
                        sampled,frame_info=frames.extract_scene_or_uniform(str(video),work/'coverage',fps,target,
                            resolution=resolution,max_frames=remaining,start_seconds=start,end_seconds=stop)
                selected=frames.merge_frames(sampled,pinned)
                frame_info={**frame_info,'pinned':pinned_info,'selected_count':len(selected)}
        except (Exception,SystemExit):raise EvidenceError('FRAME_EXTRACTION_UNAVAILABLE') from None
        if not selected:raise EvidenceError('FRAMES_UNAVAILABLE')
    segment_scope=transcribe.filter_range(segments,start,stop)
    # Bound the sanitizer work per call; caption collections may exceed 2000 cues.
    safe=[]
    for offset in range(0,len(segment_scope),500):safe.extend(safe_segments(segment_scope[offset:offset+500]))
    receipt={'schema':'restaurant-video-evidence-v1','adoption':'claude-video@83da59fa',
        'scope':{'start':start,'end':stop,'video_duration':duration,'full_video':start==0 and stop>=duration},
        'mode':mode,'caption_source_sha256':source_caption_hash,
        'video_source_sha256':digest(video) if video is not None and (mode!='transcript' or timestamps) else None,
        'transcript_status':'available' if safe else 'unavailable','segments':safe,
        'sampling':frame_info,'frames':[{**f,'sha256':digest(Path(f['path']))} for f in selected],
        'elapsed_seconds':round(time.monotonic()-began,3)}
    payload=json.dumps(receipt,ensure_ascii=False,sort_keys=True,allow_nan=False).encode()
    path=work/'evidence.json'
    with path.open('xb') as stream:stream.write(payload)
    path.chmod(0o600)
    return {'manifest':str(path),'sha256':hashlib.sha256(payload).hexdigest(),
            'frames':len(selected),'segments':len(safe),'sampling':frame_info,'elapsed_seconds':receipt['elapsed_seconds']}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--video',type=Path);p.add_argument('--captions',type=Path)
    p.add_argument('--output-root',type=Path,required=True)
    p.add_argument('--mode',choices=['transcript','efficient','balanced'],default='efficient')
    p.add_argument('--start',type=float,default=0);p.add_argument('--end',type=float)
    p.add_argument('--timestamps',default='');p.add_argument('--max-frames',type=int,default=12)
    p.add_argument('--resolution',type=int,default=768)
    a=p.parse_args()
    try:
        result=inspect(video=a.video,caption_path=a.captions,output_root=a.output_root,mode=a.mode,start=a.start,end=a.end,
            timestamps=frames.parse_timestamps(a.timestamps),max_frames=a.max_frames,resolution=a.resolution)
        print(json.dumps(result))
    except (Exception,SystemExit) as error:
        code=str(error) if isinstance(error,EvidenceError) else 'VIDEO_EVIDENCE_UNAVAILABLE'
        print(json.dumps({'error':code}));raise SystemExit(1) from None


if __name__=='__main__':main()
