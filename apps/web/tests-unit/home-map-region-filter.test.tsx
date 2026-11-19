import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { Globe, MapPin } from 'lucide-react';
import { MapFilterTriggerLabel } from '../components/filters/MapFilterTriggerLabel';
import { homeMapResultStatusText, type HomeMapResultSummary } from '../lib/home-map-result-summary';
import { cn } from '../lib/utils';
import type { HomeMapRegionFilterProps } from '../components/home/HomeMapRegionFilter';
import { getHomeMapRegionOptionCount } from '../components/home/home-map-region-option-count';

type Element = React.ReactElement<Record<string, unknown>>;
const summary: HomeMapResultSummary = {
    active: false, status: 'ready', count: 17, restaurants: [],
    regionCounts: {}, countryCounts: {}, categoryCounts: {},
};
const options = [
    { value: 'all', label: '전체 지역', count: 17 },
    { value: 'seoul-id', label: '서울특별시', count: 812 },
    { value: 'busan-id', label: '부산광역시', count: 0 },
    { value: 'unknown-id', label: '아직 집계되지 않은 긴 지역 이름' },
] as const;
const compiled = ts.transpileModule(readFileSync(new URL('../components/home/HomeMapRegionFilter.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Like the nearby VM hook tests, exercise production handlers without global module mocks.
// Only React state and UI boundaries are simulated; Radix/cmdk own DOM/keyboard behavior.
function fixture(overrides: Partial<HomeMapRegionFilterProps> = {}) {
    let states: unknown[] = [];
    let cursor = 0;
    let mountedKey: string | null | undefined;
    let focusCount = 0;
    const calls: string[] = [];
    let props: HomeMapRegionFilterProps = {
        mapMode: 'domestic', value: 'all', options, resultSummary: summary,
        onValueChange: (value) => { calls.push(value); }, ...overrides,
    };
    const exports: { HomeMapRegionFilter?: (props: HomeMapRegionFilterProps) => React.ReactElement } = {};
    vm.runInNewContext(compiled, { exports, require(name: string) {
        if (name === 'react') return {
            useId: () => 'region-filter-status',
            useRef(initial: unknown) {
                const index = cursor++;
                if (index >= states.length) states[index] = { current: initial };
                return states[index];
            },
            useState(initial: unknown) {
                const index = cursor++;
                if (index >= states.length) states[index] = initial;
                return [states[index], (next: unknown) => { states[index] = next; }];
            },
        };
        if (name === 'react/jsx-runtime') return jsxRuntime;
        if (name === 'lucide-react') return { Globe, MapPin, Check: 'Check', ChevronsUpDown: 'ChevronsUpDown' };
        if (name === '@/components/filters/MapFilterTriggerLabel') return { MapFilterTriggerLabel };
        if (name === '@/lib/home-map-result-summary') return { homeMapResultStatusText };
        if (name === '@/lib/utils') return { cn };
        if (name === '@/components/ui/button') return { Button: 'Button' };
        if (name === '@/components/ui/popover') return { Popover: 'Popover', PopoverTrigger: 'PopoverTrigger', PopoverContent: 'PopoverContent' };
        if (name === '@/components/ui/command') return Object.fromEntries(
            ['Command', 'CommandEmpty', 'CommandGroup', 'CommandInput', 'CommandItem', 'CommandList'].map((key) => [key, key]),
        );
        throw new Error(`UNEXPECTED_REGION_FILTER_IMPORT: ${name}`);
    } });
    let tree: Element;
    function render(update: Partial<HomeMapRegionFilterProps> = {}) {
        props = { ...props, ...update };
        const keyed = exports.HomeMapRegionFilter!(props);
        // React remounts a keyed component when the map mode changes.
        if (mountedKey !== keyed.key) { states = []; mountedKey = keyed.key; }
        cursor = 0;
        tree = (keyed.type as (input: HomeMapRegionFilterProps) => Element)(props);
        const inputRef = one('CommandInput').props.ref as { current: unknown };
        inputRef.current = { focus: () => { focusCount += 1; } };
    }
    function nodes(type: Element['type']): Element[] {
        const found: Element[] = [];
        function walk(node: React.ReactNode) {
            React.Children.forEach(node, (child) => {
                if (!React.isValidElement<Record<string, unknown>>(child)) return;
                if (child.type === type) found.push(child);
                walk(child.props.children as React.ReactNode);
            });
        }
        walk(tree);
        return found;
    }
    function one(type: Element['type']) {
        const matches = nodes(type);
        if (matches.length !== 1) throw new Error(`EXPECTED_ONE_${String(type)}`);
        return matches[0];
    }
    function invoke(type: Element['type'], handler: string, value: unknown) {
        (one(type).props[handler] as (value: unknown) => void)(value);
        render();
    }
    render();
    return {
        calls, nodes, one, render,
        trigger: () => nodes('Button').find((node) => node.props.role === 'combobox')!,
        get focusCount() { return focusCount; },
        resetSearch() {
            const resetButton = nodes('Button').find((node) => typeof node.props.onClick === 'function')!;
            (resetButton.props.onClick as () => void)();
            render();
        },
        open: () => invoke('Popover', 'onOpenChange', true),
        close: () => invoke('Popover', 'onOpenChange', false),
        search: (query: string) => invoke('CommandInput', 'onValueChange', query),
        select(value: string) {
            const item = nodes('CommandItem').find((node) => node.props.value === value);
            if (!item) throw new Error('MISSING_OPTION');
            (item.props.onSelect as () => void)();
            render();
        },
    };
}

describe('HomeMapRegionFilter controlled UI', () => {
    test('uses supplied labels/counts and keeps unknown distinct from a ready zero', () => {
        const f = fixture({ value: 'unknown-id' });
        expect(f.one('Command').props.defaultValue).toBe('unknown-id');
        // cmdk's generated label names the input through aria-labelledby.
        expect(f.one('Command').props.label).toBe('지역 검색');
        expect(f.one('Command').props.label).toBe(f.one('CommandInput').props['aria-label']);
        expect(f.one(MapFilterTriggerLabel).props.count).toBeUndefined();
        expect(renderToStaticMarkup(f.one(MapFilterTriggerLabel))).not.toContain('data-map-filter-count');
        const rows = f.nodes('CommandItem');
        expect(rows).toHaveLength(options.length);
        const unknown = rows.find((row) => row.props.value === 'unknown-id')!;
        expect(React.Children.toArray(unknown.props.children as React.ReactNode).some((child) =>
            React.isValidElement<Record<string, unknown>>(child) && String(child.props.className).includes('tabular-nums'),
        )).toBe(false);
        f.render({ value: 'busan-id' });
        expect(f.one('Command').props.defaultValue).toBe('busan-id');
        expect(f.one(MapFilterTriggerLabel).props.count).toBe(0);
        expect(renderToStaticMarkup(f.one(MapFilterTriggerLabel))).toContain('(0개)');
        const zeroRow = f.nodes('CommandItem').find((row) => row.props.value === 'busan-id')!;
        const count = React.Children.toArray(zeroRow.props.children as React.ReactNode).at(-1) as Element;
        expect(count.props.children).toEqual([0, '개']);
        f.render({ value: 'seoul-id' });
        expect(f.one('Command').props.defaultValue).toBe('seoul-id');
        expect(f.one(MapFilterTriggerLabel).props.count).toBe(812);
        // The component must not replace option scope with the summary's total of 17.
        expect(renderToStaticMarkup(f.one(MapFilterTriggerLabel))).toContain('(812개)');
    });

    for (const status of ['pending', 'error', 'select-country'] as const) {
        test(`${status} hides even stale numeric counts and exposes honest status`, () => {
            const resultSummary = { ...summary, status };
            const f = fixture({ value: 'seoul-id', resultSummary });
            expect(f.one(MapFilterTriggerLabel).props.count).toBeUndefined();
            expect(f.nodes('span').some((node) => String(node.props.className).includes('tabular-nums'))).toBe(false);
            const liveStatus = f.nodes('span').find((node) => node.props.role === 'status')!;
            expect(liveStatus.props.children).toBe(homeMapResultStatusText(resultSummary));
            expect(f.trigger().props['aria-describedby']).toBe(liveStatus.props.id);
        });
    }

    test('search matches labels, including case/whitespace, rather than counts or option IDs', () => {
        const f = fixture({ options: [...options, { value: 'us-id', label: 'United States', count: 56 }] });
        const filter = f.one('Command').props.filter as (value: string, query: string) => number;
        expect(filter('seoul-id', ' 서울 ')).toBe(1);
        expect(filter('seoul-id', '812')).toBe(0);
        expect(filter('seoul-id', 'seoul-id')).toBe(0);
        expect(filter('seoul-id', '부산')).toBe(0);
        expect(filter('us-id', ' united ')).toBe(1);
        expect(filter('us-id', '')).toBe(1);
        expect(filter('missing', '서울')).toBe(0);
        f.render({ options: [], value: undefined });
        expect(f.nodes('CommandItem')).toHaveLength(0);
        expect(f.one(MapFilterTriggerLabel).props.label).toBe('지역');
    });

    test('single selection emits once, closes/resets search, and waits for the controlled value', () => {
        const f = fixture();
        f.open();
        f.search('서울');
        expect(f.one('CommandInput').props.value).toBe('서울');
        f.select('seoul-id');
        expect(f.calls).toEqual(['seoul-id']);
        expect(f.one('Popover').props.open).toBe(false);
        expect(f.one('CommandInput').props.value).toBe('');
        expect(f.one(MapFilterTriggerLabel).props.label).toBe('전체 지역');
        f.render({ value: 'seoul-id' });
        expect(f.one(MapFilterTriggerLabel).props.label).toBe('서울특별시');
        f.open();
        expect(f.one('CommandInput').props.value).toBe('');
        f.select('all');
        expect(f.calls).toEqual(['seoul-id', 'all']);
    });

    test('empty-search recovery restores all options and input focus without changing the selected region', () => {
        const f = fixture({ value: 'seoul-id' });
        f.open();
        f.search('일치하지 않는 검색어');
        const filter = f.one('Command').props.filter as (value: string, query: string) => number;
        expect(options.every((option) => filter(option.value, f.one('CommandInput').props.value as string) === 0)).toBe(true);

        f.resetSearch();

        expect(f.one('CommandInput').props.value).toBe('');
        expect(options.every((option) => filter(option.value, f.one('CommandInput').props.value as string) === 1)).toBe(true);
        expect(f.focusCount).toBe(1);
        expect(f.one('Popover').props.open).toBe(true);
        expect(f.one(MapFilterTriggerLabel).props.label).toBe('서울특별시');
        expect(f.calls).toEqual([]);
    });

    test('selecting the current value closes and resets search without emitting another selection', () => {
        const f = fixture({ value: 'seoul-id' });
        f.open();
        f.search('서울');
        f.select('seoul-id');
        expect(f.calls).toEqual([]);
        expect(f.one('Popover').props.open).toBe(false);
        expect(f.one('CommandInput').props.value).toBe('');
        f.open();
        expect(f.one(MapFilterTriggerLabel).props.label).toBe('서울특별시');
        expect(f.one('CommandInput').props.value).toBe('');
        f.render({ value: 'all' });
        f.select('all');
        expect(f.calls).toEqual([]);
    });

    test('dismissal resets search without changing selection and leaves keyboard handling to primitives', () => {
        const f = fixture();
        f.open();
        f.search('없는 지역');
        f.close();
        f.open();
        expect(f.calls).toEqual([]);
        expect(f.one('CommandInput').props.value).toBe('');
        expect(f.one('Command').props.onKeyDown).toBeUndefined();
        expect(f.one('CommandInput').props.onKeyDown).toBeUndefined();
        expect(f.one('PopoverContent').props.onEscapeKeyDown).toBeUndefined();
        expect(f.trigger().props.type).toBe('button');
        expect(f.trigger().props['aria-expanded']).toBe(true);
    });

    test('mode changes remount closed search state and switch region/country semantics and icon', () => {
        const f = fixture({ value: undefined });
        expect(f.one(MapFilterTriggerLabel).props.icon).toBe(MapPin);
        f.open();
        f.search('서울');
        f.render({ mapMode: 'overseas', value: 'japan', options: [{ value: 'japan', label: '일본', count: 5 }] });
        expect(f.one('Popover').props.open).toBe(false);
        expect(f.one('CommandInput').props.value).toBe('');
        expect(f.trigger().props['aria-label']).toBe('국가 선택: 일본');
        expect(f.trigger().props.title).toBe('국가 필터: 일본');
        expect(f.one('CommandInput').props['aria-label']).toBe('국가 검색');
        expect(f.one('Command').props.label).toBe('국가 검색');
        expect(f.one(MapFilterTriggerLabel).props.icon).toBe(Globe);
        expect(f.one('PopoverContent').props.side).toBe('top');
        expect(f.one('PopoverContent').props.align).toBe('start');
        f.open();
        f.search('일본');
        f.render({ mapMode: 'domestic', options, value: undefined });
        expect(f.one('Popover').props.open).toBe(false);
        expect(f.one('CommandInput').props.value).toBe('');
        expect(f.calls).toEqual([]);
    });
});

describe('home map region count scope', () => {
    test('keeps a selected region zero distinct from unqueried regions and the national total', () => {
        const current = { ...summary, count: 0, regionCounts: {} };
        const scope = { mapMode: 'domestic' as const, selectedRegion: '울산광역시', selectedCountry: null };
        expect(getHomeMapRegionOptionCount(current, scope, '울산광역시')).toBe(0);
        expect(getHomeMapRegionOptionCount(current, scope, '서울특별시')).toBeUndefined();
        expect(getHomeMapRegionOptionCount(current, scope, 'all')).toBeUndefined();
    });

    test('publishes regional facets and the total when the current query covers all domestic regions', () => {
        const current = { ...summary, count: 17, regionCounts: { 서울특별시: 12, 부산광역시: 5 } };
        const scope = { mapMode: 'domestic' as const, selectedRegion: null, selectedCountry: null };
        expect(getHomeMapRegionOptionCount(current, scope, 'all')).toBe(17);
        expect(getHomeMapRegionOptionCount(current, scope, '서울특별시')).toBe(12);
        expect(getHomeMapRegionOptionCount(current, scope, '부산광역시')).toBe(5);
        expect(getHomeMapRegionOptionCount(current, scope, '울산광역시')).toBe(0);
    });

    test('only publishes the queried country and hides pending or failed counts', () => {
        const current = { ...summary, count: 7, countryCounts: { 일본: 7 } };
        const scope = { mapMode: 'overseas' as const, selectedRegion: null, selectedCountry: '일본' };
        expect(getHomeMapRegionOptionCount(current, scope, '일본')).toBe(7);
        expect(getHomeMapRegionOptionCount(current, scope, '미국')).toBeUndefined();
        expect(getHomeMapRegionOptionCount(current, { ...scope, selectedCountry: null }, '일본')).toBeUndefined();
        for (const status of ['pending', 'error', 'select-country'] as const) {
            expect(getHomeMapRegionOptionCount({ ...current, status }, scope, '일본')).toBeUndefined();
        }
    });
});
