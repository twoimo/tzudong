// Offline semantic probes. Runs source AST nodes; never contacts a provider or renders Naver.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = process.env.TZUDONG_SOURCE_ROOT ?? '/Users/twoimo/.codex/worktrees/promotion-sync-20261004/tzudong';
const tsPath = process.env.TZUDONG_TYPESCRIPT_PATH ?? '/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong/apps/web/node_modules/typescript/lib/typescript.js';
const ts = createRequire(import.meta.url)(tsPath);
const PR3031 = 'cd86c106b468c40e83a2e2edf39b49c3b9529937';
const PR3032 = '76afb0634b6710581aa296a9644929313e24b36f';
const read = (path: string, rev = 'current') => rev === 'current'
    ? readFileSync(`${root}/apps/web/${path}`, 'utf8')
    : execFileSync('git', ['show', `${rev}:apps/web/${path}`], { cwd: root, encoding: 'utf8' });
const ast = (path: string, rev = 'current') => ts.createSourceFile(path, read(path, rev), ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const js = (text: string) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function load(path: string, rev = 'current', dependencies: Record<string, unknown> = {}) {
    const exports = {};
    runInNewContext(js(read(path, rev)), { exports, require(name: string) {
        assert(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    } });
    return exports as any;
}
function findNode(tree: any, predicate: (n: any) => boolean) {
    let result: any;
    const visit = (node: any) => {
        if (predicate(node)) { assert(!result, 'Ambiguous AST selection'); result = node; }
        ts.forEachChild(node, visit);
    };
    visit(tree); assert(result, 'Source AST node missing'); return result;
}

const result: any = { sourceAuthority: '7a430454cf90a4d9f1ba0ce35ad3ffd5022ceebd', compilerVersion: ts.version, browserOrPerformanceMeasurement: false };
result.category = [];
for (const rev of ['current', PR3032]) {
    const tree = ast('components/filters/CategoryFilter.tsx', rev);
    const node = findNode(tree, n => ts.isPropertyAssignment(n) && n.name.getText(tree) === 'queryFn');
    let logCalls: unknown[][] = [];
    let fetchResult: any = [];
    let rejection: any;
    let shouldReject = false;
    let mergeInput: unknown;
    const queryFn = runInNewContext(js(`const queryFn = ${node.initializer.getText(tree)}; queryFn;`), {
        fetchSupabaseRows: async () => { if (shouldReject) throw rejection; return fetchResult; },
        mergeRestaurants: (data: unknown) => { mergeInput = data; return data; },
        selectedRegion: undefined, selectedCountry: undefined,
        console: { error: (...args: unknown[]) => logCalls.push(args) },
    });
    const synthetic = new Error('synthetic-failure'); synthetic.name = 'synthetic-untrusted-name'.repeat(4096);
    let getterReads = 0;
    const hostile = Object.defineProperties({}, {
        name: { get() { getterReads++; throw new Error('unexpected getter'); } },
        message: { get() { getterReads++; throw new Error('unexpected getter'); } },
        toString: { get() { getterReads++; throw new Error('unexpected getter'); } },
    });
    let fixedLog: string | undefined;
    const lengths: number[] = [];
    for (const failure of [synthetic, hostile, 'synthetic-rejection', null, undefined]) {
        shouldReject = true; rejection = failure; logCalls = [];
        assert.equal(JSON.stringify(await queryFn()), '[]');
        assert.equal(logCalls.length, 1); assert.equal(logCalls[0].length, 1);
        const log = logCalls[0][0]; assert.equal(typeof log, 'string');
        fixedLog ??= log as string; assert.equal(log, fixedLog);
        assert(!(log as string).includes('synthetic')); lengths.push((log as string).length);
    }
    assert.equal(getterReads, 0);
    shouldReject = false; logCalls = [];
    const rows = [{ id: 'synthetic-row' }]; fetchResult = rows;
    assert.equal(await queryFn(), rows); assert.equal(mergeInput, rows); assert.equal(logCalls.length, 0);
    fetchResult = null; assert.equal(JSON.stringify(await queryFn()), '[]'); assert.equal(JSON.stringify(mergeInput), '[]');
    result.category.push({ rev, failureCases: lengths.length, fixedLog, maxLogCharacters: Math.max(...lengths), logArgumentCount: 1, getterReads, successRowIdentityPreserved: true, nullDataFallsBackToArray: true });
}

const currentMap = load('lib/map-restaurant-lookup.ts');
const oldMap = load('lib/map-restaurant-lookup.ts', PR3031);
const row = (id: string, name = id, children: string[] = []) => ({ id, name, lat: 37, lng: 127, mergedRestaurants: children.map(id => ({ id })) });
let mapCases = 0;
for (let index = 0; index < 512; index++) {
    const target = row(`id${index % 9}`, `name${index % 5}`, index % 2 ? [`child${index % 3}`, 'shared'] : []);
    const candidates = Array.from({ length: index % 13 }, (_, j) => row(`id${j % 9}`, `name${j % 5}`, j % 3 ? [`child${j % 3}`] : []));
    assert.equal(currentMap.findMatchingRestaurantInList(target, candidates), oldMap.findMatchingRestaurantInList(target, candidates));
    mapCases++;
}
for (const children of [[], ['shared']]) {
    const target = row('id', 'same-name', children);
    const early = row('early', 'same-name');
    const later = row(children.length ? 'shared' : 'id', 'other-name');
    for (const implementation of [currentMap, oldMap]) {
        assert.equal(implementation.findMatchingRestaurantInList(target, [early, later]), early);
        assert.equal(implementation.findMatchingRestaurantInList(target, [later, early]), later);
    }
}
function outcome(fn: () => unknown) { try { return { returned: JSON.stringify(fn()) }; } catch { return { threw: true }; } }
result.map = { validCases: mapCases, mismatches: 0, earliestNameAndCoordinateBeforeIdPreserved: true,
    nullableContract: [[null, []], [undefined, []], [row('r'), null], [row('r'), undefined]].map(([target, list]) => ({ current: outcome(() => currentMap.findMatchingRestaurantInList(target, list)), oldHead: outcome(() => oldMap.findMatchingRestaurantInList(target, list)) })) };

result.homeKpi = [];
for (const rev of ['current', PR3031]) {
    const helpers = load('lib/dashboard/helpers.ts', rev);
    const kpi = load('lib/home-map-youtube-kpi.ts', rev, {
        '@/lib/dashboard/helpers': helpers,
        '@/lib/home-map-theme-filters': { isYoutubeMetadataBackedHomeMapThemeFilterId: () => true },
    });
    const entry: any = { youtube_link: ' ', mergedYoutubeLinks: ['', 'https://youtu.be/abcdefghijk'], mergedRestaurants: [{ youtube_link: null }] };
    assert.equal(JSON.stringify(kpi.collectHomeMapYoutubeVideoIds([])), '[]');
    assert.equal(JSON.stringify(kpi.collectHomeMapYoutubeVideoIds([entry])), '["abcdefghijk"]');
    entry.youtube_link = 'https://youtu.be/zzzzzzzzzzz';
    assert.equal(JSON.stringify(kpi.collectHomeMapYoutubeVideoIds([entry])), '["zzzzzzzzzzz","abcdefghijk"]');
    assert.equal(JSON.stringify(kpi.chunkHomeMapYoutubeVideoIds([], 0)), '[]');
    assert.equal(JSON.stringify(kpi.chunkHomeMapYoutubeVideoIds(['abcdefghijk'], NaN)), '[["abcdefghijk"]]');
    result.homeKpi.push({ rev, emptyArraySafe: true, blankLinksIgnored: true, changedLinkReread: true, nullInput: outcome(() => kpi.collectHomeMapYoutubeVideoIds(null)), undefinedInput: outcome(() => kpi.collectHomeMapYoutubeVideoIds(undefined)) });
}

const constants = load('constants/overseas-regions.ts');
const regionHelpers = load('lib/overseas-region-matching.ts', 'current', { '@/constants/overseas-regions': constants });
const queries = (rev: string) => {
    const tree = ast('hooks/use-restaurants.tsx', rev);
    const node = findNode(tree, n => ts.isIfStatement(n) && n.expression.getText(tree) === 'normalizedRegion');
    return (region: string) => {
        const query: unknown[] = [];
        runInNewContext(js(node.getText(tree)), { normalizedRegion: region, query, ...constants, ...regionHelpers });
        return JSON.stringify(query);
    };
};
const currentQuery = queries('current'), oldQuery = queries(PR3032);
const regions = [...Object.keys(constants.OVERSEAS_REGIONS), ...new Set(Object.values(constants.OVERSEAS_REGIONS).map((x: any) => x.country)), '서울', '울릉도', '욕지도', 'synthetic),invalid%', ''];
for (const region of regions) assert.equal(currentQuery(region), oldQuery(region));
const keywords = Object.values(constants.OVERSEAS_REGIONS).flatMap((x: any) => x.keywords);
assert(keywords.every((term: string) => term === regionHelpers.sanitizePostgrestOrTerm(term)));
result.regionQuery = { cases: regions.length, mismatches: 0, constantKeywordCount: keywords.length, allCurrentKeywordsUnchangedBySanitizer: true, syntheticInputsOnly: true };
console.log(JSON.stringify(result, null, 2));
