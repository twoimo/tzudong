import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Coordinate = { lat(): number; lng(): number };
type Pixel = { x: number; y: number };
type Projection = {
    fromCoordToOffset(coord: Coordinate): Pixel;
    fromOffsetToCoord(point: Pixel): Coordinate;
};

function localMap() {
    const window = {} as { naver: { maps: {
        Map: new (container: unknown, options: unknown) => { getProjection(): Projection };
        LatLng: new (lat: number, lng: number) => Coordinate;
    } } };
    const container = {
        style: {}, appendChild() {},
        getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    };
    runInNewContext(readFileSync(new URL('../public/__local/naver-maps.js', import.meta.url), 'utf8'), {
        window,
        document: { createElement: () => ({ dataset: {}, style: {} }) },
        setTimeout() {},
    });
    const maps = window.naver.maps;
    return { maps, map: new maps.Map(container, {
        center: new maps.LatLng(37.5512, 126.9882), zoom: 14,
    }) };
}

test('local national-to-Seoul cluster expansion keeps seeded restaurants inside the desktop map', () => {
    const { maps, map } = localMap();
    for (const [lat, lng] of [[37.5665, 126.978], [37.56695, 126.97885]]) {
        const pixel = map.getProjection().fromCoordToOffset(new maps.LatLng(lat, lng));
        expect(pixel.x).toBeGreaterThan(0);
        expect(pixel.x).toBeLessThan(1440);
        expect(pixel.y).toBeGreaterThan(0);
        expect(pixel.y).toBeLessThan(900);
    }
});

test('local projection round-trips coordinates without moving its visual center', () => {
    const { maps, map } = localMap();
    const projection = map.getProjection();
    const center = projection.fromCoordToOffset(new maps.LatLng(37.5512, 126.9882));
    expect(center.x).toBeCloseTo(720, 6);
    expect(center.y).toBeCloseTo(450, 6);
    for (const [lat, lng] of [[0, 0], [-33.9, 151.2], [37.5665, 126.978], [80, -120]]) {
        const coord = projection.fromOffsetToCoord(projection.fromCoordToOffset(new maps.LatLng(lat, lng)));
        expect(coord.lat()).toBeCloseTo(lat, 6);
        expect(coord.lng()).toBeCloseTo(lng, 6);
    }
});
