(() => {
  if (window.naver && window.naver.maps && window.naver.maps.Map) return;

  const listeners = new WeakMap();
  const listenerMap = (target) => {
    let map = listeners.get(target);
    if (!map) {
      map = new Map();
      listeners.set(target, map);
    }
    return map;
  };
  const addListener = (target, name, handler) => {
    const map = listenerMap(target);
    const handlers = map.get(name) || [];
    handlers.push(handler);
    map.set(name, handlers);
    return { target, name, handler };
  };
  const removeListener = (token) => {
    if (!token || !token.target) return;
    const map = listeners.get(token.target);
    if (!map) return;
    map.set(token.name, (map.get(token.name) || []).filter((handler) => handler !== token.handler));
  };
  const trigger = (target, name, ...args) => {
    if (target && typeof target.__handleMockMapEvent === 'function') target.__handleMockMapEvent(name, ...args);
    for (const handler of listenerMap(target).get(name) || []) handler(...args);
  };

  class Point {
    constructor(x, y) { this.x = Number(x); this.y = Number(y); }
  }
  class LatLng {
    constructor(lat, lng) { this._lat = Number(lat); this._lng = Number(lng); }
    lat() { return this._lat; }
    lng() { return this._lng; }
    equals(other) { return Boolean(other && typeof other.lat === 'function' && this._lat === other.lat() && this._lng === other.lng()); }
  }
  const asLatLng = (value) => {
    if (value instanceof LatLng) return value;
    if (value && typeof value.lat === 'function') return new LatLng(value.lat(), value.lng());
    return new LatLng(value?.lat || 0, value?.lng || 0);
  };
  class LatLngBounds {
    constructor(sw, ne) { this._sw = asLatLng(sw); this._ne = asLatLng(ne); }
    getSW() { return this._sw; }
    getNE() { return this._ne; }
  }
  const scaleForZoom = (zoom) => 2500 * Math.pow(2, Number(zoom) - 10);

  class MockMap {
    constructor(container, options = {}) {
      this._container = container;
      this._center = asLatLng(options.center || new LatLng(37.5665, 126.978));
      this._zoom = Number(options.zoom || 13);
      this._markers = new Set();
      this._overlay = document.createElement('div');
      this._overlay.dataset.testid = 'mock-naver-overlay';
      Object.assign(this._overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      if (!container.style.position) container.style.position = 'relative';
      container.appendChild(this._overlay);
      setTimeout(() => trigger(this, 'idle'), 0);
    }
    __handleMockMapEvent(name) { if (name === 'resize') this._rerenderMarkers(); }
    _rect() { const rect = this._container.getBoundingClientRect(); return { width: rect.width || 360, height: rect.height || 640 }; }
    _registerMarker(marker) { this._markers.add(marker); this._overlay.appendChild(marker._element); marker._render(); }
    _unregisterMarker(marker) { this._markers.delete(marker); marker._element.remove(); }
    _rerenderMarkers() { this._markers.forEach((marker) => marker._render()); }
    getCenter() { return this._center; }
    setCenter(center) { this._center = asLatLng(center); this._rerenderMarkers(); trigger(this, 'idle'); }
    panTo(center) { this.setCenter(center); }
    panBy(x, y) { const p = this.getProjection().fromCoordToOffset(this._center); this.setCenter(this.getProjection().fromOffsetToCoord(new Point(p.x + Number(x), p.y + Number(y)))); }
    morph(center, zoom) { if (center) this._center = asLatLng(center); if (typeof zoom === 'number') this._zoom = zoom; this._rerenderMarkers(); trigger(this, 'idle'); }
    getZoom() { return this._zoom; }
    setZoom(zoom) { this._zoom = Number(zoom); this._rerenderMarkers(); trigger(this, 'idle'); }
    getProjection() {
      const map = this;
      return {
        fromCoordToOffset(coordLike) {
          const coord = asLatLng(coordLike); const rect = map._rect(); const scale = scaleForZoom(map._zoom);
          return new Point(rect.width / 2 + (coord.lng() - map._center.lng()) * scale, rect.height / 2 - (coord.lat() - map._center.lat()) * scale);
        },
        fromOffsetToCoord(pointLike) {
          const point = pointLike instanceof Point ? pointLike : new Point(pointLike.x, pointLike.y); const rect = map._rect(); const scale = scaleForZoom(map._zoom);
          return new LatLng(map._center.lat() - (point.y - rect.height / 2) / scale, map._center.lng() + (point.x - rect.width / 2) / scale);
        },
      };
    }
    getBounds() {
      const projection = this.getProjection(); const rect = this._rect();
      return { getSW: () => projection.fromOffsetToCoord(new Point(0, rect.height)), getNE: () => projection.fromOffsetToCoord(new Point(rect.width, 0)) };
    }
    fitBounds(bounds) {
      if (bounds && typeof bounds.getSW === 'function' && typeof bounds.getNE === 'function') {
        const sw = bounds.getSW(); const ne = bounds.getNE();
        this._center = new LatLng((sw.lat() + ne.lat()) / 2, (sw.lng() + ne.lng()) / 2);
      }
      this._rerenderMarkers(); trigger(this, 'idle');
    }
  }

  class MockMarker {
    constructor({ position, icon, map }) {
      this._position = asLatLng(position); this._icon = icon || {}; this._map = null; this._zIndex = 1;
      this._element = document.createElement('div');
      Object.assign(this._element.style, { position: 'absolute', pointerEvents: 'auto' });
      this._element.addEventListener('click', (event) => {
        const markerEvent = { domEvent: event };
        if (typeof this.__onClick === 'function') this.__onClick(markerEvent); else trigger(this, 'click', markerEvent);
      });
      this.setIcon(this._icon); if (map) this.setMap(map);
    }
    getPosition() { return this._position; }
    setPosition(position) { this._position = asLatLng(position); this._render(); }
    getMap() { return this._map; }
    setMap(map) { if (this._map === map) return; if (this._map) this._map._unregisterMarker(this); this._map = map || null; if (this._map) this._map._registerMarker(this); }
    getIcon() { return this._icon; }
    setIcon(icon) {
      this._icon = icon || {}; this._element.innerHTML = this._icon.content || '<div data-testid="marker"></div>';
      this._element.querySelectorAll('[data-testid="marker"], .cluster-marker-container').forEach((element) => element.addEventListener('click', (event) => {
        event.stopPropagation(); const markerEvent = { domEvent: event };
        if (typeof this.__onClick === 'function') this.__onClick(markerEvent); else trigger(this, 'click', markerEvent);
      }));
      this._render();
    }
    setZIndex(zIndex) { this._zIndex = Number(zIndex); this._element.style.zIndex = String(this._zIndex); }
    getElement() { return this._element; }
    _render() {
      if (!this._map) return; const point = this._map.getProjection().fromCoordToOffset(this._position); const anchor = this._icon?.anchor || { x: 0, y: 0 };
      this._element.style.left = String(point.x - Number(anchor.x || 0)) + 'px'; this._element.style.top = String(point.y - Number(anchor.y || 0)) + 'px'; this._element.style.zIndex = String(this._zIndex);
    }
  }

  window.naver = { maps: { Event: { addListener, removeListener, trigger }, LatLng, LatLngBounds, Map: MockMap, Marker: MockMarker, Point, Position: { TOP_LEFT: 'TOP_LEFT', TOP_RIGHT: 'TOP_RIGHT' } } };
})();
