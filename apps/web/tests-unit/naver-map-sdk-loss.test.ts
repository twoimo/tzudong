import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Run the actual selection/layout effect: the SDK can revoke `maps` after its
// script load event, while the previously created map still exists.
const text = readFileSync(new URL('../components/map/NaverMapView.tsx', import.meta.url), 'utf8');
const source = ts.createSourceFile('NaverMapView.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let body = '';
function collect(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect') {
        const callback = node.arguments[0];
        if (callback?.getText(source).includes('const target = resolveNaverMapTarget(')) body = callback.getText(source);
    }
    ts.forEachChild(node, collect);
}
collect(source);

function run(maps: unknown) {
    const calls: string[] = [];
    const refs = { previous: { current: null }, moved: { current: false } };
    const bindings = {
        window: { naver: { maps }, location: { search: '' } },
        mapInstanceRef: { current: { getZoom: () => { calls.push('getZoom'); return 12; }, setZoom: () => calls.push('setZoom'), setCenter: () => calls.push('setCenter') } },
        isGridMode: false, isInitialLoadFromUrlRef: { current: false },
        selectedRestaurant: { id: 'selected', lat: 37.5, lng: 127 }, selectedRegion: null,
        prevSelectedRestaurantIdRef: refs.previous, propIsPanelOpen: true, internalPanelOpen: false,
        resolveNaverSelectionChange: () => ({ isSelectionChanged: true, nextSelectedId: 'selected' }),
        hasUserMovedMapRef: refs.moved, getDeviceAdjustedZoom: (value: number) => value, mapFocusZoom: null,
        parseNaverMapUrlState: () => ({}), resolveNaverMapTarget: () => ({ skip: false, targetLat: 37.5, targetLng: 127, targetZoom: 15 }),
        getViewportOffset: () => 0, resolveNaverTargetOffsets: () => ({ targetOffsetX: 0, targetOffsetY: 0 }),
        getMobileVerticalOffset: () => 0, isMobileOrTablet: false,
        lastImmediateMarkerCenterRef: { current: null }, shouldPreserveNaverVisualCenterOnLayoutShift: () => false,
        resolveNaverCenteringTransitionResizePlan: () => ({ initialResizeEvent: 'resize' }),
        getAdjustedCenter: () => ({ lat: 37.5, lng: 127 }),
    };
    expect(body).not.toBe('');
    const js = ts.transpileModule(`const effect = ${body};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function(...Object.keys(bindings), `${js}; return effect();`)(...Object.values(bindings));
    return { calls, previous: refs.previous.current };
}

for (const maps of [null, undefined, {}]) {
    test(`selection effect leaves a revoked/incomplete SDK untouched: ${String(maps)}`, () => {
        expect(run(maps)).toEqual({ calls: [], previous: null });
    });
}

test('available SDK still resizes and centers the selected restaurant', () => {
    const events: string[] = [];
    const result = run({ Event: { trigger: (_map: unknown, name: string) => events.push(name) }, LatLng: class {}, Point: class {} });
    expect(events).toEqual(['resize']);
    expect(result).toEqual({ calls: ['getZoom', 'getZoom', 'setZoom', 'setCenter'], previous: 'selected' });
});
