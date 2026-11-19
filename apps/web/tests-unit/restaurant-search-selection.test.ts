import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('RestaurantSearch.tsx', readFileSync(
  new URL('../components/search/RestaurantSearch.tsx', import.meta.url), 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw new Error('Missing production search boundary');
  return found;
}

function execute<T>(node: ts.Node, bindings: Record<string, unknown>): T {
  const compiled = ts.transpileModule(`return (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as T;
}

function callback<T>(name: string, bindings: Record<string, unknown>): T {
  const declaration = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration;
  return execute<T>((declaration.initializer as ts.CallExpression).arguments[0], bindings);
}

type RestaurantFixture = { id: string; name: string; road_address: string };
type ReadResult = { data: RestaurantFixture[] | null; error: unknown };
type PendingRead = { resolve: (result: ReadResult) => void; reject: (reason: unknown) => void };
const first = { id: 'synthetic-first', name: '첫 선택 식당', road_address: '합성 주소' };
const second = { id: 'synthetic-second', name: '나중 선택 식당', road_address: '합성 주소' };

// Run production setters, selection callbacks and lifecycle cleanup. All IO is
// deferred in memory: no account, history store, provider or real request is used.
function setup() {
  const searchIntentGenerationRef = { current: 0 };
  const state = { query: '', type: 'name', focused: false, inputFocusCount: 0 };
  const selected: string[] = [];
  const recorded: string[] = [];
  const counted: string[] = [];
  const reads: PendingRead[] = [];
  const setSearchQuery = callback<(value: string) => void>('setSearchQuery', {
    searchIntentGenerationRef, onSearchQueryChange: undefined, searchQueryValue: undefined,
    setInternalSearchQuery: (value: string) => { state.query = value; },
  });
  const setSearchType = callback<(value: string) => void>('setSearchType', {
    searchIntentGenerationRef, onSearchTypeChange: undefined, searchTypeValue: undefined,
    setInternalSearchType: (value: string) => { state.type = value; },
  });
  const setIsFocused = (value: boolean) => { state.focused = value; };
  const handleSelect = callback<(restaurant: RestaurantFixture) => void>('handleSelect', {
    searchIntentGenerationRef, setSearchQuery, setIsFocused, clearQueryOnSelect: true,
    incrementSearchCount: async (id: string) => { counted.push(id); return null; },
    shouldRefreshPopularAfterSearch: () => false, queryClient: { invalidateQueries: () => {} },
    addToHistory: (restaurant: RestaurantFixture) => { recorded.push(restaurant.id); },
    onRestaurantSearch: undefined, onSearchExecute: undefined,
    onRestaurantSelect: (restaurant: RestaurantFixture) => { selected.push(restaurant.id); },
  });
  const select = callback<(name: string, id?: string) => Promise<void>>('handleHistoryOrPopularSelect', {
    searchIntentGenerationRef, setSearchQuery, setSearchType, setIsFocused, handleSelect,
    focusSearchInput: () => { state.inputFocusCount += 1; },
    RESTAURANT_SEARCH_SELECT: 'id', mergeRestaurants: (rows: RestaurantFixture[]) => rows,
    supabase: { from: () => {
      const pending = {} as PendingRead;
      const promise = new Promise<ReadResult>((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
      reads.push(pending);
      const chain = {
        select: () => chain, eq: () => chain,
        then: (resolve: (value: ReadResult) => unknown, reject: (reason: unknown) => unknown) => promise.then(resolve, reject),
      };
      return chain;
    } },
  });
  const lifecycle = find(node => ts.isCallExpression(node) && node.expression.getText(source) === 'useLayoutEffect'
    && node.arguments[0]?.getText(source).includes('searchIntentGenerationRef.current')) as ts.CallExpression;
  const dependencies = lifecycle.arguments[1] as ts.ArrayLiteralExpression;
  expect(dependencies.elements.map(node => node.getText(source))).toEqual(['searchQuery', 'searchType']);
  const leaveInputScope = execute<() => () => void>(lifecycle.arguments[0], { searchIntentGenerationRef })();
  return { state, selected, recorded, counted, reads, select, setSearchQuery, setSearchType, handleSelect, leaveInputScope };
}

function finish(read: PendingRead, outcome: 'success' | 'failure' | 'network', restaurant = first) {
  if (outcome === 'network') read.reject(new Error('SYNTHETIC_NETWORK_FAILURE'));
  else read.resolve(outcome === 'success' ? { data: [restaurant], error: null } : { data: null, error: { code: 'unavailable' } });
}

describe('restaurant search selection intent', () => {
  test.each(['success', 'failure', 'network'] as const)('new query survives a late %s response', async outcome => {
    const ui = setup();
    const pending = ui.select(first.name, first.id);
    ui.setSearchQuery('새로 입력한 검색어');
    finish(ui.reads[0], outcome);
    await pending;
    expect(ui.state.query).toBe('새로 입력한 검색어');
    expect([ui.selected, ui.recorded, ui.counted]).toEqual([[], [], []]);
    expect(ui.state.inputFocusCount).toBe(0);
  });

  test.each(['success', 'failure', 'network'] as const)('new search mode survives a late %s response', async outcome => {
    const ui = setup();
    const pending = ui.select(first.name, first.id);
    ui.setSearchType('youtube');
    finish(ui.reads[0], outcome);
    await pending;
    expect(ui.state.type).toBe('youtube');
    expect(ui.state.query).toBe('');
    expect([ui.selected, ui.recorded, ui.counted]).toEqual([[], [], []]);
  });

  test.each(['success', 'failure', 'network'] as const)('only the latest history selection can apply after an older %s', async outcome => {
    const ui = setup();
    const older = ui.select(first.name, first.id);
    const newer = ui.select(second.name, second.id);
    finish(ui.reads[0], outcome);
    await older;
    expect([ui.selected, ui.recorded, ui.counted]).toEqual([[], [], []]);
    expect(ui.state.inputFocusCount).toBe(0);
    finish(ui.reads[1], 'success', second);
    await newer;
    expect(ui.selected).toEqual([second.id]);
    expect(ui.recorded).toEqual([second.id]);
    expect(ui.counted).toEqual([second.id]);
    expect(ui.state.query).toBe('');
  });

  test('a direct result selection invalidates an older history lookup', async () => {
    const ui = setup();
    const pending = ui.select(first.name, first.id);
    ui.handleSelect(second);
    finish(ui.reads[0], 'success');
    await pending;
    expect(ui.selected).toEqual([second.id]);
    expect(ui.recorded).toEqual([second.id]);
    expect(ui.counted).toEqual([second.id]);
  });

  test.each(['success', 'failure', 'network'] as const)('controlled input scope changes and unmount ignore a late %s', async outcome => {
    const ui = setup();
    const pending = ui.select(first.name, first.id);
    ui.leaveInputScope();
    finish(ui.reads[0], outcome);
    await pending;
    expect(ui.state).toEqual({ query: '', type: 'name', focused: false, inputFocusCount: 0 });
    expect([ui.selected, ui.recorded, ui.counted]).toEqual([[], [], []]);
  });

  test.each(['failure', 'network'] as const)('the current %s still recovers into normal name search', async outcome => {
    const ui = setup();
    ui.setSearchType('youtube');
    const pending = ui.select(first.name, first.id);
    finish(ui.reads[0], outcome);
    await pending;
    expect(ui.state).toEqual({ query: first.name, type: 'name', focused: true, inputFocusCount: 1 });
    expect([ui.selected, ui.recorded, ui.counted]).toEqual([[], [], []]);
  });
});
