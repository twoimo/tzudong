#!/usr/bin/env python3
"""Source-pinned replay of the original transform benchmark's three scenarios.

Uses its actual corpus, baseline loader, and input/delta preparation unchanged.
Retains isolated outputs and supplements timings with receipts and before/after
hashes. Never combines the frozen new-input/failure-restart observations.
"""
import argparse
from contextlib import redirect_stdout
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import random
import resource
import shutil
import subprocess
import sys
import time

sys.dont_write_bytecode = True
import benchmark_pipeline_transform as base
from benchmark_pipeline_transform_followup import install_boundary_guard, outputs, sha
from analyze_pipeline_performance import compare, quantile

ROOT = base.ROOT
HELPER = Path(__file__).resolve()
PIN = 'ae9ad574fd38e02caefdaed8c7004ec296d9a7ea088e1353dfcda41b540a1bf4'
SCENARIOS = ('cold', 'unchanged', 'delta-five')
METRICS = (('wallMs', 'ms'), ('cpuMs', 'ms'), ('peakRssMiB', 'MiB'))
SOURCES = [base.SCRIPT, ROOT / 'backend/utils/stage_cache.py', ROOT / 'backend/utils/jsonl_utils.py',
           Path(base.__file__), ROOT / 'backend/bin/benchmark_pipeline_transform_followup.py',
           ROOT / 'backend/bin/analyze_pipeline_performance.py', HELPER]


def source_hashes():
    return {str(path.relative_to(ROOT)): sha(path) for path in SOURCES}


def worker(implementation, crawling, evaluation):
    if sha(base.SCRIPT) != PIN:
        raise RuntimeError('source_pin_changed')
    module = base.load_transform(implementation)
    install_boundary_guard(evaluation)
    sys.argv = [str(base.SCRIPT), '--channel', 'tzuyang', '--crawling-path', str(crawling),
                '--evaluation-path', str(evaluation)]
    output = evaluation / 'evaluation/transforms.jsonl'
    receipt = output.parent / '.receipts/transform.json'
    before = {'outputSha256': sha(output), 'receiptSha256': sha(receipt)}
    start_cpu, start = time.process_time(), time.perf_counter()
    with redirect_stdout(io.StringIO()):
        stats = module.main()
    elapsed, cpu = (time.perf_counter() - start) * 1000, (time.process_time() - start_cpu) * 1000
    validated, _ = outputs(output)
    result = {'wallMs': elapsed, 'cpuMs': cpu,
              'peakRssMiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1048576 if sys.platform == 'darwin' else 1024),
              **validated, 'stats': stats, 'before': before, 'receiptSha256': sha(receipt), 'guarded': True}
    if implementation == 'candidate':
        ledger = json.loads(receipt.read_bytes())
        result['receiptReadback'] = {'outputHashMatches': ledger['outputHash'] == validated['outputFileSha256'],
                                    'recordCountMatches': ledger['recordCount'] == validated['records'],
                                    'groupCount': len(ledger['groups'])}
        if not all(result['receiptReadback'][key] for key in ('outputHashMatches', 'recordCountMatches')):
            raise RuntimeError('receipt_readback_failed')
    elif receipt.exists():
        raise RuntimeError('unexpected_baseline_receipt')
    print(json.dumps(result, separators=(',', ':')))


def run_worker(implementation, crawling, evaluation):
    command = [sys.executable, str(HELPER), '--worker', implementation,
               '--crawling', str(crawling), '--evaluation', str(evaluation)]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120,
                            env={'PATH': os.defpath, 'PYTHONDONTWRITEBYTECODE': '1', 'LC_ALL': 'C'})
    if result.returncode:
        # Do not expose input content or arbitrary captured diagnostics.
        raise RuntimeError('transform_worker_failed:' + implementation)
    return json.loads(result.stdout)


def compare_metric(rows, metric, p):
    values = compare([dict(row, wallMs=row[metric]) for row in rows], p)
    before = {r['repeat']: r[metric] for r in rows if r['implementation'] == 'baseline'}
    after = {r['repeat']: r[metric] for r in rows if r['implementation'] == 'candidate'}
    if set(before) != set(range(7)) or set(after) != set(range(7)):
        raise RuntimeError('exact_seven_pairs_required')
    rng = random.Random(20261002)
    draws = []
    for _ in range(10000):
        selected = [rng.randrange(7) for _ in range(7)]
        draws.append(quantile([after[i] for i in selected], p) - quantile([before[i] for i in selected], p))
    return {'samples': 7, 'before': values['beforeMs'], 'after': values['afterMs'],
            'absoluteChange': -values['absoluteReductionMs'], 'changePercent': -values['reductionPercent'],
            'change95CI': [-values['reduction95CI'][1], -values['reduction95CI'][0]],
            'absoluteChange95CI': [quantile(draws, .025), quantile(draws, .975)],
            'experimentalNoiseBudget': values['experimentalNoiseBudgetMs']}


