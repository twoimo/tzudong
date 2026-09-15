#!/usr/bin/env python3
"""Bounded, GET-only business search evidence for a local review inventory.

Results are candidates, never an automatic approval or a closure decision.
Only public business names, addresses, coordinates and category are retained.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re
import time
from urllib.parse import urlencode
from urllib.request import Request, build_opener

import local_evaluation_review as review


def query_for(row):
    name = row['approved_name'] or row['origin_name'] or row['naver_name'] or row['google_name']
    if not isinstance(name, str): return None
    name = re.sub(r'\[[^]]*\]|\([^)]*\)', '', name).strip()
    if not name or len(name) > 50: return None
    address = row.get('origin_address')
    if isinstance(address, dict): address = address.get('address')
    address = row.get('jibun_address') or row.get('road_address') or address or ''
    district = re.search(r'(?<![가-힣])([가-힣]{2,}(?:시|군|구))\b', address)
    return (name + (' ' + district.group(1) if district else ''))[:100]


def provider_keys(path):
    result = {}
    for line in path.read_text().splitlines():
        key, separator, value = line.strip().removeprefix('export ').partition('=')
        if separator and key in {'NAVER_CLIENT_ID_BYEON','NAVER_CLIENT_SECRET_BYEON'}:
            result[key] = value.strip().strip('\"\'')
    if set(result) != {'NAVER_CLIENT_ID_BYEON','NAVER_CLIENT_SECRET_BYEON'}:
        review.fail('place_provider_unavailable')
    return result


def fetch(query, keys):
    request = Request('https://openapi.naver.com/v1/search/local.json?' + urlencode({'query':query,'display':5}),
                      headers={'X-Naver-Client-Id':keys['NAVER_CLIENT_ID_BYEON'],
                               'X-Naver-Client-Secret':keys['NAVER_CLIENT_SECRET_BYEON']}, method='GET')
    with build_opener(review.catalog.NoRedirect).open(request, timeout=10) as response:
        body = response.read(256*1024+1)
    if len(body)>256*1024: review.fail('place_response_limit')
    raw = json.loads(body)
    if not isinstance(raw,dict) or not isinstance(raw.get('items'),list) or len(raw['items'])>5:
        review.fail('place_response_invalid')
    places=[]
    for item in raw['items']:
        lat,lng=int(item['mapy'])/1e7,int(item['mapx'])/1e7
        if not (33<=lat<=39 and 124<=lng<=132): review.fail('place_coordinates_invalid')
        places.append({'name':html.unescape(re.sub('<[^>]*>','',item['title']))[:300],
                       'road_address':item['roadAddress'][:500],'jibun_address':item['address'][:500],
                       'category':html.unescape(item['category'])[:150],'lat':lat,'lng':lng})
    return places


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--source-env',type=Path,required=True)
    parser.add_argument('--geocoded-only',action='store_true')
    parser.add_argument('--limit',type=int,default=50)
    args=parser.parse_args()
    if not 1<=args.limit<=400: review.fail('place_limit_invalid')
    rows=review.catalog.read_private_json(args.inventory)
    selected=[r for r in rows if (not args.geocoded_only or r['geocoding_success']) and query_for(r)][:args.limit]
    ex,_=review.catalog.executor();_,state,_=ex._binding()
    folder=state/'evaluation-review'/'place-evidence';folder.mkdir(mode=0o700,exist_ok=True)
    if folder.is_symlink() or folder.stat().st_mode&0o077: review.fail('place_output_invalid')
    keys=provider_keys(args.source_env)
    inventory_hash=review.catalog.sha(rows)
    def one(row):
        query=query_for(row)
        identity={'inventory_sha256':inventory_hash,'id':row['id'],'query':query}
        path=folder/(review.catalog.sha(identity)+'.json')
        if path.exists(): return {'id':row['id'],'cached':True}
        started=time.monotonic()
        try:
            places=fetch(query,keys)
            result={**identity,'provider':'naver-local-search','checked_at':datetime.now(timezone.utc).isoformat(),
                    'status':'candidates' if places else 'no_candidates','places':places}
            safe=review.sanitize([result])[0]['row']
            review.catalog.private_write(path,safe)
            return {'id':row['id'],'status':result['status'],'count':len(places)}
        except Exception:
            # An unavailable response is not evidence of a missing business.
            return {'id':row['id'],'status':'unavailable'}
        finally:
            time.sleep(max(0,0.5-(time.monotonic()-started)))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(one,selected))
    print(json.dumps({'selected':len(selected),'results':results,'folder':str(folder)}))


if __name__=='__main__':
    try: main()
    except Exception: print(json.dumps({'error':'PLACE_EVIDENCE_UNAVAILABLE'}));raise SystemExit(1)
