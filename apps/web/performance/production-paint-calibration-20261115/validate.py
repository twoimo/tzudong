#!/usr/bin/env python3
"""Independent local validation. Never invokes/imports the JS analyzer or a browser."""
import argparse
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path

VERSION = 'production-paint-calibration'
URL = 'https://www.tzudong.app/?__perf=paint-calibration'
TOOLS = ['protocol.json', 'README.md', 'snapshot.schema.json', 'evidence.mjs', 'record.mjs', 'analyze.mjs', 'validate.py', 'evidence.test.mjs']
SOURCES = ['apps/web/lib/performance/paint-calibration-diagnostic.ts', 'apps/web/lib/performance/paint-calibration-request.ts', 'apps/web/lib/performance/paint-calibration-milestones.ts', 'apps/web/lib/performance/initial-load-milestones.ts']
OUTCOMES = ['captured', 'collector-unavailable', 'blocked-access', 'capture-unavailable', 'invalid-diagnostic-payload', 'not-executed-access-block']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected), 'Unexpected/missing metadata keys')


def finite(value):
    return type(value) in (float, int) and math.isfinite(value)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def path_at(root, relative):
    require(isinstance(relative, str) and not relative.startswith('/') and '\\' not in relative and all(p not in ('', '.', '..') for p in relative.split('/')), 'Unsafe path')
    result = root
    for part in relative.split('/'):
        result = result / part
        require(not result.is_symlink(), 'Artifact symlink rejected')
    return result


def raw_at(root, relative):
    return path_at(root, relative).read_bytes()


def read_json(root, relative):
    def unique_pairs(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, 'Duplicate JSON key rejected')
            value[key] = item
        return value
    return json.loads(raw_at(root, relative), object_pairs_hook=unique_pairs)


def descriptor(root, relative):
    raw = raw_at(root, relative)
    return {'path': relative, 'sha256': digest(raw), 'bytes': len(raw)}


def timestamp(value):
    require(isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value), 'Timestamp format')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def shape(value, schema, definitions):
    if '$ref' in schema:
        return shape(value, definitions[schema['$ref'].split('/')[-1]], definitions)
    if 'anyOf' in schema:
        return any(shape(value, candidate, definitions) for candidate in schema['anyOf'])
    if 'const' in schema and (value != schema['const'] or (type(schema['const']) is bool and type(value) is not bool) or (finite(schema['const']) and not finite(value))):
        return False
    if 'enum' in schema and value not in schema['enum']:
        return False
    kind = schema.get('type')
    if kind == 'null':
        return value is None
    if kind == 'boolean':
        return type(value) is bool
    if kind in ('number', 'integer'):
        return finite(value) and (kind != 'integer' or value == int(value)) and schema.get('minimum', -math.inf) <= value <= schema.get('maximum', math.inf)
    if kind == 'string':
        return isinstance(value, str) and len(value) <= schema.get('maxLength', math.inf) and (not schema.get('pattern') or re.search(schema['pattern'], value) is not None)
    if kind == 'array':
        return isinstance(value, list) and schema.get('minItems', 0) <= len(value) <= schema.get('maxItems', math.inf) and all(shape(v, schema['items'], definitions) for v in value)
    if kind == 'object':
        return isinstance(value, dict) and set(value) == set(schema['required']) and all(shape(v, schema['properties'][k], definitions) for k, v in value.items())
    return True


def event_window(time):
    return 'invalid' if not finite(time) else 'primary' if time <= 20000 else 'tail' if time <= 30000 else 'outside'


