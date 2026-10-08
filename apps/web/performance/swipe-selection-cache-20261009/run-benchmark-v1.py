from pathlib import Path
import argparse, datetime, hashlib, json, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--phase', choices=['aa', 'ab'], required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parent
web = root.parents[1]
before = root / 'before-probe-source.ts'
if not before.exists():
    # Read-only cache diagnostics, sampled after timing. The algorithms above
    # remain byte-exact in before-source.ts; no runtime interception or GC.
    probe = '''\nexport function getSwipeSelectionCacheState(visibleRestaurants, allRestaurants) {
 const orders = orderedVisibleCache.get(visibleRestaurants);
 let allocatedOrderArrays = 0; let retainedOrderReferences = 0;
 for (const order of orders?.values() ?? []) { allocatedOrderArrays += 1; retainedOrderReferences += order.restaurants.length; }
 return { orderEntries: orders?.size ?? 0, fallbackEntries: nearestSwipeFallbackCache.get(allRestaurants)?.size ?? 0, allocatedOrderArrays, retainedOrderReferences, snapshotRows: 0 };
}\n'''
    before.write_text((root / 'before-source.ts').read_text() + probe)
after = web / 'lib/mobile-home-search-selection.ts'
destination = root / f'{args.phase}-raw-v1.json'
if destination.exists():
    raise SystemExit('existing_evidence_not_overwritten')
record = {'phase': args.phase, 'startedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'warmups': [], 'trials': [], 'browserPerformanceAdmission': False}
def run(source, identifier):
    out = subprocess.run(['/Users/twoimo/.bun/bin/bun', str(root / 'benchmark-worker.mjs'), str(source), identifier], check=True, capture_output=True, text=True, cwd=web, timeout=120)
    return json.loads(out.stdout)
for warm in range(2):
    for label, source in [('A', before), ('B', before if args.phase == 'aa' else after)]:
        record['warmups'].append(run(source, f'warmup-{warm}-{label}'))
    print(f'warmup {warm + 1}/2', flush=True)
for pair in range(9):
    labels = ['A', 'B'] if pair % 2 == 0 else ['B', 'A']
    for label in labels:
        source = before if label == 'A' or args.phase == 'aa' else after
        result = run(source, f'pair-{pair}-{label}')
        result.update(pair=pair, variant=label, executionOrder=labels.index(label))
        record['trials'].append(result)
    print(f'pair {pair + 1}/9', flush=True)
record['finishedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
destination.write_text(json.dumps(record, indent=2) + '\n')
print(destination)
