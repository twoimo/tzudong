import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

import type { Restaurant } from '../types/restaurant';
import { getAdjacentRestaurantByStep } from '../lib/home-map-keyboard-navigation';
import { shouldDismissSheetFromPeek } from '../lib/mobile-sheet-dismiss-gesture';
import { buildPostSearchSwipeCandidates, releaseSearchSelectionOwnership } from '../lib/mobile-home-search-selection';
import { buildMarkerRenderSignature, shouldSkipMarkerUpdate } from '../lib/map-render-guard';
import { resolveMobileMapBlankTapAction } from '../lib/mobile-map-fullscreen-toggle';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');
const expectSourceOrder = (sourceText: string, before: string, after: string) => {
    const beforeIndex = sourceText.indexOf(before);
    const afterIndex = sourceText.indexOf(after);

    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(afterIndex).toBeGreaterThanOrEqual(0);
    expect(beforeIndex).toBeLessThan(afterIndex);
};


const makeRestaurant = (id: string, name: string): Restaurant =>
    ({
        id,
        name,
        lat: 37.5665,
        lng: 126.978,
    }) as Restaurant;

type MapPadding = { top: number; bottom: number; left: number; right: number } | undefined;
const mapContainerSource = ts.createSourceFile('home-map-container.tsx',
    source('components/home/home-map-container.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function mapViewportExpression(kind: 'padding' | 'resize') {
    let expression: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
        if (kind === 'padding' && ts.isVariableDeclaration(node)
            && node.name.getText(mapContainerSource) === 'mapPadding') expression = node.initializer;
        if (kind === 'resize' && ts.isCallExpression(node) && node.expression.getText(mapContainerSource) === 'useEffect'
            && node.arguments[0]?.getText(mapContainerSource).includes('setViewportHeight(viewport.height)')) {
            expression = node.arguments[0];
        }
        ts.forEachChild(node, visit);
    };
    visit(mapContainerSource);
    if (!expression) throw new Error(`HOME_MAP_${kind.toUpperCase()}_EXPRESSION_MISSING`);
    return ts.transpileModule(`(${expression.getText(mapContainerSource)})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
}

function mapPaddingHarness() {
    const code = mapViewportExpression('padding');
    let dependencies: unknown[] | undefined;
    let cached: MapPadding;
    let calculations = 0;
    const state = {
        isPanelOpen: true, isMapFullscreen: false, isDesktop: false,
        renderDesktopDetailPanel: true, sheetHeight: 50, viewportHeight: 844,
    };
    return {
        calculations: () => calculations,
        render(overrides: Partial<typeof state> = {}, layoutHeight = 844): MapPadding {
            Object.assign(state, overrides);
            // Execute the production callback AND its dependency array. Retain
            // the memo across renders so a missing resize dependency fails.
            return vm.runInNewContext(code, {
                ...state,
                window: { innerHeight: layoutHeight },
                useMemo: (calculate: () => MapPadding, next: unknown[]) => {
                    if (!dependencies || next.some((value, index) => !Object.is(value, dependencies![index]))) {
                        cached = calculate();
                        calculations++;
                        dependencies = [...next];
                    }
                    return cached;
                },
            }) as MapPadding;
        },
    };
}

describe('overseas map padding follows the rendered detail sheet viewport', () => {
    test('the actual resize effect refreshes memoized padding without changing the sheet percentage', () => {
        const map = mapPaddingHarness();
        expect(map.render()?.bottom).toBe(422);
        const listeners = new Map<string, () => void>();
        const viewport = {
            height: 844,
            addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
            removeEventListener: (type: string) => listeners.delete(type),
        };
        const viewportHeightRef = { current: 844 };
        let viewportHeight = 844;
        let sheetHeight = 50;
        let renderFrame: (() => void) | undefined;
        const mount = vm.runInNewContext(mapViewportExpression('resize'), {
            window: { visualViewport: viewport },
            viewportHeightRef,
            isDraggingRef: { current: false },
            setViewportHeight: (value: number) => { viewportHeight = value; },
            setSheetHeight: (update: (current: number) => number) => { sheetHeight = update(sheetHeight); },
            getCurrentMaxHeight: () => 100,
            PEEK_SHEET_HEIGHT: 25,
            requestAnimationFrame: (callback: () => void) => { renderFrame = callback; return 1; },
            cancelAnimationFrame: () => {},
        }) as () => () => void;
        const cleanup = mount();
        viewport.height = 390;
        listeners.get('resize')!();
        expect(viewportHeight).toBe(844);
        renderFrame!();
        expect(viewportHeightRef.current).toBe(390);
        expect(sheetHeight).toBe(50);
        expect(map.render({ viewportHeight, sheetHeight }, 390)?.bottom).toBe(195);
        expect(map.calculations()).toBe(2);
        cleanup();
        expect(listeners.size).toBe(0);
    });

    test('visual viewport height stays authoritative when the layout viewport is taller', () => {
        const map = mapPaddingHarness();
        expect(map.render({ viewportHeight: 500 }, 844)?.bottom).toBe(250);
        expect(map.render({}, 936)?.bottom).toBe(250);
        expect(map.calculations()).toBe(1);
    });

    test('desktop offsets, fullscreen, and closed-panel behavior remain unchanged', () => {
        const map = mapPaddingHarness();
        expect(map.render({ isDesktop: true })).toEqual({ top: 0, bottom: 0, left: 0, right: 400 });
        expect(map.render({ renderDesktopDetailPanel: false })).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
        expect(map.render({ isMapFullscreen: true })).toBeUndefined();
        expect(map.render({ isMapFullscreen: false, isPanelOpen: false })).toBeUndefined();
    });

    test('sheet padding keeps the existing percentage bounds', () => {
        const map = mapPaddingHarness();
        expect(map.render({ sheetHeight: -10 })?.bottom).toBe(0);
        expect(map.render({ sheetHeight: 150 })?.bottom).toBe(844);
        expect(map.render({ sheetHeight: 25 })?.bottom).toBe(211);
    });
});

describe('mobile home map regression guards', () => {
    test('search-selected restaurant can still swipe to a different visible restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearbyMarkerRestaurant = makeRestaurant('marker-next', '명동칼국수');
        const anotherNearbyRestaurant = makeRestaurant('marker-third', '서울돈까스');

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: [searchedRestaurant, nearbyMarkerRestaurant, anotherNearbyRestaurant],
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-next');
    });

    test('marker render is not skipped when another marker takes over after a search selection', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-next',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('marker render is not skipped when the sheet closes and a new marker opens with cleared search state', () => {
        const sharedBounds = {
            south: 37.565,
            west: 126.977,
            north: 37.568,
            east: 126.98,
        } as const;
        const sharedDisplayIds = ['search-selected', 'marker-next', 'marker-third'] as const;

        const previous = buildMarkerRenderSignature({
            zoom: 15,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'search-selected',
            searchedRestaurantId: 'search-selected',
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        const next = buildMarkerRenderSignature({
            zoom: previous.zoom,
            bounds: sharedBounds,
            displayRestaurantIds: sharedDisplayIds,
            selectedRestaurantId: 'marker-third',
            searchedRestaurantId: null,
            isClusterMode: false,
            isRegionalClusterMode: false,
            isSeoulDistrictMode: false,
        });

        expect(shouldSkipMarkerUpdate(previous, next)).toBe(false);
    });

    test('single-visible post-search swipe falls back to the nearest restaurant', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');
        const nearestRestaurant = {
            ...makeRestaurant('marker-nearest', '서울돈까스'),
            lat: 37.5661,
            lng: 126.9772,
        } as Restaurant;
        const fartherRestaurant = {
            ...makeRestaurant('marker-farther', '명동칼국수'),
            lat: 37.56695,
            lng: 126.97885,
        } as Restaurant;

        const swipeCandidates = buildPostSearchSwipeCandidates({
            visibleRestaurants: [searchedRestaurant],
            allRestaurants: [searchedRestaurant, fartherRestaurant, nearestRestaurant],
            activeSearchedRestaurant: searchedRestaurant,
        });

        const nextRestaurant = getAdjacentRestaurantByStep({
            restaurants: swipeCandidates,
            currentRestaurant: searchedRestaurant,
            step: 1,
            isSameRestaurant: (left, right) => left.id === right.id,
        });

        expect(nextRestaurant?.id).toBe('marker-nearest');
    });

    test('search ownership release keeps the current detail selection active', () => {
        const searchedRestaurant = makeRestaurant('search-selected', '정원분식');

        expect(
            releaseSearchSelectionOwnership({
                searchedRestaurant,
                selectedRestaurant: searchedRestaurant,
                panelRestaurant: searchedRestaurant,
                isPanelOpen: true,
            })
        ).toMatchObject({
            searchedRestaurant: null,
            selectedRestaurant: searchedRestaurant,
            panelRestaurant: searchedRestaurant,
            isPanelOpen: true,
        });
    });

    test('peek-state downward sheet gesture dismisses only after intentional distance or speed', () => {
        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 64,
            gestureVelocity: 0.12,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.3,
            minVelocityPxPerMs: 0.26,
        })).toBe(true);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: true,
            dragDistancePx: 18,
            gestureVelocity: 0.12,
            minVelocityPxPerMs: 0.26,
        })).toBe(false);

        expect(shouldDismissSheetFromPeek({
            startedAtPeek: false,
            dragDistancePx: 80,
            gestureVelocity: 0.4,
        })).toBe(false);
    });

    test('blank map taps collapse the sheet, enter fullscreen map, then restore the peek sheet', () => {
        const baseState = {
            isMobileOrTablet: true,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            peekHeight: 25,
        };

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 50,
        })).toBe('collapse-to-peek');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: false,
            sheetHeight: 25,
        })).toBe('enter-map-fullscreen');

        expect(resolveMobileMapBlankTapAction({
            ...baseState,
            isMapFullscreen: true,
            sheetHeight: 25,
        })).toBe('restore-from-map-fullscreen');
    });

    test('blank map fullscreen toggle is inactive outside a mobile restaurant panel', () => {
        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: false,
            isPanelOpen: true,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');

        expect(resolveMobileMapBlankTapAction({
            isMobileOrTablet: true,
            isPanelOpen: false,
            hasPanelRestaurant: true,
            isMapFullscreen: false,
            sheetHeight: 50,
            peekHeight: 25,
        })).toBe('none');
    });

    test('cluster marker zoom jumps immediately without Naver morph animation', () => {
        const mapSource = source('components/map/NaverMapView.tsx');

        expect(mapSource).toContain('const jumpWithPanelOffset = useCallback');
        expect(mapSource).toContain('map.setZoom(targetZoom, false)');
        expect(mapSource).toContain('map.setCenter(adjustedCenter)');
        expect(mapSource).toContain('jumpWithPanelOffset(cluster.center.lat, cluster.center.lng, targetZoom)');
        expect(mapSource).toContain('jumpWithPanelOffset(lat, lng, targetZoom)');
        expect(mapSource).not.toContain('morphWithPanelOffset');
    });
    test('mobile restaurant detail sheet peeks on map interaction without skipping fullscreen tap sequence', () => {
        const containerSource = source('components/home/home-map-container.tsx');
        const naverMapSource = source('components/map/NaverMapView.tsx');
        const overseasMapSource = source('components/map/OverseasMap.tsx');

        expect(containerSource).toContain('const lastMapInteractionCollapseAtRef = useRef(0);');
        expect(containerSource).toContain('const handleMapUserInteraction = useCallback(() => {');
        expect(containerSource).toContain('lastMapInteractionCollapseAtRef.current = Date.now();');
        expect(containerSource).toContain('setSheetHeightSafe(PEEK_SHEET_HEIGHT, true);');
        expect(containerSource).toContain('if (now - lastMapInteractionCollapseAtRef.current < 450) return;');
        expect(containerSource.match(/onMapInteraction=\{handleMapUserInteraction\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
        expect(naverMapSource).toContain('const isSelectionClearedByPanelClose =');
        expect(naverMapSource).toContain('if (isSelectionClearedByPanelClose) {');
        expect(naverMapSource).toContain('if (isSelectionChanged && currentSelectedId) {');
        expect(naverMapSource).toContain("map.setCenter(newCenterLatLng);");
        expect(naverMapSource).not.toContain("map.panTo(newCenterLatLng, { duration: 340, easing: 'easeOutCubic' });");
        expect(naverMapSource).toContain('Number.isNaN(urlZoom)');

        expect(naverMapSource).toContain('onMapInteraction?: () => void;');
        expect(naverMapSource).toContain('onMapInteraction?.();');
        // SDK registration and retained-listener dispatch are executed in
        // naver-map-event-wiring.test.ts, without requiring inline callback syntax.
        expect(naverMapSource).toContain('onMapBlankClick, onMapInteraction');
        expect(overseasMapSource).toContain('onMapInteraction?: () => void;');
        expect(overseasMapSource).toContain('onMapInteractionRef.current?.();');
        expect(overseasMapSource).toContain("mapInstance.on('click', () => {");
        expect(naverMapSource).toContain('buildNaverMapInteractionHandlers({');
        expect(naverMapSource).toContain('onUserInteraction: () => {');
        expect(naverMapSource).toContain('const interactionListenerPlan = buildNaverMapInteractionListenerPlan();');
        expect(naverMapSource).toContain('interactionListenerPlan.domListeners.forEach(({ eventName, handlerKey }) => {');
        expect(source('lib/naver-map-interaction-helpers.ts')).toContain("mapEventNames: ['dragstart', 'pinchstart'] as const");
        expect(overseasMapSource).toContain("mapInstance.on('dragstart', () => {");
        expect(overseasMapSource).toContain("mapInstance.on('zoomstart', () => {");
        expect(overseasMapSource).toContain("mapContainerEl.addEventListener('wheel', handleWheel, { passive: false });");
        expectSourceOrder(
            naverMapSource,
            'onMapInteraction?.();',
            'onMapBlankClick();'
        );
        expectSourceOrder(
            overseasMapSource,
            'onMapInteractionRef.current?.();',
            'onMapBlankClickRef.current?.();'
        );
    });

    test('mobile visible marker sheet receives map interaction epoch before requesting peek height', () => {
        const homeClientSource = source('app/home-client.tsx');
        const homeControlPanelSource = source('components/home/home-control-panel.tsx');
        const overlaySource = source('components/home/MobileControlOverlay.tsx');

        expect(homeClientSource).toContain('const [mapInteractionEpoch, setMapInteractionEpoch] = useState(0);');
        expect(homeClientSource).toContain('const handleMapInteraction = useCallback(() => {');
        expect(homeClientSource).toContain('setMapInteractionEpoch((current) => current + 1);');
        expect(homeClientSource).toContain('onMapInteraction={handleMapInteraction}');
        expect(homeClientSource).toContain('mapInteractionEpoch={mapInteractionEpoch}');
        expect(homeControlPanelSource).toContain('mapInteractionEpoch?: number;');
        expect(homeControlPanelSource).toContain('mapInteractionEpoch={mapInteractionEpoch}');
        expect(overlaySource).toContain('const lastMapInteractionEpochRef = useRef(mapInteractionEpoch);');
        expect(overlaySource).toContain("if (activeSheet !== 'visibleMarkers') return;");
        expect(overlaySource).toContain('setVisibleMarkerSheetHeightRequestKey((key) => key + 1);');
        expect(overlaySource).toContain("height: VISIBLE_MARKER_SHEET_HEIGHT, mode: 'exact'");
        expectSourceOrder(
            overlaySource,
            'lastMapInteractionEpochRef.current = mapInteractionEpoch;',
            "if (activeSheet !== 'visibleMarkers') return;"
        );
    });

    test('G002 mobile category sheet commits immediately without delayed apply affordance', () => {
        const overlaySource = source('components/home/MobileControlOverlay.tsx');

        expect(overlaySource).not.toContain('적용하기');
        expect(overlaySource).toContain('data-mobile-category-sheet-commit="immediate"');
        expect(overlaySource).toContain('onCategoryChange([])');
        expect(overlaySource).toContain('onCategoryChange(newCategories)');

        // Exercise the real JSX callbacks; wording must not decide whether selection commits.
        const parsed = ts.createSourceFile('MobileControlOverlay.tsx', overlaySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const handlers: ts.ArrowFunction[] = [];
        const visit = (node: ts.Node) => {
            if (ts.isJsxAttribute(node) && node.name.getText(parsed) === 'onClick'
                && node.initializer && ts.isJsxExpression(node.initializer)
                && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
                handlers.push(node.initializer.expression);
            }
            ts.forEachChild(node, visit);
        };
        visit(parsed);
        const toggle = handlers.find((handler) => handler.getText(parsed).includes('onCategoryChange(newCategories)'));
        const clear = handlers.find((handler) => ts.isBlock(handler.body)
            && handler.body.statements.length === 1
            && handler.getText(parsed).includes('onCategoryChange([])'));
        const invoke = (handler: ts.ArrowFunction | undefined, selectedCategories: readonly string[], category = '') => {
            expect(handler).toBeDefined();
            const changes: string[][] = [];
            const code = ts.transpileModule(`(${handler!.getText(parsed)})`, {
                compilerOptions: { target: ts.ScriptTarget.ES2022 },
            }).outputText;
            const click = vm.runInNewContext(code, {
                selectedCategories,
                category,
                isSelected: selectedCategories.includes(category),
                onCategoryChange: (next: string[]) => { changes.push([...next]); },
            }) as () => void;
            click();
            return changes;
        };
        const selected = Object.freeze(['한식', '분식']);
        expect(invoke(toggle, selected, '양식')).toEqual([['한식', '분식', '양식']]);
        expect(invoke(toggle, selected, '한식')).toEqual([['분식']]);
        expect(invoke(clear, selected)).toEqual([[]]);
        expect(selected).toEqual(['한식', '분식']);

        const desktopPanelSource = source('components/home/home-desktop-control-panel.tsx');
        expect(desktopPanelSource).toContain('선택하면 즉시 적용됩니다.');
        expect(desktopPanelSource).toContain('onCategoryChange={onCategoryChange}');
        expect(desktopPanelSource).toContain('resultSummary={resultSummary}');
        const categoryFilterSource = source('components/filters/CategoryFilter.tsx');
        expect(categoryFilterSource).toContain('onSelect={() => handleCategoryToggle(category)}');
        expect(categoryFilterSource).toContain('onCategoryChange(newCategories)');
    });

    test('G012 mobile sheets and details own fixed map-control safe area', () => {
        const overlaySource = source('components/home/MobileControlOverlay.tsx');

        expect(overlaySource).toContain(
            'const doesDetailOwnBottomRightSafeArea = isPanelOpen && Boolean(panelRestaurant);'
        );
        expect(overlaySource).toContain(
            "const doesMobileSheetOwnFixedControlSpace =\n        doesDetailOwnBottomRightSafeArea || activeSheet !== 'none';"
        );
        expect(overlaySource).toContain(
            'const shouldRenderMobileBottomControls = !doesMobileSheetOwnFixedControlSpace;'
        );
        expect(overlaySource).toContain(
            'const shouldRenderMobileFloatingActions = !doesMobileSheetOwnFixedControlSpace;'
        );
        expect(overlaySource).toContain('data-mobile-bottom-right-safe-area-owner="mobile-floating-actions"');
        expect(overlaySource).toContain('data-fixed-control-region="mobile-map-actions"');
        expect(overlaySource).toContain('{shouldRenderMobileFloatingActions && (');
    });
    test('home detail route history uses app-owned list/detail states and browser back restoration contracts', () => {
        const homeSource = source('app/home-client.tsx');
        const effectsSource = source('app/home-client-effects.tsx');

        expect(homeSource).toContain('window.addEventListener("popstate", handlePopState)');
        expect(homeSource).toContain('window.history.pushState(detailState, "", detailUrl)');
        expect(homeSource).toContain('buildHomeListState({');
        expect(homeSource).toContain('buildHomeDetailState({');
        expect(homeSource).toContain('isHomeDetailHistoryState(window.history.state)');
        expect(homeSource).toContain('window.history.back();');
        expect(effectsSource).toContain('resolveHomeDetailMapModeParam(searchParams)');
        expect(effectsSource).toContain("{ source: 'url', mapMode: targetMode ?? undefined, restoreKey }");
    });
});
