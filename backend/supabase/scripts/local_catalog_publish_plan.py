#!/usr/bin/env python3
"""Prepare selected working-catalog changes using GET-only hosted revalidation.

This command never applies a plan. An atomic hosted writer, current release
evidence, operator confirmation, readback and audit remain separate requirements.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import uuid

import local_catalog_workspace as catalog

FIELDS = tuple(field for field in catalog.REVIEW_FIELDS if field != 'status')
COORDINATES = {'lat', 'lng'}
ADDRESSES = {'road_address', 'jibun_address', 'english_address'}
LOCATION_FIELDS = COORDINATES | ADDRESSES


def selection_rows(value):
    if not isinstance(value, list) or len(value) > catalog.MAX_ROWS:
        raise catalog.CatalogError('publish_selection_invalid')
    selected = {}
    for item in value:
        if not isinstance(item, dict) or set(item) != {'id', 'fields'}:
            raise catalog.CatalogError('publish_selection_invalid')
        identifier, fields = item['id'], item['fields']
        try:
            valid_id = isinstance(identifier, str) and str(uuid.UUID(identifier)) == identifier
        except (ValueError, AttributeError):
            valid_id = False
        if (not valid_id or identifier in selected or not isinstance(fields, list)
                or not fields or any(not isinstance(field, str) or field not in FIELDS for field in fields)
                or len(fields) != len(set(fields))):
            raise catalog.CatalogError('publish_selection_invalid')
        chosen = set(fields)
        if chosen & LOCATION_FIELDS and not LOCATION_FIELDS <= chosen:
            raise catalog.CatalogError('publish_location_selection_incomplete')
        selected[identifier] = sorted(chosen)
    return [{'id': identifier, 'fields': selected[identifier]} for identifier in sorted(selected)]


def valid_value(field, value):
    if field in COORDINATES:
        bound = 90 if field == 'lat' else 180
        return type(value) in (int, float) and math.isfinite(value) and -bound <= value <= bound
    if field == 'categories':
        return (isinstance(value, list) and len(value) <= 30
                and all(isinstance(item, str) and 0 < len(item) <= 64 and item == item.strip() for item in value))
    if field == 'approved_name':
        return isinstance(value, str) and 0 < len(value) <= 300 and value == value.strip()
    return value is None or (isinstance(value, str) and len(value) <= (20000 if field == 'tzuyang_review' else 1000))


def build_plan(baseline, local, hosted, selection):
    """Three-way comparison; never substitute local rows for hosted rows."""
    selected = selection_rows(selection)
    before = {row['id']: row for row in catalog.normalize(baseline)}
    remote = {row['id']: row for row in catalog.normalize(hosted)}
    # Reuse the local projection/duplicate validation, which allows local hold state.
    catalog.review_changes(baseline, local)
    current = {row['id']: row for row in local}
    results = []
    for item in selected:
        identifier, fields = item['id'], item['fields']
        old, new, live = before.get(identifier), current.get(identifier), remote.get(identifier)
        if old is None or new is None or live is None:
            results.append({'id': identifier, 'state': 'blocked', 'reason': 'record_membership_changed',
                            'selected_fields': fields, 'patch': {}})
            continue
        if (old['status'] not in {'approved', 'pending'} or new['status'] != old['status']
                or live['status'] != old['status']):
            results.append({'id': identifier, 'state': 'blocked', 'reason': 'status_review_required',
                            'selected_fields': fields, 'patch': {}})
            continue
        comparisons, patch, conflict = {}, {}, False
        for field in fields:
            previous, desired, observed = old[field], new[field], live[field]
            if not valid_value(field, desired):
                state = 'invalid_local_value'
                conflict = True
            elif desired == previous:
                state = 'unchanged_local'
            elif desired == observed:
                state = 'already_current'
            elif observed == previous:
                state = 'candidate'
                patch[field] = desired
            else:
                state = 'conflict'
                conflict = True
            comparisons[field] = {'state': state, 'baseline': previous, 'local': desired, 'hosted': observed}
        # Coordinates are an atomic pair; selected address changes must carry the
        # pair even when one coordinate was unchanged. Never overwrite a remote
        # change merely to complete that pair.
        if patch.keys() & LOCATION_FIELDS:
            for field in LOCATION_FIELDS:
                if live[field] != new[field] and comparisons[field]['state'] != 'candidate':
                    conflict = True
                    comparisons[field]['state'] = 'location_conflict'
            for field in COORDINATES:
                patch[field] = new[field]
        results.append({'id': identifier,
                        'state': 'blocked' if conflict else 'candidate' if patch else 'no_change',
                        'reason': 'field_review_required' if conflict else None,
                        'selected_fields': fields, 'comparisons': comparisons,
                        'patch': {} if conflict else patch,
                        'expected_hosted_review_values': {field: live[field] for field in catalog.REVIEW_FIELDS}})
    return {'selection': selected, 'records': results,
            'counts': {state: sum(row['state'] == state for row in results)
                       for state in ('candidate', 'blocked', 'no_change')},
            'safe_to_apply': False, 'hosted_atomic_apply_required': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-sha256', required=True)
    parser.add_argument('--selection-file', type=Path, required=True,
                        help='Owner-only JSON array of {id, fields}; [] selects nothing')
    parser.add_argument('--source-env', type=Path, required=True)
    args = parser.parse_args()
    selected = selection_rows(catalog.read_private_json(args.selection_file))
    ex, _ = catalog.executor()
    _, state, _ = ex._binding()
    directory = state / 'working-catalog'
    if directory.is_symlink() or not directory.is_dir() or directory.stat().st_mode & 0o077:
        raise catalog.CatalogError('workspace_permissions_invalid')
    baseline = catalog.load_baseline(directory, args.baseline_sha256, ex._expected_project())
    local = catalog.local_state(ex)
    key = catalog.credentials(args.source_env)
    hosted = catalog.fetch(key)
    if catalog.sha(hosted) != catalog.sha(catalog.fetch(key)):
        raise catalog.CatalogError('source_changed')
    if catalog.local_state(ex)['digest'] != local['digest']:
        raise catalog.CatalogError('local_changed')
    plan = {'schema': 'local-catalog-publish-review-v1', 'project': ex._expected_project(),
            'source': catalog.HOSTED_PROJECT_REF, 'baseline_sha256': args.baseline_sha256,
            'local_digest': local['digest'], 'hosted_projection_sha256': catalog.sha(hosted),
            'hosted_read_semantics': 'two_matching_projected_gets',
            **build_plan(baseline['rows'], local['rows'], hosted, selected)}
    digest = catalog.sha(plan)
    destination = directory / (digest + '.publish-review.json')
    if destination.exists():
        if catalog.read_private_json(destination) != plan:
            raise catalog.CatalogError('publish_review_file_conflict')
    else:
        catalog.private_write(destination, plan)
    print(json.dumps({'schema': plan['schema'], 'publish_review_sha256': digest,
                      'counts': plan['counts'], 'safe_to_apply': False,
                      'hosted_atomic_apply_required': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, catalog.CatalogError) else 'publish_review_failed'
        print(json.dumps({'error': code}), file=sys.stderr)
        raise SystemExit(1)