def summarize(rows):
    comparisons = {}
    for scenario in SCENARIOS:
        subset = [row for row in rows if row['scenario'] == scenario]
        comparisons[scenario] = {'pairedSamples': 7, 'allOutputsEquivalent': len({r['outputSha256'] for r in subset}) == 1,
                                 'records': sorted({r['records'] for r in subset})}
        for metric, unit in METRICS:
            stats = {'unit': unit, **{f'p{int(p*100)}': compare_metric(subset, metric, p) for p in (.5, .75, .95)}}
            b = {r['repeat']: r[metric] for r in subset if r['implementation'] == 'baseline'}
            a = {r['repeat']: r[metric] for r in subset if r['implementation'] == 'candidate'}
            changes = [a[i] - b[i] for i in range(7)]
            stats['pairedRegressions'] = {'count': sum(x > 0 for x in changes), 'pairs': 7,
                                          'largestAdverseChange': max(0, max(changes)),
                                          'largestSignedChange': max(changes)}
            comparisons[scenario][metric] = stats
    amortization = {'scope': 'modeled accumulated transform cost, not a measured sequential pipeline; RSS is not additive',
                    'formula': 'cold overhead + N * subsequent delta < 0; smallest integer N >= 0', 'metrics': {}}
    for metric in ('wallMs', 'cpuMs'):
        amortization['metrics'][metric] = {}
        for p in ('p50', 'p75', 'p95'):
            cold = comparisons['cold'][metric][p]['absoluteChange']
            modeled = {'coldOverhead': cold}
            for scenario in ('unchanged', 'delta-five'):
                delta = comparisons[scenario][metric][p]['absoluteChange']
                modeled[scenario] = {'perRunSaving': -delta, 'reruns': 0 if cold < 0 else math.floor(cold / -delta) + 1 if delta < 0 else None}
            amortization['metrics'][metric][p] = modeled
    return comparisons, amortization


