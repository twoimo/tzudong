import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { MarkerPool, markerPool } from '../lib/marker-pool';

type Position = {
  id: string;
  equals: (other: unknown) => boolean;
};

type Icon = {
  content?: unknown;
  anchor?: { x: number; y: number } | null;
};

const makePosition = (id: string): Position => ({
  id,
  equals: (other: unknown) => (other as { id?: string } | null)?.id === id,
});

class FakeMarker {
  map: unknown;
  position: unknown;
  icon: Icon;
  zIndex = 0;
  clickListener?: (event: unknown) => void;
  setMapCalls = 0;
  setPositionCalls = 0;
  setIconCalls = 0;
  setZIndexCalls = 0;
  readonly classes = new Set<string>();
  readonly element = {
    classList: {
      add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
      remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
    },
    style: { opacity: '' },
  };

  constructor(options: { position: unknown; icon: Icon; map: unknown }) {
    this.position = options.position;
    this.icon = options.icon;
    this.map = options.map;
    createdMarkers.push(this);
  }

  getMap() {
    return this.map;
  }

  setMap(map: unknown | null) {
    this.map = map;
    this.setMapCalls += 1;
  }

  getPosition() {
    return this.position as Position;
  }

  setPosition(position: unknown) {
    this.position = position;
    this.setPositionCalls += 1;
  }

  getIcon() {
    return this.icon;
  }

  setIcon(icon: Icon) {
    this.icon = icon;
    this.setIconCalls += 1;
  }

  getElement() {
    return this.element as unknown as HTMLElement;
  }

  setZIndex(zIndex: number) {
    this.zIndex = zIndex;
    this.setZIndexCalls += 1;
  }
}

const createdMarkers: FakeMarker[] = [];
let listenerRegistrations = 0;
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

function installFakeNaverMaps() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      naver: {
        maps: {
          Marker: FakeMarker,
          Event: {
            addListener: (marker: FakeMarker, event: string, listener: (event: unknown) => void) => {
              expect(event).toBe('click');
              marker.clickListener = listener;
              listenerRegistrations += 1;
            },
          },
        },
      },
    },
  });
}

