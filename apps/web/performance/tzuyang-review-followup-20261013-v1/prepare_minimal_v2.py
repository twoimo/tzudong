"""Prepare a corrected private draft, preserving all old plans and operating state."""
from collections import Counter
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

PRIVATE_ROOT = Path('/Users/twoimo/.codex/runtime-cache/tzuyang-review-census-20261009')
OLD_PLAN_SHA = 'd0f1df7d8eda50f3145f0adb489aae39544bb2381ce5a43fb9b05455bba036ea'
ORIGINAL_PREPARER = Path('/Users/twoimo/.codex/worktrees/mobile-nav-read-20261012/tzudong/apps/web/performance/tzuyang-review-minimal-20261011/prepare_minimal_v1.py')
TS_PATTERN = re.compile(r'\[\s*ts\s*:[^\[\]]*\]|\(\s*ts\s*:[^()]*\)|\{\s*ts\s*:[^{}]*\}', re.I)


def sha(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def corrected_spec(key, original_spec):
    result = copy.deepcopy(original_spec)
    if key == 'r0999':
        return None, 'PRESERVE_VIDEO_MARKER_DISPLAY_ONLY'
    if key == 'r1300':
        return None, 'SOURCE_EXPANSION_HELD'
    if key == 'r1138':
        if result['replacements'] != [['店家', '가게']]:
            raise ValueError('EXPECTED_SPACING_SPEC_DRIFT')
        result['replacements'] = [['은店家', '은 가게']]
    if key == 'r1294':
        result['replacements'].append(['유튜버가 추천하는', '쯔양이 추천하는'])
    return result, 'CORRECTED_DRAFT' if key in ('r1138', 'r1294') else 'UNCHANGED_PRIOR_DRAFT'


def preserve_markers(before, after):
    if Counter(TS_PATTERN.findall(before)) != Counter(TS_PATTERN.findall(after)):
        raise ValueError('SOURCE_TIMESTAMP_MULTISET_DRIFT')


def prepare():
    spec = importlib.util.spec_from_file_location('original_minimal', ORIGINAL_PREPARER)
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    raw_old = (PRIVATE_ROOT / 'minimal-review-plan-v1.json').read_bytes()
    raw_source = (PRIVATE_ROOT / 'restaurants-review-snapshot-v1.json').read_bytes()
    raw_inputs = (PRIVATE_ROOT / 'source-review-inputs-v1.json').read_bytes()
    raw_specs = (PRIVATE_ROOT / 'minimal-edit-spec-v1.json').read_bytes()
    if (sha(raw_old), sha(raw_source), sha(raw_inputs), sha(raw_specs)) != (OLD_PLAN_SHA, base.SOURCE, base.INPUT, base.SPEC):
        raise ValueError('FROZEN_INPUT_DRIFT')
    old, source, inputs, specs = map(json.loads, (raw_old, raw_source, raw_inputs, raw_specs))
    if len(old['rows']) != 23 or len(specs) != 78 or old['operatingWrites'] != 0:
        raise ValueError('TARGET_COVERAGE_DRIFT')
    jobs = {row['key']: job for job in inputs['requests'] for row in job['content']['rows']}
    rows, observations = [], []
    for previous in old['rows']:
        key = previous['key']
        original = source[int(key[1:])]
        if original['id'] != previous['id'] or original['recordSha256'] != previous['recordSha256'] or sha(original['tzuyang_review']) != previous['beforeSha256']:
            raise ValueError('FROZEN_PREIMAGE_DRIFT')
        next_spec, reason = corrected_spec(key, specs[key])
        if next_spec is None:
            observations.append({'key': key, 'decision': reason, 'applyReady': False})
            continue
        after = base.edit(original, next_spec, jobs[key])
        preserve_markers(original['tzuyang_review'], after)
        next_row = {**previous, 'after': after, 'afterSha256': sha(after), 'applyReady': False}
        if reason == 'UNCHANGED_PRIOR_DRAFT' and next_row['afterSha256'] != previous['afterSha256']:
            raise ValueError('UNRELATED_DRAFT_CHANGED')
        rows.append(next_row)
        observations.append({'key': key, 'decision': reason, 'beforeSha256': previous['beforeSha256'], 'oldAfterSha256': previous['afterSha256'], 'afterSha256': sha(after), 'timestampMultisetPreserved': True, 'applyReady': False})
    if len(rows) != 21 or sum(row['decision'] == 'CORRECTED_DRAFT' for row in observations) != 2:
        raise ValueError('CORRECTION_COVERAGE_DRIFT')
    result = {'version': 2, 'sourceSha256': base.SOURCE, 'inputSha256': base.INPUT, 'originalSpecSha256': base.SPEC,
              'oldPrivatePlanSha256': OLD_PLAN_SHA, 'modelCensusRepeated': False, 'operatingWrites': 0,
              'guardedPreviewApplyReadbackRequired': True, 'originalOperationReconciliationRequired': True,
              'freshCurrentPreimagesRequired': True, 'newOperationIdCreated': False, 'rows': rows}
    private_bytes = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode()
    private_output = PRIVATE_ROOT / 'minimal-review-plan-v2.json'
    public_output = Path(__file__).parent / 'minimal-plan-correction-v2.json'
    if private_output.exists() or public_output.exists():
        raise ValueError('CORRECTION_OUTPUT_EXISTS')
    with os.fdopen(os.open(private_output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as f:
        f.write(private_bytes)
    public = {key: value for key, value in result.items() if key != 'rows'}
    public.update({'privatePlanSha256': sha(private_bytes), 'priorDrafts': 23, 'stagedDrafts': 21,
                   'unchangedDrafts': 19, 'correctedDrafts': 2, 'sourcePreservedNoContentWrite': 1,
                   'sourceExpansionHeld': 1, 'editorialDrafts': sum(row['kind'] == 'editorial' for row in rows),
                   'sourceCorrectionDrafts': sum(row['kind'] == 'source_correction' for row in rows),
                   'preservedAdminEdits': 47, 'needsContext': 8, 'applyReady': 0, 'observations': observations})
    with public_output.open('x') as f:
        json.dump(public, f, ensure_ascii=False, indent=2)
        f.write('\n')
    return {key: public[key] for key in ['stagedDrafts', 'correctedDrafts', 'unchangedDrafts', 'sourcePreservedNoContentWrite', 'sourceExpansionHeld', 'applyReady', 'operatingWrites', 'privatePlanSha256']}


if __name__ == '__main__':
    print(json.dumps(prepare()))