def report(summary):
    lines = ['# Transform 세 조건 독립 재측정', '',
             '로컬 transform component 증빙입니다. 전체 pipeline, 실제 provider, 운영 DB 성능·비용 증빙이 아닙니다.', '',
             f"- 후보: `{PIN}` (시작/종료 일치)", f"- 기존 구현: `{base.BASELINE}`",
             f"- 입력: {summary['datasetBefore']['files']} files / {summary['datasetBefore']['bytes']} bytes / `{summary['datasetBefore']['sha256']}` (시작/종료 일치)",
             '- 각 조건 7쌍, AB/BA 교대, 42개 원시 관측. 다른 조건·이전 소스 결과를 합치지 않았습니다.',
             '- CPU/시간: transform main 호출 범위. import·준비·검증 제외. RSS: import와 출력 검증을 포함한 독립 worker 프로세스 high-water.',
             '- 95% CI: paired bootstrap 10,000회, seed 20261002, nearest-rank 분위수. 7쌍의 p95는 표본 최댓값이며 모집단 tail 추정이 아닙니다.', '',
             '| 조건 | 지표 | 분위수 | 기존 → 후보 | 절대 변화 [95% CI] | 변화율 [95% CI] | 2×MAD noise |',
             '|---|---|---|---:|---:|---:|---:|']
    for scenario, item in summary['comparisons'].items():
        for metric, unit in METRICS:
            for p in ('p50', 'p75', 'p95'):
                s = item[metric][p]
                aci, rci = s['absoluteChange95CI'], s['change95CI']
                lines.append(f"| {scenario} | {metric} ({unit}) | {p} | {s['before']:.3f} → {s['after']:.3f} | {s['absoluteChange']:+.3f} [{aci[0]:+.3f}, {aci[1]:+.3f}] | {s['changePercent']:+.2f}% [{rci[0]:+.2f}, {rci[1]:+.2f}] | {s['experimentalNoiseBudget']:.3f} |")
    lines += ['', '## 관측된 악화와 상각', '']
    for scenario, item in summary['comparisons'].items():
        for metric, unit in METRICS:
            r = item[metric]['pairedRegressions']
            lines.append(f"- {scenario} / {metric}: 악화 {r['count']}/7쌍, 최대 악화 {r['largestAdverseChange']:.3f} {unit}.")
    for metric, values in summary['amortization']['metrics'].items():
        for p, item in values.items():
            lines.append(f"- {metric} {p}: cold 추가비용 {item['coldOverhead']:.3f} ms; unchanged {item['unchanged']['reruns']}회 또는 delta-five {item['delta-five']['reruns']}회 재실행 후 상각 (분위수 기반 산술모델).")
    lines += ['', '## 가설과 실제 범위', ''] + ['- ' + value for value in summary['hypotheses'].values()]
    lines += ['', '## 한계', ''] + ['- ' + value for value in summary['limitations']]
    lines += ['', '## 환경', '', '```json', json.dumps(summary['environment'], ensure_ascii=False, indent=2), '```', '',
              f"원시 결과 SHA256: `{summary['rawSha256']}`", '']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', choices=['baseline', 'candidate'])
    parser.add_argument('--crawling', type=Path)
    parser.add_argument('--evaluation', type=Path)
    parser.add_argument('--work-root', type=Path)
    parser.add_argument('--output-prefix', type=Path)
    args = parser.parse_args()
    if args.worker:
        worker(args.worker, args.crawling, args.evaluation)
        return
    if args.work_root is None or args.output_prefix is None:
        raise SystemExit('--work-root and --output-prefix required')
    work, prefix = args.work_root.resolve(), args.output_prefix.resolve()
    artifacts = {name: Path(str(prefix) + suffix) for name, suffix in [('raw', '-raw.json'), ('summary', '-summary.json'), ('report', '-report.md'), ('map', '-artifacts.sha256')]}
    if not work.is_relative_to(ROOT / 'tmp') or work.exists() or not prefix.is_relative_to(ROOT / 'apps/web/performance') or any(p.exists() for p in artifacts.values()):
        raise ValueError('fresh_candidate_owned_paths_required')
    sources_before, dataset_before = source_hashes(), base.dataset_digest()
    if sources_before[str(base.SCRIPT.relative_to(ROOT))] != PIN:
        raise RuntimeError('source_pin_changed')
    work.mkdir(parents=True)
    started = time.time()
    start_iso = datetime.now(timezone.utc).isoformat()
    inputs, evaluation = base.input_tree(work / 'source')
    oracle = run_worker('baseline', inputs, evaluation)
    primed = run_worker('candidate', inputs, evaluation)
    if (primed['records'], primed['outputSha256']) != (oracle['records'], oracle['outputSha256']):
        raise RuntimeError('seed_equivalence_failed')
    seed = evaluation / 'evaluation/transforms.jsonl'
    receipt = evaluation / 'evaluation/.receipts/transform.json'
    delta_inputs, delta_evaluation = base.input_tree(work / 'delta', delta=True)
    delta_oracle = run_worker('baseline', delta_inputs, delta_evaluation)
    changed = []
    for item in sorted((delta_evaluation / 'evaluation/rule_results').glob('*.jsonl')):
        original = base.DATA / 'restaurant-evaluation/data/tzuyang/evaluation/rule_results' / item.name
        if sha(item) != sha(original):
            changed.append({'name': item.name, 'beforeSha256': sha(original), 'afterSha256': sha(item)})
    if len(changed) != 5 or delta_oracle['outputSha256'] == oracle['outputSha256']:
        raise RuntimeError('exact_five_changes_required')
    observations = []
    for scenario in SCENARIOS:
        for repeat in range(7):
            for implementation in (('baseline', 'candidate') if repeat % 2 == 0 else ('candidate', 'baseline')):
                target = work / f'{scenario}-{repeat}-{implementation}'
                (target / 'evaluation').mkdir(parents=True)
                source = delta_evaluation if scenario == 'delta-five' else evaluation
                for directory in ('rule_results', 'laaj_results', 'notSelection'):
                    (target / 'evaluation' / directory).symlink_to(source / 'evaluation' / directory, target_is_directory=True)
                if scenario == 'unchanged' or scenario == 'delta-five' and implementation == 'candidate':
                    shutil.copy2(seed, target / 'evaluation/transforms.jsonl')
                    if implementation == 'candidate':
                        (target / 'evaluation/.receipts').mkdir()
                        shutil.copy2(receipt, target / 'evaluation/.receipts/transform.json')
                measured = run_worker(implementation, delta_inputs if scenario == 'delta-five' else inputs, target)
                expected = delta_oracle if scenario == 'delta-five' else oracle
                if (measured['records'], measured['outputSha256']) != (expected['records'], expected['outputSha256']):
                    raise RuntimeError('transform_equivalence_failed')
                observations.append({'scenario': scenario, 'repeat': repeat, 'implementation': implementation, **measured})
            print(json.dumps({'scenario': scenario, 'pairedSamples': repeat + 1, 'equivalent': True}), flush=True)
    sources_after, dataset_after = source_hashes(), base.dataset_digest()
    if sources_before != sources_after or dataset_before != dataset_after:
        raise RuntimeError('source_or_corpus_drift')
    comparisons, amortization = summarize(observations)
    metadata = {'kind': 'local-transform-component-three-condition-replay', 'liveEvidenceEligible': False,
                'formalPerformanceClaim': 'not_established', 'baselineCommit': base.BASELINE,
                'baselineSourceSha256': hashlib.sha256(subprocess.check_output(['git', 'show', base.BASELINE + ':backend/restaurant-evaluation/scripts/12-transform.py'], cwd=ROOT)).hexdigest(),
                'sourceHashesBefore': sources_before, 'sourceHashesAfter': sources_after, 'sourcePreserved': True,
                'datasetBefore': dataset_before, 'datasetAfter': dataset_after, 'deltaInputs': changed,
                'environment': {'python': platform.python_version(), 'pythonExecutable': sys.executable,
                                'platform': platform.platform(), 'cpuCount': os.cpu_count(),
                                'cpuModel': subprocess.check_output(['sysctl', '-n', 'machdep.cpu.brand_string'], text=True).strip(),
                                'physicalMemoryBytes': int(subprocess.check_output(['sysctl', '-n', 'hw.memsize'], text=True)),
                                'headAtReadback': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
                                'workRoot': str(work.relative_to(ROOT)), 'startedAt': start_iso, 'finishedAt': datetime.now(timezone.utc).isoformat(),
                                'elapsedExperimentSeconds': time.time() - started, 'timingScope': 'transform main only, imports/preparation/validation excluded',
                                'rssScope': 'worker high-water including imports and output validation', 'pairOrder': 'AB/BA alternating, A first for repeat 0',
                                'networkAndDotenvGuard': True, 'originalSourceWriteGuard': True, 'providerCalls': 0, 'dbCalls': 0},
                'hypotheses': {'cold': 'Candidate fingerprints, ownership index and atomic output/receipt publication add initial work; no assumption of a cold speedup.',
                               'unchanged': 'A verified receipt can reuse all groups while scanning input metadata and validating the existing output.',
                               'delta-five': 'Candidate reuses unchanged groups and republishes the complete output; append-only baseline must rebuild from empty output to reflect changed existing rows correctly.'},
                'limitations': ['Transform component only; no whole-pipeline, provider, hosted DB or monetary cost claim.',
                                'Cold means no transform output or receipt, not cold OS filesystem cache. Host workload is not isolated.',
                                'Seven paired samples; paired percentile bootstrap with 10000 draws and seed 20261002 is exploratory, particularly p95.',
                                'The original benchmark delta-five uses baseline full rebuild versus candidate primed incremental update; both must equal a fresh delta oracle.',
                                'As in the original benchmark, each pair copies the seed receipt to a fresh evaluation path; absolute-path file-hash memo keys are not all reusable. Stable-path cache speed is not inferred.',
                                'Worker audit guards add instrumentation overhead. RSS is whole-process high-water and cannot be accumulated or amortized.',
                                'Amortization is arithmetic on measured component percentiles, not a measured sequential run or pipeline-wide break-even.',
                                'Legacy rows lacking both current input and receipt ownership remain preserved without deletion evidence. These conditions do not prove cleanup.',
                                'Frozen new-input/failure-restart and earlier-source experiments are retained separately and were not rerun or pooled.']}
    raw = {**metadata, 'oracle': oracle, 'primedSeed': primed, 'deltaOracle': delta_oracle, 'observations': observations}
    artifacts['raw'].parent.mkdir(parents=True, exist_ok=True)
    artifacts['raw'].write_text(json.dumps(raw, indent=2) + '\n')
    summary = {**metadata, 'rawFile': str(artifacts['raw'].relative_to(ROOT)), 'rawSha256': sha(artifacts['raw']),
               'confidenceMethod': '10000 paired bootstrap draws; seed 20261002; nearest-rank quantiles; 2*MAD paired-difference noise',
               'comparisons': comparisons, 'amortization': amortization}
    artifacts['summary'].write_text(json.dumps(summary, indent=2) + '\n')
    artifacts['report'].write_text(report(summary))
    artifacts['map'].write_text(''.join(f'{sha(path)}  {path.relative_to(ROOT)}\n' for name, path in artifacts.items() if name != 'map'))
    print(json.dumps({'status': 'complete', 'observations': len(observations), 'sourcePreserved': True,
                      'artifactMap': str(artifacts['map'].relative_to(ROOT)), 'artifactMapSha256': sha(artifacts['map'])}), flush=True)


if __name__ == '__main__':
    main()