def consistency(s):
    issues = []
    c = s['capture']
    if not finite(c['observerSetupMs']) or c['observerSetupMs'] > 20000:
        issues.append('OBSERVER_SETUP_NOT_PRIMARY')
    if not finite(c['primaryCheckpointAtMs']) or c['primaryCheckpointAtMs'] < 20000 or not finite(c['finalizedAtMs']) or c['finalizedAtMs'] < 30000:
        issues.append('BOUNDARY_EARLY_OR_UNKNOWN')
    if s['primary']['observedAtMs'] != c['primaryCheckpointAtMs'] or not finite(s['late']['observedAtMs']) or s['late']['observedAtMs'] < 30000 or not finite(c['finalizedAtMs']) or s['late']['observedAtMs'] > c['finalizedAtMs']:
        issues.append('BOUNDARY_TIMESTAMP_MISMATCH')
    for name, cutoff in [('primary', 20000), ('late', 30000)]:
        segment = s[name]
        for kind, array in [('paint', 'paintEntries'), ('largest-contentful-paint', 'lcpEntries'), ('longtask', 'longTasks')]:
            stats = segment['observerStats'][kind]
            if stats['callbackEntryCount'] + stats['drainedEntryCount'] != stats['receivedEntryCount'] or stats['acceptedEntryCount'] > stats['receivedEntryCount'] or len(segment[array]) > stats['receivedEntryCount']:
                issues.append(f'{name}:{kind}:COUNTERS')
            if stats['droppedByCapCount'] > 0 and not segment['entryCapReached']:
                issues.append(f'{name}:{kind}:CAP_FLAG')
            for entry in segment[array]:
                accepted = entry['startTimeMs'] <= cutoff and (kind != 'paint' or entry['name'] != 'other') and (kind != 'longtask' or entry['endTimeMs'] <= cutoff)
                if entry['entryWindow'] != event_window(entry['startTimeMs']) or entry['accepted'] != accepted or not finite(entry['receivedAtMs']) or entry['receivedAtMs'] + 1 < entry['startTimeMs']:
                    issues.append(f'{name}:{kind}:ENTRY_BOUNDARY')
                if kind == 'longtask' and abs(entry['endTimeMs'] - entry['startTimeMs'] - entry['durationMs']) > .01:
                    issues.append(f'{name}:LONG_TASK_ARITHMETIC')
        if any(e['entryWindow'] != event_window(e['startTimeMs']) for e in segment['paintTimeline']['entries']):
            issues.append(f'{name}:TIMELINE_BOUNDARY')
        ctx = segment['context']
        if ctx['focusSampleCount'] != sum(ctx[k] for k in ['focusTrueSampleCount', 'focusFalseSampleCount', 'focusUnknownSampleCount']):
            issues.append(f'{name}:FOCUS_COUNTERS')
    f = s['primary']['frames']
    if f['requestedCount'] > 40 or f['completedCount'] != len(f['samples']) or f['completedCount'] + int(f['pendingAtPrimaryEnd']) > f['requestedCount']:
        issues.append('FRAME_COUNTERS')
    for entry in f['samples']:
        if not finite(entry['callbackAtMs']) or entry['callbackAtMs'] + 1 < entry['requestedAtMs'] or entry['withinPrimary'] != (entry['callbackAtMs'] <= 20000):
            issues.append('FRAME_SAMPLE')
    if f['samples'] and (not finite(f['maxDelayMs']) or any(not finite(e['callbackAtMs']) for e in f['samples']) or abs(f['maxDelayMs'] - max(max(0, e['callbackAtMs'] - e['requestedAtMs']) for e in f['samples'])) > .01):
        issues.append('FRAME_MAX_DELAY')
    if any(finite(v) and v > 20000 for group in s['primary']['milestones'].values() for v in group.values()):
        issues.append('MILESTONE_OUTSIDE_PRIMARY')
    return sorted(set(issues))


def first_time(entries):
    return min((e['startTimeMs'] for e in entries), default=None)


def latest(entries):
    return max(enumerate(entries), key=lambda pair: (pair[1]['startTimeMs'], pair[0]))[1] if entries else None


def paint_signal(s, name):
    primary = [e for e in s['primary']['paintEntries'] if e['name'] == name]
    late = [e for e in s['late']['paintEntries'] if e['name'] == name]
    all_entries = primary + late
    accepted = [e for e in primary if e['accepted'] and e['entryWindow'] == 'primary']
    delayed = [e for e in late if e['accepted'] and e['entryWindow'] == 'primary']
    tail = [e for e in all_entries if e['entryWindow'] == 'tail']
    timelines = [[e for e in s[segment]['paintTimeline']['entries'] if e['name'] == name and finite(e['startTimeMs'])] for segment in ['primary', 'late']]
    all_timeline = timelines[0] + timelines[1]
    unmatched = [e for e in all_timeline if not any(abs(o['startTimeMs'] - e['startTimeMs']) <= 1 for o in all_entries)]
    classifications = []
    for present, label in [(accepted, 'observed-by-primary-checkpoint'), (any(e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] > 20000 for e in all_entries), 'primary-window-entry-delivered-after-nominal-cutoff'), (delayed, 'primary-window-entry-delivered-after-checkpoint'), (tail, 'tail-window-entry-observed'), (unmatched, 'paint-timeline-without-corresponding-observer-entry')]:
        if present:
            classifications.append(label)
    if not all_entries and not all_timeline:
        classifications.append('no-entry-observed-in-either-source')
    if all_entries and not accepted and not delayed and not tail:
        classifications.append('only-outside-window-observer-entry')
    return {'primaryObserverMs': first_time(accepted), 'delayedPrimaryObserverMs': first_time(delayed), 'tailObserverMs': first_time(tail), 'deliveredByNominalCutoffMs': first_time([e for e in all_entries if e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] <= 20000]), 'primaryTimelineMs': first_time(timelines[0]), 'finalTimelineMs': first_time(timelines[1]), 'primaryWindowDeliveriesAfterNominalCutoffCount': sum(e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] > 20000 for e in all_entries), 'timelineOnlyEventTimesMs': sorted(set(e['startTimeMs'] for e in unmatched)), 'classifications': classifications}


