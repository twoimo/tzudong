import { buildPostSearchSwipeCandidates } from '/Users/twoimo/.codex/worktrees/goal-delivery-20261012/tzudong/apps/web/lib/mobile-home-search-selection.ts';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = '/Users/twoimo/.codex/worktrees/goal-delivery-20261012/tzudong';
const make = (id, lat, name = id) => ({ id, name, lat, lng: 127, categories: ['test'] });
const cases = [];
const run = (name, input, mutate, expected) => {
  const first = buildPostSearchSwipeCandidates(input).map(row => row.id);
  mutate();
  const cached = buildPostSearchSwipeCandidates(input).map(row => row.id);
  const fresh = buildPostSearchSwipeCandidates({ ...input, visibleRestaurants: [...input.visibleRestaurants], allRestaurants: [...input.allRestaurants] }).map(row => row.id);
  if (JSON.stringify(fresh) !== JSON.stringify(expected)) throw Error('FRESH_REFERENCE_NOT_EXPECTED');
  cases.push({ name, first, afterMutationCached: cached, afterMutationFresh: fresh, expected,
    passed: JSON.stringify(cached) === JSON.stringify(expected) });
};
{
  const a = make('append-a', 37.5), b = make('append-b', 37.6), list = [a, b];
  run('visible-array-duplicate-appended', { visibleRestaurants: list, allRestaurants: list, activeSearchedRestaurant: null }, () => list.push(a), [a.id, b.id]);
}
{
  const selection = make('order-search', 37.5, 'needle'), a = make('order-a', 37.6), b = make('order-b', 37.7), list = [a, b];
  run('visible-name-coordinate-mutated', { visibleRestaurants: list, allRestaurants: list, activeSearchedRestaurant: selection },
    () => { b.name = 'needle'; b.lat = 37.5; }, [b.id, a.id]);
}
{
  const selection = make('merged-search', 37.5), a = make('merged-a', 37.6), b = make('merged-b', 37.7), list = [a, b];
  run('visible-merged-id-mutated', { visibleRestaurants: list, allRestaurants: list, activeSearchedRestaurant: selection },
    () => { b.mergedRestaurants = [{ id: selection.id }]; }, [b.id, a.id]);
}
{
  const selection = make('distance-search', 37.5), visible = make('distance-visible', 37.5), a = make('distance-a', 37.501), b = make('distance-b', 37.8), list = [visible, a, b];
  run('catalog-fallback-coordinate-mutated', { visibleRestaurants: [visible], allRestaurants: list, activeSearchedRestaurant: selection },
    () => { a.lat = 38; b.lat = 37.502; }, [visible.id, b.id]);
}
{
  const selection = make('remove-search', 37.5), visible = make('remove-visible', 37.5), a = make('remove-a', 37.501), b = make('remove-b', 37.8), list = [visible, a, b];
  run('catalog-cached-fallback-removed', { visibleRestaurants: [visible], allRestaurants: list, activeSearchedRestaurant: selection },
    () => { list.splice(1, 1); }, [visible.id, b.id]);
}
const source = await readFile(root + '/apps/web/lib/mobile-home-search-selection.ts');
const result = { observedAtUtc: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  helperSourceSha256: createHash('sha256').update(source).digest('hex'), runtime: process.versions.bun,
  scope: 'pure helper correctness under explicit same-array/object mutation; not a production UI reproduction or performance result',
  cases, passed: cases.every(row => row.passed), failures: cases.filter(row => !row.passed).length,
  productionWrites: 0, fieldAdmission: 0 };
await writeFile(new URL('candidate-reproduction-v1.json', import.meta.url), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
if (!result.passed) process.exitCode = 1;
