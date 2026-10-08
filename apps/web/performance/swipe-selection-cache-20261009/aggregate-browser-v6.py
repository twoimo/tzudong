from pathlib import Path
import json, random, statistics, math

root = Path(__file__).resolve().parent
plan = json.loads((root / 'browser-confirm-plan-v6.json').read_text())
final = json.loads((root / 'browser-series-final-v6.json').read_text())
assert len(final['phases']) == 22 and all(row['matched'] for row in final['phases'])
rng = random.Random(20261009)
def quantile(values, q):
    values = sorted(values)
    position = (len(values) - 1) * q
    return values[math.floor(position)] * (1-position%1) + values[math.ceil(position)] * (position%1)
def process_values(raw):
    actions = raw['cycles']
    assert raw['passed'] and len(actions) == 256
    assert raw['requests'].get('unsupportedFixtureQueries', 0) == 0
    assert raw['sdkScript']['sha256'] == plan['sdkScriptSha256']
    assert raw['browserVersion'] == '154.0.8037.98'
    heap = lambda key: raw[key]['usedSize']/1e6
    values = {
        'initial_heap_MB':heap('initialHeap'), 'end_heap_MB':heap('endHeap'), 'idle_heap_MB':heap('idleHeap'),
        'sampled_peak_heap_MB':max(row['heap']['usedSize']/1e6 for row in actions if 'heap' in row),
        'input_all_process_median_ms':statistics.median(row['state']['inputToObservedMs'] for row in actions),
        'input_first_process_median_ms':statistics.median(row['state']['inputToObservedMs'] for row in actions if row['pass']==0),
        'input_revisit_process_median_ms':statistics.median(row['state']['inputToObservedMs'] for row in actions if row['pass']==1),
        'input_within_process_p95_ms_descriptive':quantile([row['state']['inputToObservedMs'] for row in actions],.95),
        'long_task_count':sum(row['state']['longTaskCount'] for row in actions),
        'long_task_total_ms':sum(row['state']['longTaskMs'] for row in actions),
        'max_observed_frame_gap_ms':max(row['state']['maxFrameGapMs'] for row in actions),
        'restaurant_requests':raw['requests']['restaurant'],
        'end_DOM_nodes':next(m['value'] for m in actions[-1]['resources'] if m['name']=='Nodes'),
        'end_JS_listeners':next(m['value'] for m in actions[-1]['resources'] if m['name']=='JSEventListeners'),
    }
    return values
runs = {}
for phase in plan['phases']:
    for run in phase['runs']:
        raw = json.loads((root/f"ui-{run['label']}/raw.json").read_text())
        assert raw['sourceCommit']==(plan['sourceBefore'] if run['kind']=='baseline' else plan['sourceAfter'])
        runs[run['label']] = {'run':run,'metrics':process_values(raw),'errors':raw['errors'],'requests':raw['requests'],'durationSeconds':None}
aa = plan['phases'][0]['runs']; ab = plan['phases'][1]['runs']
result = {'sourceBefore':plan['sourceBefore'],'sourceAfter':plan['sourceAfter'],'independentAAProcesses':4,'independentABPairs':9,'dependentActionsPerProcess':256,'matchedProcesses':22,'confidenceMethod':'paired-process bootstrap median difference and median relative change, 20000 replicates, fixed seed20261009','AANoiseScope':'two paired differences only; weak noise estimate, cannot waive guard','p95Scope':'empirical256-action within-session p95, compared as a per-process descriptive summary; no user/population p95 inference','metrics':[],'rawProcessValues':runs,'canonicalPerformanceAdmission':0,'fieldAdmission':0,'goalComplete':False}
for metric in next(iter(runs.values()))['metrics']:
    pairs=[]
    for pair in range(9):
        inventory = {r['variant']:runs[r['label']]['metrics'][metric] for r in ab if r['pair']==pair}
        assert set(inventory)=={'A','B'}
        pairs.append((inventory['A'], inventory['B']))
    before=[a for a,b in pairs];after=[b for a,b in pairs]
    differences=[a-b for a,b in pairs]
    relative=[(a-b)/a*100 if a>0 else None for a,b in pairs]
    diff_boot=[];rel_boot=[]
    for _ in range(20000):
        indices=rng.choices(range(9),k=9)
        diff_boot.append(statistics.median(differences[i] for i in indices))
        if all(relative[i] is not None for i in indices):rel_boot.append(statistics.median(relative[i] for i in indices))
    aa_differences=[]
    for pair in range(2):
        inventory={r['variant']:runs[r['label']]['metrics'][metric] for r in aa if r['pair']==pair}
        aa_differences.append(inventory['A']-inventory['B'])
    b,a=statistics.median(before),statistics.median(after)
    ci=[quantile(diff_boot,.025),quantile(diff_boot,.975)]
    rel_ci=[quantile(rel_boot,.025),quantile(rel_boot,.975)] if rel_boot else None
    noise=max(abs(v) for v in aa_differences)
    guard=20 if metric in ['initial_heap_MB','end_heap_MB','idle_heap_MB','sampled_peak_heap_MB'] else 15 if metric.startswith('input_') and 'p95' not in metric else None
    descriptive_pass=a<=b*(1+guard/100) if guard is not None else None
    ci_pass=rel_ci[0]>=-guard if guard is not None and rel_ci is not None else None
    judgment='improvement beyond limited observed AA spread' if ci[0]>noise else 'slower beyond limited observed AA spread' if ci[1]<-noise else 'improvement not proven'
    result['metrics'].append({'metric':metric,'beforeMedian':b,'afterMedian':a,'absoluteReduction':b-a,'relativeReductionPercent':(b-a)/b*100 if b>0 else None,'pairedMedianReduction':statistics.median(differences),'paired95CiReduction':ci,'paired95CiRelativeReductionPercent':rel_ci,'beforeRange':[min(before),max(before)],'afterRange':[min(after),max(after)],'beforeMAD':statistics.median(abs(v-b) for v in before),'afterMAD':statistics.median(abs(v-a) for v in after),'AApairedDifferences':aa_differences,'limitedAAabsoluteNoiseMax':noise,'fixedRegressionGuardPercent':guard,'descriptiveMedianGuardPass':descriptive_pass,'pairedRelative95CiWithinGuard':ci_pass,'pairsAboveGuard':sum(y>x*(1+guard/100) for x,y in pairs) if guard is not None else None,'judgment':judgment})
result['primaryMedianGuardPass']=all(v['descriptiveMedianGuardPass'] for v in result['metrics'] if v['fixedRegressionGuardPercent'] is not None)
result['primaryPairedCIWithinGuard']=all(v['pairedRelative95CiWithinGuard'] for v in result['metrics'] if v['fixedRegressionGuardPercent'] is not None)
with (root/'browser-confirm-summary-v6.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'primaryMedianGuardPass':result['primaryMedianGuardPass'],'primaryPairedCIWithinGuard':result['primaryPairedCIWithinGuard'],'metrics':[{k:v[k] for k in ['metric','beforeMedian','afterMedian','relativeReductionPercent','paired95CiReduction','paired95CiRelativeReductionPercent','limitedAAabsoluteNoiseMax','descriptiveMedianGuardPass','pairedRelative95CiWithinGuard','pairsAboveGuard','judgment']} for v in result['metrics']]},indent=2))