def lcp_signal(s):
    primary = [e for e in s['primary']['lcpEntries'] if e['accepted'] and e['entryWindow'] == 'primary']
    delayed = [e for e in s['late']['lcpEntries'] if e['accepted'] and e['entryWindow'] == 'primary']
    all_entries = s['primary']['lcpEntries'] + s['late']['lcpEntries']
    tail = [e for e in all_entries if e['entryWindow'] == 'tail']
    classes = [label for entries, label in [(primary, 'observed-by-primary-checkpoint'), (any(e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] > 20000 for e in all_entries), 'primary-window-entry-delivered-after-nominal-cutoff'), (delayed, 'primary-window-entry-delivered-after-checkpoint'), (tail, 'tail-window-entry-observed')] if entries]
    if not all_entries:
        classes.append('no-observer-candidate')
    if all_entries and not primary and not delayed and not tail:
        classes.append('only-outside-window-observer-entry')
    return {'primaryCandidate': latest(primary), 'delayedPrimaryCandidate': latest(delayed), 'tailCandidate': latest(tail), 'deliveredByNominalCutoffCandidate': latest([e for e in all_entries if e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] <= 20000]), 'primaryLatestCardCandidateCount': sum(e['region'] == 'desktop-latest-card' for e in primary), 'lateDeliveredLatestCardCandidateCount': sum(e['region'] == 'desktop-latest-card' for e in s['late']['lcpEntries']), 'primaryWindowDeliveriesAfterNominalCutoffCount': sum(e['entryWindow'] == 'primary' and finite(e['receivedAtMs']) and e['receivedAtMs'] > 20000 for e in all_entries), 'classifications': classes}