function captureTimeouts() {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const callbacks: Array<() => void> = [];
  const cleared = new Set<number>();
  globalThis.setTimeout = ((callback: TimerHandler) => {
    callbacks.push(() => (callback as () => void)());
    return callbacks.length as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((handle: unknown) => {
    if (typeof handle === 'number') cleared.add(handle);
  }) as typeof clearTimeout;

  return {
    callbacks,
    cleared,
    flush() {
      callbacks.forEach((callback, index) => {
        if (!cleared.has(index + 1)) callback();
      });
      callbacks.length = 0;
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

installFakeNaverMaps();

beforeEach(() => {
  installFakeNaverMaps();
  markerPool.clear();
  markerPool.resetStats();
  createdMarkers.length = 0;
  listenerRegistrations = 0;
});

afterAll(() => {
  markerPool.clear();
  markerPool.resetStats();
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

describe('marker pool', () => {
  test('exports the same singleton and creates one marker/listener for a new id', () => {
    expect(MarkerPool.getInstance()).toBe(markerPool);
    const onClick = () => undefined;
    const marker = markerPool.acquire(
      'restaurant-1',
      makePosition('p1'),
      { content: 'icon-1', anchor: { x: 10, y: 20 } },
      'map-1',
      onClick,
    ) as unknown as FakeMarker;

    expect(createdMarkers).toHaveLength(1);
    expect(listenerRegistrations).toBe(1);
    expect(markerPool.get('restaurant-1')).toBe(marker as never);
    expect(markerPool.has('restaurant-1')).toBe(true);
    expect(marker.getMap()).toBe('map-1');
    expect(markerPool.getStats()).toEqual({
      created: 1,
      reused: 0,
      released: 0,
      activeCount: 1,
      poolSize: 0,
      hitRate: 0,
    });
  });

  test('reuses an active marker and updates only changed map, position, icon, and click handler', () => {
    let firstClicks = 0;
    let secondClicks = 0;
    const first = markerPool.acquire(
      'restaurant-1',
      makePosition('p1'),
      { content: 'icon-1', anchor: { x: 10, y: 20 } },
      'map-1',
      () => { firstClicks += 1; },
    ) as unknown as FakeMarker;

    const unchanged = markerPool.acquire(
      'restaurant-1',
      makePosition('p1'),
      { content: 'icon-1', anchor: { x: 10, y: 20 } },
      'map-1',
      () => { secondClicks += 1; },
    ) as unknown as FakeMarker;

    expect(unchanged).toBe(first);
    expect(first.setMapCalls).toBe(0);
    expect(first.setPositionCalls).toBe(0);
    expect(first.setIconCalls).toBe(0);
    first.clickListener?.({});
    expect(firstClicks).toBe(0);
    expect(secondClicks).toBe(1);

    markerPool.acquire(
      'restaurant-1',
      makePosition('p2'),
      { content: 'icon-2', anchor: { x: 11, y: 20 } },
      'map-2',
    );
    expect(first.setMapCalls).toBe(1);
    expect(first.setPositionCalls).toBe(1);
    expect(first.setIconCalls).toBe(1);
    expect(markerPool.getStats().created).toBe(1);
    expect(markerPool.getStats().reused).toBe(0);
  });

  test('releases after the fade delay and reuses the pooled marker for a new id', () => {
    const timers = captureTimeouts();
    try {
      const marker = markerPool.acquire(
        'restaurant-1',
        makePosition('p1'),
        { content: 'icon-1', anchor: null },
        'map-1',
      ) as unknown as FakeMarker;

      markerPool.release('restaurant-1');
      expect(markerPool.has('restaurant-1')).toBe(false);
      expect(marker.classes.has('marker-fade-out')).toBe(false);
      expect(marker.getMap()).toBeNull();
      expect(markerPool.getStats()).toMatchObject({ released: 1, poolSize: 1 });

      const reused = markerPool.acquire(
        'restaurant-2',
        makePosition('p2'),
        { content: 'icon-2', anchor: null },
        'map-2',
      ) as unknown as FakeMarker;
      expect(reused).toBe(marker);
      expect(createdMarkers).toHaveLength(1);
      expect(listenerRegistrations).toBe(1);
      expect(markerPool.getStats()).toMatchObject({ created: 1, reused: 1, activeCount: 1, poolSize: 0 });
      expect(markerPool.getStats().hitRate).toBe(0.5);
    } finally {
      timers.restore();
    }
  });

  test('reclaims a fading marker instead of creating a second node', () => {
    const timers = captureTimeouts();
    try {
      const marker = markerPool.acquire(
        'restaurant-1',
        makePosition('p1'),
        { content: 'icon-1', anchor: null },
        'map-1',
      ) as unknown as FakeMarker;

      markerPool.release('restaurant-1');
      expect(marker.getMap()).toBeNull();
      const reclaimed = markerPool.acquire(
        'restaurant-1',
        makePosition('p1'),
        { content: 'icon-1', anchor: null },
        'map-1',
      ) as unknown as FakeMarker;

      expect(reclaimed).toBe(marker);
      expect(createdMarkers).toHaveLength(1);
      expect(marker.classes.has('marker-fade-out')).toBe(false);
      expect(marker.getMap()).toBe('map-1');
      expect(markerPool.getStats()).toMatchObject({ created: 1, reused: 1, activeCount: 1, poolSize: 0 });

      timers.flush();
      expect(marker.getMap()).toBe('map-1');
    } finally {
      timers.restore();
    }
  });

  test('updates active markers and treats unknown ids as safe no-ops', () => {
    const marker = markerPool.acquire(
      'restaurant-1',
      makePosition('p1'),
      { content: 'icon-1' },
      'map-1',
    ) as unknown as FakeMarker;

    markerPool.update('missing', {
      position: makePosition('missing'),
      icon: { content: 'missing' },
      zIndex: 999,
    });
    markerPool.release('missing');
    expect(marker.setPositionCalls).toBe(0);
    expect(marker.setIconCalls).toBe(0);
    expect(marker.setZIndexCalls).toBe(0);

    markerPool.update('restaurant-1', {
      position: makePosition('p2'),
      icon: { content: 'icon-2' },
      zIndex: 12,
    });
    expect(marker.setPositionCalls).toBe(1);
    expect(marker.setIconCalls).toBe(1);
    expect(marker.setZIndexCalls).toBe(1);
    expect(marker.zIndex).toBe(12);
  });

  test('releaseExcept and releaseAll keep only the requested active ids before delayed cleanup', () => {
    const timers = captureTimeouts();
    try {
      for (const id of ['a', 'b', 'c']) {
        markerPool.acquire(id, makePosition(id), { content: id }, 'map');
      }

      markerPool.releaseExcept(new Set(['b']));
      expect(markerPool.has('a')).toBe(false);
      expect(markerPool.has('b')).toBe(true);
      expect(markerPool.has('c')).toBe(false);
      expect(markerPool.getStats().activeCount).toBe(1);

      markerPool.releaseAll();
      expect(markerPool.getStats().activeCount).toBe(0);
      expect(markerPool.getStats()).toMatchObject({ released: 3, poolSize: 3 });
    } finally {
      timers.restore();
    }
  });

  test('clear cancels a release that was already scheduled', () => {
    const timers = captureTimeouts();
    try {
      markerPool.acquire('restaurant-1', makePosition('p1'), { content: 'icon' }, 'map');
      markerPool.release('restaurant-1');

      markerPool.clear();
      expect(markerPool.getStats().poolSize).toBe(0);
      expect(markerPool.getStats().activeCount).toBe(0);
      expect(markerPool.getStats().released).toBe(1);

      timers.flush();
      expect(markerPool.getStats().poolSize).toBe(0);
      expect(markerPool.getStats().released).toBe(1);
    } finally {
      timers.restore();
    }
  });

  test('clear leaves the pool empty for markers that were still active', () => {
    const timers = captureTimeouts();
    try {
      markerPool.acquire('restaurant-9', makePosition('p9'), { content: 'icon' }, 'map');

      markerPool.clear();
      timers.flush();

      expect(markerPool.getStats()).toMatchObject({ activeCount: 0, poolSize: 0 });
    } finally {
      timers.restore();
    }
  });

  test('keeps the category image when only the review bubble changes', () => {
    const inserted: unknown[] = [];
    const image = {
      getAttribute: (name: string) => (name === 'src' ? '/marker.webp' : null),
    };
    const markerNode = {
      getAttribute: (name: string) => (name === 'style' ? 'width:32px' : null),
      querySelector: (selector: string) => (selector === 'img' ? image : null),
      querySelectorAll: () => [],
      insertBefore: (node: unknown) => {
        inserted.push(node);
      },
      parentElement: null,
    };
    const element = {
      querySelector: (selector: string) => (
        selector === '[data-testid="marker"]' ? markerNode : null
      ),
      classList: FakeMarker.prototype ? {
        add: () => undefined,
        remove: () => undefined,
      } : undefined,
      style: { opacity: '' },
    };

    class BubbleMarker extends FakeMarker {
      getElement() {
        return element as unknown as HTMLElement;
      }
    }

    const maps = (globalThis as { window: { naver: { maps: { Marker: typeof FakeMarker } } } }).window.naver.maps;
    maps.Marker = BubbleMarker as unknown as typeof FakeMarker;

    const bubble = { id: 'bubble' };
    const previousDocument = (globalThis as { document?: Document }).document;
    (globalThis as { document?: unknown }).document = {
      createElement() {
        const content = {
          querySelector(selector: string) {
            if (selector === '[data-testid="marker"]') {
              return {
                getAttribute: (name: string) => (name === 'style' ? 'width:32px' : null),
                querySelector: (inner: string) => (inner === 'img' ? image : null),
              };
            }
            if (selector === '[data-visible-marker-review-bubble="true"]') return bubble;
            return null;
          },
        };
        return { content, innerHTML: '' };
      },
    };

    const base = '<div data-testid="marker" style="width:32px"><img src="/marker.webp"></div>';
    const next = `<div data-visible-marker-review-bubble="true"></div>${base}`;

    try {
      const marker = markerPool.acquire(
        'restaurant-bubble',
        makePosition('p'),
        { content: base, anchor: { x: 1, y: 1 } },
        'map',
      ) as unknown as FakeMarker;

      markerPool.acquire(
        'restaurant-bubble',
        makePosition('p'),
        { content: next, anchor: { x: 1, y: 1 } },
        'map',
      );

      expect(marker.setIconCalls).toBe(0);
      expect(inserted).toEqual([bubble]);
      expect(marker.getIcon().content).toBe(next);
    } finally {
      (globalThis as { document?: Document }).document = previousDocument;
      installFakeNaverMaps();
    }
  });
});
