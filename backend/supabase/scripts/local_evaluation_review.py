#!/usr/bin/env python3
"""Recover evidence and review the checkout-bound local catalog, never hosted writes.

Preview -> exact hash confirmation -> atomic apply and minimized immutable audit
-> independent readback. Source requests are GET-only, redirect-denied and bounded.
Missing evidence is recovered only into null fields; no evaluation is invented.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import uuid
from urllib.parse import urlencode
from urllib.request import Request, build_opener

import local_catalog_workspace as catalog

EVIDENCE_FIELDS = ('evaluation_results', 'reasoning_basis', 'origin_address', 'description_map_url')
CORRECTION_FIELDS = ('approved_name','categories','lat','lng','road_address','jibun_address','english_address',
                     'geocoding_success','geocoding_false_stage','is_missing','is_not_selected','tzuyang_review')
BUSINESS_FIELDS = tuple('id trace_id youtube_link status approved_name origin_name naver_name google_name categories lat lng road_address jibun_address english_address geocoding_success is_missing is_not_selected'.split())
FIELDS = BUSINESS_FIELDS + EVIDENCE_FIELDS
SCHEMA = 'local-evaluation-review-v1'
REASONS = {'SOURCE_EVIDENCE_RECOVERED', 'VERIFIED_RESTAURANT', 'NOT_A_RESTAURANT_VISIT',
           'DUPLICATE_RECORD', 'UNRESOLVED_PLACE_IDENTITY', 'INSUFFICIENT_SOURCE_EVIDENCE',
           'VERIFIED_EVIDENCE_CORRECTION'}
q = catalog.quote


def fail(code):
    raise catalog.CatalogError(code)


def require_hash(value):
    if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
        fail('review_hash_invalid')
    return value


def fetch_source(env):
    key = catalog.credentials(env)
    query = urlencode({'select': ','.join(FIELDS), 'status': 'eq.pending', 'order': 'id.asc', 'limit': '1000'})
    request = Request(catalog.HOSTED_URL + '/rest/v1/restaurants?' + query,
                      headers={'apikey': key, 'Authorization': 'Bearer ' + key}, method='GET')
    with build_opener(catalog.NoRedirect).open(request, timeout=30) as response:
        body = response.read(16 * 1024 * 1024 + 1)
    if len(body) > 16 * 1024 * 1024:
        fail('source_limit_exceeded')
    rows = json.loads(body)
    if not isinstance(rows, list) or len(rows) >= 1000:
        fail('source_shape_invalid')
    return rows


def sanitize(rows):
    root = Path(__file__).resolve().parents[3]
    run = subprocess.run(['bun', str(root / 'apps/web/scripts/sanitize-evaluation-evidence.ts')],
                         input=catalog.canonical(rows), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         timeout=30)
    if run.returncode:
        fail('evidence_sanitization_failed')
    return json.loads(run.stdout)


def local_rows(ex):
    projection = ','.join('r.' + field for field in FIELDS)
    return json.loads(ex.capture(f"""BEGIN READ ONLY;
      SELECT COALESCE(json_agg(x ORDER BY id),'[]') FROM (SELECT {projection},
        encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS row_sha256
        FROM public.restaurants r WHERE status='pending') x; COMMIT;""".encode()))


def evidence_plan(local, source):
    by_id = {row['id']: row for row in source}
    if len(by_id) != len(source):
        fail('source_duplicate_identity')
    changes = []
    for row in local:
        origin = by_id.get(row['id'])
        if origin is None:
            continue
        if any(row[field] != origin[field] for field in ('id', 'trace_id', 'youtube_link')):
            fail('source_identity_changed')
        patch = {field: origin[field] for field in EVIDENCE_FIELDS
                 if row[field] is None and origin[field] is not None}
        if patch:
            changes.append({'id': row['id'], 'before_sha256': row['row_sha256'],
                            'patch': patch, 'reason': 'SOURCE_EVIDENCE_RECOVERED',
                            'evidence_sha256': catalog.sha(origin)})
    return changes


def validate_changes(changes, stage):
    if not isinstance(changes, list) or not 0 < len(changes) <= 1000:
        fail('review_changes_invalid')
    seen = set()
    for change in changes:
        if set(change) != {'id', 'before_sha256', 'patch', 'reason', 'evidence_sha256'}:
            fail('review_changes_invalid')
        if str(uuid.UUID(change['id'])) != change['id'] or change['id'] in seen:
            fail('review_identity_invalid')
        seen.add(change['id'])
        require_hash(change['before_sha256'])
        require_hash(change['evidence_sha256'])
        patch = change['patch']
        if not isinstance(patch, dict) or not patch or change['reason'] not in REASONS:
            fail('review_patch_invalid')
        if stage == 'evidence':
            allowed = EVIDENCE_FIELDS + CORRECTION_FIELDS if change['reason']=='VERIFIED_EVIDENCE_CORRECTION' else EVIDENCE_FIELDS
            if set(patch) - set(allowed) or change['reason'] not in {'SOURCE_EVIDENCE_RECOVERED','VERIFIED_EVIDENCE_CORRECTION'}:
                fail('review_patch_invalid')
            if ('lat' in patch) != ('lng' in patch): fail('review_coordinates_invalid')
            if 'lat' in patch:
                if any(not isinstance(patch[f], (float,int)) or isinstance(patch[f],bool) or not math.isfinite(patch[f])
                       for f in ('lat','lng')) or not (-90<=patch['lat']<=90 and -180<=patch['lng']<=180):
                    fail('review_coordinates_invalid')
            if any(f in patch for f in ('road_address','jibun_address','english_address')) and 'lat' not in patch:
                fail('review_coordinates_required')
            for f in ('geocoding_success','is_missing','is_not_selected'):
                if f in patch and not isinstance(patch[f],bool): fail('review_patch_invalid')
        elif stage == 'decision':
            if set(patch) - {'status', 'approved_name'} or patch.get('status') not in {'approved', 'deleted'}:
                fail('review_patch_invalid')
            if change['reason'] == 'SOURCE_EVIDENCE_RECOVERED':
                fail('review_patch_invalid')
            if patch['status'] == 'approved' and (change['reason'] != 'VERIFIED_RESTAURANT'
                    or not isinstance(patch.get('approved_name'), str) or not patch['approved_name'].strip()):
                fail('review_approval_invalid')
        else:
            fail('review_stage_invalid')


def apply_sql(plan, digest):
    validate_changes(plan['changes'], plan['stage'])
    payload = q(catalog.canonical(plan['changes']).decode())
    operation = q(plan['operation_id'])
    # Fixed field allowlist; a plan never supplies SQL identifiers or expressions.
    fields = EVIDENCE_FIELDS + CORRECTION_FIELDS if plan['stage'] == 'evidence' else ('status', 'approved_name')
    assignments = ','.join(f'{field}=CASE WHEN s.patch ? {q(field)} THEN p.{field} ELSE r.{field} END'
                           for field in fields)
    return f"""BEGIN;
      SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
      CREATE TABLE IF NOT EXISTS _tzudong_local.evaluation_review_audit (
        operation_id uuid NOT NULL, restaurant_id uuid NOT NULL,
        stage text NOT NULL CHECK(stage IN ('evidence','decision')),
        preview_sha256 text NOT NULL, before_sha256 text NOT NULL, after_sha256 text NOT NULL,
        evidence_sha256 text NOT NULL, reason_code text NOT NULL, changed_fields text[] NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY(operation_id,restaurant_id));
      ALTER TABLE _tzudong_local.evaluation_review_audit ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON _tzudong_local.evaluation_review_audit FROM PUBLIC,anon,authenticated,service_role;
      DO $audit$ BEGIN
        IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='_tzudong_local.evaluation_review_audit'::regclass
          AND tgname='immutable_evaluation_review') THEN
          CREATE TRIGGER immutable_evaluation_review BEFORE UPDATE OR DELETE
          ON _tzudong_local.evaluation_review_audit FOR EACH ROW
          EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();
          CREATE TRIGGER immutable_evaluation_review_truncate BEFORE TRUNCATE
          ON _tzudong_local.evaluation_review_audit FOR EACH STATEMENT
          EXECUTE FUNCTION admin_catalog_edit.reject_audit_mutation();
        END IF;
      END; $audit$;
      CREATE TEMP TABLE review_input ON COMMIT DROP AS
        SELECT * FROM jsonb_to_recordset({payload}::jsonb)
          AS s(id uuid,before_sha256 text,patch jsonb,reason text,evidence_sha256 text);
      SELECT 1 FROM public.restaurants r JOIN review_input s USING(id) FOR UPDATE OF r;
      DO $guard$ BEGIN
        IF EXISTS(SELECT 1 FROM _tzudong_local.evaluation_review_audit WHERE operation_id={operation}::uuid)
          THEN RAISE EXCEPTION 'review_already_applied_use_readback'; END IF;
        IF (SELECT count(*) FROM review_input) <> (SELECT count(*) FROM public.restaurants r JOIN review_input s USING(id)
          WHERE r.status='pending' AND encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')=s.before_sha256)
          THEN RAISE EXCEPTION 'review_snapshot_changed'; END IF;
        IF EXISTS(SELECT 1 FROM public.restaurants r JOIN review_input s USING(id)
          WHERE s.patch->>'status'='approved' AND (r.evaluation_results IS NULL OR r.reasoning_basis IS NULL
            OR r.geocoding_success IS NOT TRUE OR r.lat IS NULL OR r.lng IS NULL
            OR r.is_missing IS TRUE OR r.is_not_selected IS TRUE
            OR COALESCE(r.jibun_address,r.english_address,'')=''))
          THEN RAISE EXCEPTION 'review_approval_evidence_missing'; END IF;
      END; $guard$;
      UPDATE public.restaurants r SET {assignments},updated_at=clock_timestamp()
        FROM review_input s CROSS JOIN LATERAL jsonb_populate_record(NULL::public.restaurants,s.patch) p
        WHERE r.id=s.id;
      INSERT INTO _tzudong_local.evaluation_review_audit
        (operation_id,restaurant_id,stage,preview_sha256,before_sha256,after_sha256,evidence_sha256,reason_code,changed_fields)
        SELECT {operation}::uuid,r.id,{q(plan['stage'])},{q(digest)},s.before_sha256,
          encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),s.evidence_sha256,s.reason,
          ARRAY(SELECT jsonb_object_keys(s.patch) ORDER BY 1)
          FROM public.restaurants r JOIN review_input s USING(id);
      COMMIT;""".encode()


def readback(ex, plan, digest):
    operation = q(plan['operation_id'])
    result = json.loads(ex.capture(f"""BEGIN READ ONLY;
      SELECT json_build_object('rows',count(*),'matches',COALESCE(bool_and(
        a.preview_sha256={q(digest)} AND a.after_sha256=encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex')),false))
      FROM _tzudong_local.evaluation_review_audit a LEFT JOIN public.restaurants r ON r.id=a.restaurant_id
      WHERE a.operation_id={operation}::uuid; COMMIT;""".encode()))
    if result != {'rows': len(plan['changes']), 'matches': True}:
        fail('review_readback_mismatch')
    return {'operation_id': plan['operation_id'], 'preview_sha256': digest, 'stage': plan['stage'], **result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    source = sub.add_parser('evidence-preview')
    source.add_argument('--source-env', type=Path, required=True)
    decision = sub.add_parser('decision-preview')
    decision.add_argument('--decisions', type=Path, required=True)
    correction = sub.add_parser('correction-preview')
    correction.add_argument('--corrections', type=Path, required=True)
    for name in ('apply', 'readback'):
        command = sub.add_parser(name)
        command.add_argument('--preview-sha256', required=True)
    sub.add_parser('inventory')
    args = parser.parse_args()
    ex, _ = catalog.executor()
    _, state, _ = ex._binding()
    directory = state / 'evaluation-review'
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        fail('review_directory_invalid')
    if args.command in {'evidence-preview','decision-preview','correction-preview','inventory'}:
        local = local_rows(ex)
        if args.command == 'inventory':
            safe = [item['row'] for item in sanitize(local)]
            digest = catalog.sha(safe)
            destination = directory / (digest + '.inventory.json')
            if not destination.exists(): catalog.private_write(destination, safe)
            print(json.dumps({'rows': len(local), 'inventory': str(destination), 'sha256': digest}))
            return
        if args.command == 'evidence-preview':
            raw = fetch_source(args.source_env)
            if catalog.sha(raw) != catalog.sha(fetch_source(args.source_env)):
                fail('source_changed')
            sanitized = sanitize(raw)
            source = [item['row'] for item in sanitized]
            changes = evidence_plan(local, source)
            stage = 'evidence'
            source_digest = catalog.sha(source)
            destination = directory / (source_digest + '.source-evidence.json')
            if not destination.exists(): catalog.private_write(destination, source)
        elif args.command == 'correction-preview':
            corrections = catalog.read_private_json(args.corrections)
            by_id = {row['id']: row for row in local}
            changes=[]
            for correction in corrections:
                if set(correction) != {'id','patch','evidence_sha256'} or correction['id'] not in by_id:
                    fail('review_correction_invalid')
                evidence_digest = require_hash(correction['evidence_sha256'])
                evidence = catalog.read_private_json(directory / (evidence_digest + '.review-evidence.json'))
                if (catalog.sha(evidence) != evidence_digest or evidence.get('restaurant_id') != correction['id']
                        or evidence.get('row_sha256') != by_id[correction['id']]['row_sha256']
                        or evidence.get('patch_sha256') != catalog.sha(correction['patch'])):
                    fail('review_correction_evidence_changed')
                # Shared sanitizer is an assertion here: do not silently alter an operator's patch.
                if sanitize([correction['patch']])[0]['row'] != correction['patch']:
                    fail('review_correction_privacy_invalid')
                changes.append({'id':correction['id'],'before_sha256':by_id[correction['id']]['row_sha256'],
                    'patch':correction['patch'],'reason':'VERIFIED_EVIDENCE_CORRECTION','evidence_sha256':evidence_digest})
            stage='evidence'
        else:
            decisions = catalog.read_private_json(args.decisions)
            by_id = {row['id']: row for row in local}
            changes = []
            for decision in decisions:
                if set(decision) != {'id','status','reason','evidence_sha256','approved_name'} or decision['id'] not in by_id:
                    fail('review_decision_invalid')
                evidence_digest = require_hash(decision['evidence_sha256'])
                evidence = catalog.read_private_json(directory / (evidence_digest + '.review-evidence.json'))
                if (catalog.sha(evidence) != evidence_digest or evidence.get('restaurant_id') != decision['id']
                        or evidence.get('row_sha256') != by_id[decision['id']]['row_sha256']
                        or evidence.get('decision') != decision['status'] or evidence.get('reason') != decision['reason']):
                    fail('review_decision_evidence_changed')
                patch = {'status': decision['status']}
                if decision['status'] == 'approved': patch['approved_name'] = decision['approved_name']
                changes.append({'id':decision['id'], 'before_sha256':by_id[decision['id']]['row_sha256'],
                    'patch':patch, 'reason':decision['reason'], 'evidence_sha256':decision['evidence_sha256']})
            stage = 'decision'
        validate_changes(changes, stage)
        plan = {'schema':SCHEMA, 'project':ex._expected_project(), 'operation_id':str(uuid.uuid4()),
                'stage':stage, 'changes':changes}
        digest = catalog.sha(plan)
        catalog.private_write(directory / (digest + '.preview.json'), plan)
        print(json.dumps({'stage':stage, 'rows':len(changes), 'preview_sha256':digest,
                          'reasons':dict(Counter(change['reason'] for change in changes))}))
        return
    digest = require_hash(args.preview_sha256)
    plan = catalog.read_private_json(directory / (digest + '.preview.json'))
    if catalog.sha(plan) != digest or plan['schema'] != SCHEMA or plan['project'] != ex._expected_project():
        fail('review_preview_binding_invalid')
    if args.command == 'apply':
        # The exact preview hash is the operator's confirmation. No automatic retry.
        ex.capture(apply_sql(plan, digest))
    result = readback(ex, plan, digest)
    path = directory / (digest + '.receipt.json')
    if not path.exists(): catalog.private_write(path, result)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never relay database/provider diagnostics or source values.
        code = str(error) if isinstance(error, catalog.CatalogError) else type(error).__name__
        print(json.dumps({'error': code}), file=sys.stderr)
        sys.exit(1)
