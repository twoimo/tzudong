from pathlib import Path
import argparse, json, math, random, statistics

parser = argparse.ArgumentParser()
parser.add_argument('--aa', required=True)
parser.add_argument('--ab', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
aa = json.loads(Path(args.aa).read_text())
ab = json.loads(Path(args.ab).read_text())
rng = random.Random(20261009)
def percentile(values, q):
    values = sorted(values)
    pos = (len(values) - 1) * q
    return values[math.floor(pos)] * (1 - (pos % 1)) + values[math.ceil(pos)] * (pos % 1)
def trial_values(raw, scenario):
    pairs = {}
    for run in raw['trials']:
        sample = next(x for x in run['results'] if x['name'] == scenario)
        if sample['mismatches']: raise ValueError('equivalence_failure')
        pairs.setdefault(run['pair'], {})[run['variant']] = sample
    if len(pairs) != 9 or any(set(v) != {'A', 'B'} for v in pairs.values()): raise ValueError('paired_inventory_failed')
    return pairs
out = {'unit':'estimated milliseconds per helper call from 32-sweep timed batches', 'nIndependentPairs':9, 'internalBatchesPerProcess':32, 'p95':'not reported from nine independent observations', 'confidenceMethod':'paired-process bootstrap median difference, 10000 replicates, fixed seed 20261009', 'browserPerformanceAdmission':False, 'results':[]}
for name in ['order8','order128','unchanged-order128','fallback8','fallback128']:
    pairs = trial_values(ab, name)
    before = [v['A']['medianEstimatedCallMs'] for v in pairs.values()]
    after = [v['B']['medianEstimatedCallMs'] for v in pairs.values()]
    differences = [a-b for a,b in zip(before,after)]
    bootstrap = [statistics.median(rng.choices(differences,k=len(differences))) for _ in range(10000)]
    b,a = statistics.median(before),statistics.median(after)
    noise_pairs = trial_values(aa, name)
    noise = [abs(v['A']['medianEstimatedCallMs']-v['B']['medianEstimatedCallMs']) for v in noise_pairs.values()]
    interval = [percentile(bootstrap,.025),percentile(bootstrap,.975)]
    state_before = next(iter(pairs.values()))['A']['state']
    state_after = next(iter(pairs.values()))['B']['state']
    out['results'].append({'scenario':name,'beforeMedianMs':b,'afterMedianMs':a,'absoluteReductionMs':b-a,'relativeReductionPercent':(b-a)/b*100 if b>0 else None,'paired95CiReductionMs':interval,'AAAbsoluteDifferenceRangeMs':[min(noise),max(noise)],'beforeRangeMs':[min(before),max(before)],'afterRangeMs':[min(after),max(after)],'medianPairReductionMs':statistics.median(differences),'helperPracticalGrowthLimitMs':.5,'helperGrowthLimitPass':a-b<=.5,'stateBefore':state_before,'stateAfter':state_after,'orderMissesBefore':next(iter(pairs.values()))['A']['orderMisses'],'orderMissesAfter':next(iter(pairs.values()))['B']['orderMisses'],'fallbackMissesBefore':next(iter(pairs.values()))['A']['fallbackMisses'],'fallbackMissesAfter':next(iter(pairs.values()))['B']['fallbackMisses'],'judgment':'helper improvement beyond observed AA spread' if interval[0]>max(noise) else 'helper slower' if interval[1]<-max(noise) else 'improvement not proven'})
destination=Path(args.output)
with destination.open('x') as f:json.dump(out,f,indent=2);f.write('\n')
print(json.dumps(out,indent=2))