def classify(s, plan, receipt, reference):
    problems, limits = [], []
    if s['binding']['gitSha'] != plan['sourceSha'] or s['binding']['hostname'] != 'www.tzudong.app' or receipt['observedUrl'] != URL:
        problems.append('SOURCE_OR_URL_BINDING')
    nav = s['navigation']
    if not nav or nav['type'] != 'navigate' or nav['redirectCount'] != 0 or nav['activationStartMs'] not in (None, 0):
        problems.append('NAVIGATION_CONTEXT')
    viewport = s['viewport']
    if any(not finite(v) or v <= 0 for v in viewport['initial'].values()):
        problems.append('VIEWPORT_UNAVAILABLE')
    if viewport['initial'] != viewport['primary'] or viewport['initial'] != viewport['final']:
        problems.append('VIEWPORT_CHANGED_WITHIN_VISIT')
    if reference is not None and viewport['initial'] != reference:
        problems.append('VIEWPORT_DIFFERS_FROM_REFERENCE')
    for key, supported in s['support'].items():
        if not supported:
            limits.append(f'UNSUPPORTED:{key}')
    for segment_name in ['primary', 'late']:
        segment = s[segment_name]
        c = segment['context']
        for bad, label in [(not c['contextUnchanged'], 'URL_CONTEXT_CHANGED'), (c['visibilityAtSetup'] != 'visible' or c['visibilityAtRead'] != 'visible' or c['firstHiddenAtMs'] is not None, 'VISIBILITY_CHANGED_OR_HIDDEN'), (c['trustedInputCount'] > 0 or c['firstTrustedInputAtMs'] is not None, 'TRUSTED_INPUT_OBSERVED'), (c['resizeCount'] > 0 or c['firstResizeAtMs'] is not None, 'RESIZE_OBSERVED'), (c['prerenderingAtSetup'] or c['wasDiscarded'], 'PRERENDERED_OR_DISCARDED_CONTEXT')]:
            if bad:
                problems.append(label)
        if segment['entryCapReached']:
            limits.append(f'{segment_name}:ENTRY_CAP')
        if segment['paintTimeline']['capReached'] or segment['paintTimeline']['readError']:
            limits.append(f'{segment_name}:TIMELINE_INCOMPLETE')
        limits.extend(f'{segment_name}:{error}' for error in segment['errors'])
        for kind, stats in segment['observerStats'].items():
            if not stats['registered']:
                limits.append(f'{segment_name}:{kind}:NOT_REGISTERED')
            if stats['invalidEntryCount'] or stats['handlerErrorCount']:
                limits.append(f'{segment_name}:{kind}:ENTRY_OR_HANDLER_ERRORS')
    f = s['primary']['frames']
    within_primary_count = sum(e['withinPrimary'] and finite(e['callbackAtMs']) and e['callbackAtMs'] <= 20000 for e in f['samples'])
    frame_class = 'unsupported' if not s['support']['animationFrame'] else 'no-request-observed' if f['requestedCount'] == 0 else ('pending-with-no-completion' if f['pendingAtPrimaryEnd'] else 'requested-with-no-completion') if f['completedCount'] == 0 else 'frame-callbacks-only-after-nominal-cutoff' if within_primary_count == 0 else 'primary-progress-with-pending-at-checkpoint' if f['pendingAtPrimaryEnd'] else 'primary-frame-callback-progress-observed'
    pairs = {
        'desktopImplementation': ('criticalPath', 'desktopImplementationLoadStarted', 'desktopImplementationLoadReady'),
        'mobileImplementation': ('criticalPath', 'mobileImplementationLoadStarted', 'mobileImplementationLoadReady'),
        'latestRows': ('criticalPath', 'latestQueryStarted', 'latestRestaurantRowsReady'),
        'latestBeforeKpi': ('criticalPath', 'latestRestaurantRowsReady', 'latestKpiStarted'),
        'latestKpi': ('criticalPath', 'latestKpiStarted', 'latestKpiReady'),
        'latestSort': ('criticalPath', 'latestKpiReady', 'latestSortReady'),
        'latestCardCommitAfterSort': ('criticalPath', 'latestSortReady', 'latestFirstCardCommitted'),
        'homeDataFetch': ('initialLoad', 'dataQueryStarted', 'dataFetchCompleted'),
        'homeDataMerge': ('initialLoad', 'dataFetchCompleted', 'dataMergeCompleted'),
        'homeFirstIndexQueue': ('initialLoad', 'dataReady', 'clusterIndexStarted'),
    }
    durations = {}
    for name, (group, start, end) in pairs.items():
        a, b = s['primary']['milestones'][group][start], s['primary']['milestones'][group][end]
        durations[name] = round(b - a, 3) if finite(a) and finite(b) and b >= a else None
        if finite(a) and finite(b) and b < a:
            limits.append(f'MILESTONE_ORDER:{name}')
    return {'actualViewport': viewport, 'contextProblems': sorted(set(problems)), 'consistencyProblems': consistency(s), 'limitations': sorted(set(limits)),
            'boundaries': {key: s['capture'][key] for key in ['observerSetupMs', 'primaryCheckpointAtMs', 'finalizedAtMs']},
            'fp': paint_signal(s, 'first-paint'), 'fcp': paint_signal(s, 'first-contentful-paint'), 'lcp': lcp_signal(s),
            'frame': {'classification': frame_class, **{key: f[key] for key in ['requestedCount', 'completedCount', 'skippedPendingCount', 'pendingAtPrimaryEnd', 'maxDelayMs']}, 'withinPrimaryCompletedCount': within_primary_count, 'afterNominalCutoffCompletedCount': sum(finite(e['callbackAtMs']) and e['callbackAtMs'] > 20000 for e in f['samples']), 'pendingDurationAtCheckpointMs': round(s['capture']['primaryCheckpointAtMs'] - f['pendingRequestedAtMs'], 3) if f['pendingAtPrimaryEnd'] and finite(f['pendingRequestedAtMs']) and finite(s['capture']['primaryCheckpointAtMs']) else None},
            'focusAndVisibility': {'primary': s['primary']['context'], 'final': s['late']['context']}, 'phaseDurationsMs': durations, 'primaryReadiness': s['primary']['readiness'],
            'costMs': {'primaryObserver': s['primary']['observerWorkMs'], 'lateObserver': s['late']['observerWorkMs'], 'frameProbe': f['workMs'], 'checkpointReadback': s['primary']['readbackWorkMs']}}


