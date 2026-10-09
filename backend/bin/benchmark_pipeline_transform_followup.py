#!/usr/bin/env python3
"""Two paired real-corpus transform conditions; no provider or database I/O.

Preparation is untimed. A holdout video and all its original input files are
absent during priming, then added as read-only symlinks. Failure is a real
EISDIR error at each implementation's native output boundary, not a fake raise:
append-open for baseline; fsynced temporary-file replacement for candidate.
"""
import argparse
import builtins
from contextlib import contextmanager, redirect_stdout
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import resource
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
import benchmark_pipeline_transform as base
from analyze_pipeline_performance import compare

ROOT = base.ROOT
SCRIPT = Path(__file__).resolve()
INPUT_DIRS = {
    'crawling/meta': base.DATA / 'restaurant-crawling/data/tzuyang/meta',
    **{'evaluation/evaluation/' + name: base.DATA / 'restaurant-evaluation/data/tzuyang/evaluation' / name
       for name in ('rule_results', 'laaj_results', 'notSelection')},
}
SCENARIOS = ('new-input', 'failure-restart')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def outputs(path):
    records = {}
    lines = 0
    with path.open('rb') as source:
        for line in source:
            if not line.strip():
                continue
            row = json.loads(line)
            trace = row['trace_id']
            if trace in records:
                raise ValueError('duplicate_output_identity')
            records[trace] = row
            lines += 1
    encoded = json.dumps(records, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return {'records': lines, 'outputSha256': hashlib.sha256(encoded).hexdigest(),
            'outputFileSha256': sha(path), 'outputBytes': path.stat().st_size}, records


def invoke(module, target):
    previous = sys.argv
    sys.argv = [str(base.SCRIPT), '--channel', 'tzuyang', '--crawling-path', str(target / 'crawling'),
                '--evaluation-path', str(target / 'evaluation')]
    try:
        with redirect_stdout(io.StringIO()):
            return module.main()
    finally:
        sys.argv = previous


def input_tree(target, holdout=None):
    withheld = []
    for relative, original in INPUT_DIRS.items():
        destination = target / relative
        destination.mkdir(parents=True)
        for item in sorted(original.glob('*.jsonl')):
            link = destination / item.name
            if item.stem == holdout:
                withheld.append((item, link))
            else:
                link.symlink_to(item)
    return withheld


def paths(target):
    return target / 'evaluation/evaluation/transforms.jsonl', target / 'evaluation/evaluation/.receipts/transform.json'


def install_boundary_guard(target):
    """Deny source writes, dotenv reads, network, and subprocesses in workers."""
    target = target.resolve()
    def guard(event, args):
        if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system'):
            raise RuntimeError('benchmark_external_operation_denied')
        candidates = []
        if event == 'open':
            name, mode, flags = args
            if isinstance(name, (str, bytes, os.PathLike)):
                path = Path(os.fsdecode(name))
                if path.name == '.env' or path.name.startswith('.env.'):
                    raise RuntimeError('benchmark_dotenv_read_denied')
                if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
                    candidates = [path]
        elif event in ('os.rename', 'os.replace'):
            candidates = list(args[:2])
        elif event in ('os.remove', 'os.rmdir', 'os.mkdir'):
            candidates = [args[0]]
        for name in candidates:
            if not Path(os.fsdecode(name)).resolve().is_relative_to(target):
                raise RuntimeError('benchmark_outside_write_denied')
    sys.addaudithook(guard)


@contextmanager
def output_failure(module, implementation, output, evidence):
    original_replace = os.replace
    original_open = builtins.open
    backup = output.with_name('.benchmark-preserved-output')
    def fail_at_boundary(operation, temporary=None):
        if evidence.get('injected'):
            raise RuntimeError('benchmark_second_failure_boundary')
        evidence.update(injected=True, boundary=('atomic-replace-after-fsync' if implementation == 'candidate' else 'append-open'),
                        stagedOutputBytes=Path(temporary).stat().st_size if temporary else None)
        original_replace(output, backup)
        output.mkdir()
        try:
            return operation()
        finally:
            output.rmdir()
            original_replace(backup, output)
    def replace(source, destination, *args, **kwargs):
        if Path(destination) == output:
            return fail_at_boundary(lambda: original_replace(source, destination, *args, **kwargs), source)
        return original_replace(source, destination, *args, **kwargs)
    def append_open(file, mode='r', *args, **kwargs):
        if Path(file) == output and 'a' in mode:
            return fail_at_boundary(lambda: original_open(file, mode, *args, **kwargs))
        return original_open(file, mode, *args, **kwargs)
    if implementation == 'candidate':
        module.os.replace = replace
    else:
        module.open = append_open
    try:
        yield
    finally:
        os.replace = original_replace
        if implementation == 'baseline':
            del module.open


def worker(implementation, phase, target, holdout):
    module = base.load_transform(implementation)
    install_boundary_guard(target)
    output, receipt = paths(target)
    if phase == 'prime':
        invoke(module, target)
        print(json.dumps(outputs(output)[0]))
        return
    before_output, before_receipt = sha(output), sha(receipt)
    evidence = {}
    start_cpu, start = time.process_time(), time.perf_counter()
    stats = None
    if phase == 'fail':
        try:
            with output_failure(module, implementation, output, evidence):
                stats = invoke(module, target)
        except OSError as error:
            if not evidence.get('injected') or error.errno != errno.EISDIR:
                raise RuntimeError('unexpected_failure_class') from None
            evidence.update(errorClass=type(error).__name__, errno=error.errno)
        else:
            raise RuntimeError('required_failure_not_observed')
    else:
        stats = invoke(module, target)
    elapsed, cpu = (time.perf_counter() - start) * 1000, (time.process_time() - start_cpu) * 1000
    result = {'wallMs': elapsed, 'cpuMs': cpu,
              'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1048576 if sys.platform == 'darwin' else 1024),
              **outputs(output)[0], 'stats': stats, 'phase': phase,
              'receiptSha256': sha(receipt), 'failureEvidence': evidence}
    if phase == 'fail':
        evidence.update(outputPreserved=sha(output) == before_output,
                        receiptPreserved=sha(receipt) == before_receipt,
                        incompleteTemporaryFiles=len(list(output.parent.glob('.transform-*'))))
        if not evidence['outputPreserved'] or not evidence['receiptPreserved'] or evidence['incompleteTemporaryFiles']:
            raise RuntimeError('failure_state_not_preserved')
    if implementation == 'candidate':
        ledger = json.loads(receipt.read_bytes())
        owns_holdout = 'results:' + holdout in ledger['groups']
        result['receiptReadback'] = {'matchesOutput': ledger['outputHash'] == sha(output),
                                    'hasHoldoutGroup': owns_holdout, 'recordCount': ledger['recordCount'],
                                    'groupCount': len(ledger['groups'])}
        if ledger['outputHash'] != sha(output) or owns_holdout != (phase != 'fail'):
            raise RuntimeError('receipt_completion_contract_failed')
    else:
        result['receiptReadback'] = {'supportedByImplementation': False}
        if receipt.exists():
            raise RuntimeError('baseline_unexpected_receipt')
    print(json.dumps(result, separators=(',', ':')))


def run_worker(implementation, phase, target, holdout):
    command = [sys.executable, str(SCRIPT), '--worker', implementation, '--phase', phase,
               '--target', str(target), '--holdout', holdout]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120,
                            env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LC_ALL': 'C'})
    if result.returncode:
        # Do not print captured input/provider diagnostics.
        raise RuntimeError('benchmark_worker_failed:' + implementation + ':' + phase)
    return json.loads(result.stdout)


def summaries(rows):
    result = {}
    for scenario in SCENARIOS:
        subset = [row for row in rows if row['scenario'] == scenario]
        result[scenario] = {'pairedSamples': 7, 'allOutputsEquivalent': len({r['outputSha256'] for r in subset}) == 1}
        for metric, unit in [('wallMs', 'ms'), ('cpuMs', 'ms'), ('peakRssMiB', 'MiB')]:
            result[scenario][metric] = {}
            for p in (.5, .75, .95):
                values = compare([dict(row, wallMs=row[metric]) for row in subset], p)
                result[scenario][metric]['p' + str(int(100 * p))] = {
                    'unit': unit, 'before': values['beforeMs'], 'after': values['afterMs'],
                    'absoluteChange': -values['absoluteReductionMs'], 'changePercent': -values['reductionPercent'],
                    'change95CI': [-values['reduction95CI'][1], -values['reduction95CI'][0]],
                    'experimentalNoiseBudget': values['experimentalNoiseBudgetMs']}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', choices=['baseline', 'candidate'])
    parser.add_argument('--phase', choices=['prime', 'new', 'fail', 'restart'])
    parser.add_argument('--target', type=Path)
    parser.add_argument('--holdout')
    parser.add_argument('--work-root', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.phase, args.target, args.holdout)
        return
    if args.work_root is None or args.output is None:
        raise SystemExit('--work-root and --output required')
    work = args.work_root.resolve()
    if not work.is_relative_to(ROOT) or work.exists() or args.output.exists():
        raise ValueError('fresh_candidate_owned_paths_required')
    work.mkdir(parents=True)
    initial = base.dataset_digest()
    sources = [base.SCRIPT, ROOT / 'backend/utils/stage_cache.py', ROOT / 'backend/utils/jsonl_utils.py',
               Path(base.__file__), SCRIPT, ROOT / 'backend/bin/analyze_pipeline_performance.py']
    source_hashes = {str(path.relative_to(ROOT)): sha(path) for path in sources}
    oracle_target = work / 'oracle'
    input_tree(oracle_target)
    invoke(base.load_transform('baseline'), oracle_target)
    expected, full_rows = outputs(paths(oracle_target)[0])
    rule_dir = INPUT_DIRS['evaluation/evaluation/rule_results']
    holdout = next(path.stem for path in sorted(rule_dir.glob('*.jsonl'))
                   if any(path.stem in str(row.get('youtube_link', '')) for row in full_rows.values())
                   and all((directory / path.name).is_file() for relative, directory in INPUT_DIRS.items()
                           if relative.endswith(('meta', 'rule_results', 'laaj_results'))))
    selected = {str((directory / (holdout + '.jsonl')).relative_to(base.DATA)): sha(directory / (holdout + '.jsonl'))
                for directory in INPUT_DIRS.values() if (directory / (holdout + '.jsonl')).is_file()}
    observations = []
    started = time.time()
    for scenario in SCENARIOS:
        for repeat in range(7):
            for implementation in (('baseline', 'candidate') if repeat % 2 == 0 else ('candidate', 'baseline')):
                target = work / f'{scenario}-{repeat}-{implementation}'
                withheld = input_tree(target, holdout)
                primed = run_worker(implementation, 'prime', target, holdout)
                if primed['records'] >= expected['records']:
                    raise RuntimeError('holdout_did_not_remove_output')
                for original, link in withheld:
                    link.symlink_to(original)
                phases = []
                if scenario == 'failure-restart':
                    failure = run_worker(implementation, 'fail', target, holdout)
                    if failure['outputSha256'] != primed['outputSha256']:
                        raise RuntimeError('failure_changed_seed')
                    phases.append(failure)
                phases.append(run_worker(implementation, 'restart' if phases else 'new', target, holdout))
                final = phases[-1]
                if (final['records'], final['outputSha256']) != (expected['records'], expected['outputSha256']):
                    raise RuntimeError('transform_equivalence_failed')
                observations.append({'scenario': scenario, 'repeat': repeat, 'implementation': implementation,
                                     'wallMs': sum(x['wallMs'] for x in phases), 'cpuMs': sum(x['cpuMs'] for x in phases),
                                     'peakRssMiB': max(x['peakRssMiB'] for x in phases),
                                     'records': final['records'], 'outputSha256': final['outputSha256'],
                                     'primedRecords': primed['records'], 'addedRecords': final['records'] - primed['records'],
                                     'phases': phases})
            print(json.dumps({'scenario': scenario, 'pairedSamples': repeat + 1, 'equivalent': True}), flush=True)
    if initial != base.dataset_digest() or source_hashes != {str(path.relative_to(ROOT)): sha(path) for path in sources}:
        raise RuntimeError('benchmark_source_changed')
    raw = {'kind': 'local-transform-component-two-condition-replay', 'liveEvidenceEligible': False,
           'formalPerformanceClaim': 'not_established', 'baselineCommit': base.BASELINE,
           'baselineSourceSha256': hashlib.sha256(subprocess.check_output(['git', 'show', base.BASELINE + ':backend/restaurant-evaluation/scripts/12-transform.py'], cwd=ROOT)).hexdigest(),
           'sourceHashes': source_hashes, 'dataset': initial, 'sourcePreserved': True,
           'holdout': {'videoId': holdout, 'sourceFiles': selected, 'oneVideoGroup': True},
           'oracle': expected, 'observations': observations,
           'environment': {'python': platform.python_version(), 'pythonExecutable': sys.executable,
                           'platform': platform.platform(), 'cpuCount': os.cpu_count(),
                           'measurementScope': 'transform invoke only, imports and validation excluded; failure + fresh-process restart summed; RSS maximum across phases',
                           'workRoot': str(work.relative_to(ROOT)), 'paidProviderCalls': 0, 'dbCalls': 0,
                           'networkAndDotenvGuard': True, 'originalSourceWriteGuard': True,
                           'repeats': 7, 'pairOrder': 'AB/BA alternating, A first for repeat 0',
                           'elapsedExperimentSeconds': time.time() - started},
           'hypotheses': {'new-input': 'Cached unchanged groups avoid re-transforming all real input groups; directory/stat scanning and full output publication remain.',
                          'failure-restart': 'A failed output publication leaves the old output and candidate receipt unchanged; a new worker retries without a completed receipt for the held-out input.'},
           'limitations': ['Transform component only, not whole-pipeline/provider/live evidence.',
                          'Baseline uses append-open failure; candidate uses actual atomic replace failure after fsync. These are native boundaries, not identical writer algorithms.',
                          'EISDIR is controlled fault injection; no disk-full, power-loss or operational failure rate claim.',
                          'OS filesystem caches are not cleared; host workload is not isolated.',
                          'Seven paired repeats; bootstrap CI is exploratory, especially p95.',
                          'RSS is process high-water memory including imports, not incremental allocation or whole pipeline memory.',
                          'Worker audit guards and boundary hooks add instrumentation overhead.'],
           'confidenceMethod': '10000 paired percentile bootstrap draws, seed 20261002, nearest-rank quantiles; 2*MAD paired-difference noise budget',
           'comparisons': summaries(observations)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(raw, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'samples': len(observations), 'sourcePreserved': True}), flush=True)


if __name__ == '__main__':
    main()