def validate(root, repository, map_sha, protocol_sha):
    require(re.fullmatch('[a-f0-9]{64}', map_sha) and re.fullmatch('[a-f0-9]{64}', protocol_sha), 'Detached hashes required')
    require(digest(raw_at(root, 'artifact-map.json')) == map_sha and digest(raw_at(root, 'protocol.json')) == protocol_sha, 'Detached seal mismatch')
    artifact_map = read_json(root, 'artifact-map.json')
    keys(artifact_map, ['schemaVersion', 'protocolSha256', 'items'])
    require(artifact_map['schemaVersion'] == VERSION + '.artifact-map.v1' and artifact_map['protocolSha256'] == protocol_sha, 'Artifact map binding')
    plan = read_json(root, 'inputs/plan.json')
    keys(plan, ['schemaVersion', 'frozenAtUtc', 'sourceSha', 'sourceTree', 'protocolSha256', 'browserSurface', 'browserVersion', 'plannedOrdinals', 'identity', 'sourceFiles', 'toolFiles'])
    require(plan['schemaVersion'] == VERSION + '.plan.v1' and plan['protocolSha256'] == protocol_sha and plan['plannedOrdinals'] == [1, 2, 3] and plan['browserSurface'] == 'cua-cloud-cdp' and plan['browserVersion'] is None, 'Plan binding')
    require(re.fullmatch('[a-f0-9]{40}', plan['sourceSha']) and re.fullmatch('[a-f0-9]{40}', plan['sourceTree']), 'Source/tree SHA')
    keys(plan['identity'], ['providerIdentity', 'healthIdentity'])
    p, h = plan['identity']['providerIdentity'], plan['identity']['healthIdentity']
    keys(p, ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'projectId', 'target', 'state'])
    keys(h, ['observedAtUtc', 'observedVia', 'gitSha', 'deploymentId', 'ok'])
    require(p['gitSha'] == h['gitSha'] == plan['sourceSha'] and p['deploymentId'] == h['deploymentId'] and re.fullmatch('dpl_[A-Za-z0-9]+', p['deploymentId']) and re.fullmatch('prj_[A-Za-z0-9]+', p['projectId']), 'Provider/health identity mismatch')
    require(p['observedVia'] in ['vercel-dashboard', 'vercel-tool', 'vercel-cli'] and h['observedVia'] == 'cua-public-health' and p['target'] == 'production' and p['state'] == 'READY' and h['ok'] is True, 'Provider/health context')
    require(timestamp(plan['frozenAtUtc']) >= max(timestamp(p['observedAtUtc']), timestamp(h['observedAtUtc'])), 'Plan precedes identity')
    require(plan['toolFiles'] == [descriptor(root, path) for path in TOOLS] and plan['sourceFiles'] == [descriptor(repository, path) for path in SOURCES], 'Frozen source/tool bytes changed')
    schema = read_json(root, 'snapshot.schema.json')
    inventory = ['inputs/plan.json']
    visits = []
    previous = None
    for ordinal in [1, 2, 3]:
        prefix = f'inputs/{ordinal:02}'
        receipt = read_json(root, prefix + '.receipt.json')
        keys(receipt, ['schemaVersion', 'ordinal', 'startedAtUtc', 'observedAtUtc', 'observedUrl', 'outcome', 'snapshot'])
        require(receipt['schemaVersion'] == VERSION + '.receipt.v1' and receipt['ordinal'] == ordinal and receipt['outcome'] in OUTCOMES, 'Receipt ordinal/version/outcome')
        require(timestamp(receipt['observedAtUtc']) >= timestamp(plan['frozenAtUtc']) and receipt['observedUrl'] in [URL, 'other', 'not-navigated'], 'Receipt context')
        if previous:
            require(timestamp(receipt['observedAtUtc']) >= timestamp(previous['observedAtUtc']), 'Receipts out of planned order')
        unattempted = receipt['outcome'] == 'not-executed-access-block'
        if unattempted:
            require(receipt['startedAtUtc'] is None and receipt['observedUrl'] == 'not-navigated' and any(v['receipt']['outcome'] == 'blocked-access' for v in visits), 'Unexecuted attempt requires access block')
        else:
            require(timestamp(plan['frozenAtUtc']) <= timestamp(receipt['startedAtUtc']) <= timestamp(receipt['observedAtUtc']), 'Capture clock order')
            if previous:
                require(timestamp(receipt['startedAtUtc']) >= timestamp(previous['observedAtUtc']), 'Overlapping/out-of-order visits')
        inventory.append(prefix + '.receipt.json')
        snapshot = None
        if receipt['outcome'] == 'captured':
            require(receipt['snapshot'] == descriptor(root, prefix + '.snapshot.json'), 'Raw bytes differ from receipt')
            require(len(raw_at(root, prefix + '.snapshot.json')) <= 262144, 'Payload cap')
            snapshot = read_json(root, prefix + '.snapshot.json')
            require(shape(snapshot, schema, schema['$defs']), 'Snapshot violates fixed numeric/enum shape')
            inventory.append(prefix + '.snapshot.json')
        else:
            require(receipt['snapshot'] is None and not path_at(root, prefix + '.snapshot.json').exists(), 'Unavailable attempt cannot carry a snapshot')
        visits.append({'ordinal': ordinal, 'receipt': receipt, 'snapshot': snapshot})
        previous = receipt
    actual_inputs = sorted(str(p.relative_to(root)) for p in (root / 'inputs').rglob('*') if p.is_file() or p.is_symlink())
    require(actual_inputs == sorted(inventory), 'Unexpected/missing input artifact')
    require(artifact_map['items'] == [descriptor(root, path) for path in sorted(TOOLS + inventory)], 'Artifact map inventory/bytes changed')
    reference = next((v['snapshot']['viewport']['initial'] for v in visits if v['snapshot']), None)
    expected = {'schemaVersion': VERSION + '.analysis.v1', 'status': 'diagnostic-only-no-performance-admission', 'artifactMapSha256': map_sha, 'protocolSha256': protocol_sha, 'sourceSha': plan['sourceSha'], 'plannedVisitCount': 3, 'retainedReceiptCount': 3, 'retainedSnapshotCount': sum(v['snapshot'] is not None for v in visits), 'viewportReference': reference,
                'visits': [{'ordinal': v['ordinal'], 'outcome': v['receipt']['outcome'], 'snapshotSha256': v['receipt']['snapshot']['sha256'] if v['snapshot'] else None, 'observation': classify(v['snapshot'], plan, v['receipt'], reference) if v['snapshot'] else None} for v in visits],
                'admission': {'performanceComparisonCount': 0, 'fieldAdmissionCount': 0, 'g003AdmissionCount': 0, 'lighthouseAdmissionCount': 0, 'legacyTtiMs': None},
                'unknowns': ['No causal attribution from focus/frame correlation alone.', 'Paint timeline does not replace observer FCP.', 'Region is bounded delivery-time context, not a stable DOM identity.', 'No controlled cold-cache, CPU, network, mobile or human-population inference.', 'Critical paths can overlap; their durations must not be summed.', 'Earlier series remain unchanged.']}
    actual = read_json(root, 'analysis.json')
    require(actual == expected, 'Independent classification/scalar mismatch')
    return {'schemaVersion': VERSION + '.validation.v1', 'status': 'evidence-and-diagnostic-classifications-verified', 'artifactMapSha256': map_sha, 'protocolSha256': protocol_sha, 'analysisSha256': digest(raw_at(root, 'analysis.json')), 'retainedArtifactCount': len(artifact_map['items']), 'retainedReceiptCount': 3, 'retainedSnapshotCount': expected['retainedSnapshotCount'], 'admission': expected['admission']}


def main():
    parser = argparse.ArgumentParser()
    for name in ['root', 'repository', 'protocol-sha256', 'artifact-map-sha256']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    try:
        result = validate(Path(args.root), Path(args.repository), args.artifact_map_sha256, args.protocol_sha256)
        with (Path(args.root) / 'validated.json').open('x', encoding='utf-8') as output:
            output.write(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    except (ValueError, TypeError, KeyError, OSError, json.JSONDecodeError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
