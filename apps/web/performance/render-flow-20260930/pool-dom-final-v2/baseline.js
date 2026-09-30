(() => {
  // lib/html-escape.ts
  function escapeHtmlAttribute(value) {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  // lib/cluster-marker.ts
  class ClusterAnimationManager {
    categoryIndices = new Map;
    timerId = null;
    listeners = new Set;
    start(intervalMs = 1000) {
      if (this.timerId !== null || intervalMs <= 0)
        return;
      const tick = () => {
        this.categoryIndices.forEach((index, clusterId) => {
          this.categoryIndices.set(clusterId, index + 1);
        });
        this.listeners.forEach((listener) => listener());
        this.timerId = setTimeout(tick, intervalMs);
      };
      this.timerId = setTimeout(tick, intervalMs);
    }
    stop() {
      if (this.timerId !== null) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
    }
    register(clusterId) {
      if (!this.categoryIndices.has(clusterId)) {
        this.categoryIndices.set(clusterId, 0);
      }
    }
    unregister(clusterId) {
      this.categoryIndices.delete(clusterId);
    }
    getCurrentIndex(clusterId, totalCategories) {
      const index = this.categoryIndices.get(clusterId) || 0;
      return index % totalCategories;
    }
    addListener(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    clear() {
      this.stop();
      this.categoryIndices.clear();
      this.listeners.clear();
    }
  }
  var clusterAnimationManager = new ClusterAnimationManager;
  var createCategoryMarkerImage = (name) => ({
    webp: `/images/maker-images/webp/${name}.webp`,
    png: `/images/maker-images/${name}.png`
  });
  var CATEGORY_IMAGES = {
    "고기": createCategoryMarkerImage("meat_bbq"),
    "치킨": createCategoryMarkerImage("chicken"),
    "한식": createCategoryMarkerImage("korean"),
    "중식": createCategoryMarkerImage("chinese"),
    "일식": createCategoryMarkerImage("cutlet_sashimi"),
    "양식": createCategoryMarkerImage("western"),
    "분식": createCategoryMarkerImage("snack_bar"),
    "카페·디저트": createCategoryMarkerImage("cafe_dessert"),
    "아시안": createCategoryMarkerImage("asian"),
    "패스트푸드": createCategoryMarkerImage("fastfood"),
    "족발·보쌈": createCategoryMarkerImage("pork_feet"),
    "돈까스·회": createCategoryMarkerImage("cutlet_sashimi"),
    "피자": createCategoryMarkerImage("pizza"),
    "찜·탕": createCategoryMarkerImage("stew"),
    "야식": createCategoryMarkerImage("late_night"),
    "도시락": createCategoryMarkerImage("lunch_box"),
    "사용자 제보": createCategoryMarkerImage("user_submitted"),
    "트렌드": createCategoryMarkerImage("trend"),
    "제철": createCategoryMarkerImage("seasonal")
  };
  var getCategoryImage = (category) => {
    return CATEGORY_IMAGES[category] || createCategoryMarkerImage("korean");
  };
  var createCategoryImageHTML = ({
    image,
    alt
  }) => {
    return `
        <picture style="display: block; width: 100%; height: 100%;">
          <source srcset="${image.webp}" type="image/webp" />
          <img
              src="${image.png}"
              alt="${alt}"
              style="width: 100%; height: 100%; object-fit: contain;"
              draggable="false"
              decoding="sync"
          />
        </picture>
  `;
  };
  var createIndividualMarkerHTML = (category, isSelected, visitCount = 0, restaurantId) => {
    const image = getCategoryImage(category);
    const size = isSelected ? 42 : 32;
    const normalizedVisitCount = Number.isFinite(visitCount) ? Math.max(0, Math.floor(visitCount)) : 0;
    const shouldShowVisitBadge = normalizedVisitCount >= 2;
    const visitBadgeSize = isSelected ? 19 : 17;
    const visitBadgeFontSize = isSelected ? 11 : 10;
    const visitBadgeOffset = isSelected ? -6 : -5;
    const displayVisitCount = normalizedVisitCount >= 100 ? "99+" : String(normalizedVisitCount);
    const safeRestaurantId = restaurantId ? escapeHtmlAttribute(restaurantId) : null;
    const transform = isSelected ? "scale(1.15) translateY(-5px)" : "scale(1)";
    const zIndex = isSelected ? "100" : "1";
    return `
    <div
      style="
        width: ${size}px;
        height: ${size}px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transform: ${transform};
        position: relative;
        z-index: ${zIndex};
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      "
      role="button"
      data-testid="marker"
      ${safeRestaurantId ? `data-restaurant-id="${safeRestaurantId}"` : ""}
    >
        ${createCategoryImageHTML({ image, alt: "marker" })}
        ${shouldShowVisitBadge ? `
        <span
          class="tzuyang-visit-count-badge"
          data-tzuyang-visit-count-badge="true"
          aria-label="쯔양 ${normalizedVisitCount}회 방문"
          style="
            position: absolute;
            top: ${visitBadgeOffset}px;
            right: ${visitBadgeOffset}px;
            min-width: ${visitBadgeSize}px;
            height: ${visitBadgeSize}px;
            padding: 0 4px;
            border-radius: 9999px;
            background-color: #dc2626;
            color: #ffffff;
            border: 2px solid #ffffff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: ${visitBadgeFontSize}px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: -0.02em;
            pointer-events: none;
            box-sizing: border-box;
          "
        >${displayVisitCount}</span>
        ` : ""}
    </div>
  `;
  };

  // ../../../../../../../../private/var/folders/8d/nwv_19w124zbq0dxqx2r1jn40000gn/T/tzudong-pool-dom-DtSdkx/baseline-pool.ts
  var MARKER_NODE_SELECTOR = '[data-testid="marker"]';
  var REVIEW_BUBBLE_SELECTOR = '[data-visible-marker-review-bubble="true"]';
  function patchStableMarkerReviewBubble(element, nextContent) {
    if (typeof nextContent !== "string" || typeof document === "undefined")
      return false;
    if (!nextContent.includes('data-testid="marker"') && !element.querySelector(MARKER_NODE_SELECTOR)) {
      return false;
    }
    const currentMarker = element.querySelector(MARKER_NODE_SELECTOR);
    if (!currentMarker)
      return false;
    const template = document.createElement("template");
    template.innerHTML = nextContent;
    const nextMarker = template.content.querySelector(MARKER_NODE_SELECTOR);
    if (!nextMarker)
      return false;
    if (currentMarker.getAttribute("style") !== nextMarker.getAttribute("style"))
      return false;
    const currentImage = currentMarker.querySelector("img");
    const nextImage = nextMarker.querySelector("img");
    if ((currentImage?.getAttribute("src") ?? "") !== (nextImage?.getAttribute("src") ?? ""))
      return false;
    const hosts = [currentMarker, currentMarker.parentElement].filter((host) => Boolean(host));
    hosts.forEach((host) => {
      host.querySelectorAll(`:scope > ${REVIEW_BUBBLE_SELECTOR}`).forEach((node) => node.remove());
    });
    const nextBubble = template.content.querySelector(REVIEW_BUBBLE_SELECTOR);
    if (nextBubble)
      currentMarker.insertBefore(nextBubble, currentMarker.firstChild);
    return true;
  }

  class MarkerPool {
    static instance = null;
    pool = [];
    active = new Map;
    MAX_POOL_SIZE = 1000;
    stats = {
      created: 0,
      reused: 0,
      released: 0
    };
    constructor() {}
    static getInstance() {
      if (!MarkerPool.instance) {
        MarkerPool.instance = new MarkerPool;
      }
      return MarkerPool.instance;
    }
    acquire(id, position, icon, map, onClick) {
      let marker;
      let isNew = false;
      if (this.active.has(id)) {
        marker = this.active.get(id);
      } else if (this.pool.length > 0) {
        marker = this.pool.pop();
        this.stats.reused++;
      } else {
        marker = new window.naver.maps.Marker({
          position,
          icon,
          map
        });
        isNew = true;
        this.stats.created++;
        window.naver.maps.Event.addListener(marker, "click", (e) => {
          if (marker.__onClick) {
            marker.__onClick(e);
          }
        });
      }
      if (!isNew && marker.getMap() !== map) {
        marker.setMap(map);
      }
      if (!isNew) {
        const currentPos = marker.getPosition();
        if (!currentPos?.equals || !currentPos.equals(position)) {
          marker.setPosition(position);
        }
      }
      if (!isNew) {
        const currentIcon = marker.getIcon();
        const currentAnchor = currentIcon?.anchor ?? null;
        const nextAnchor = icon.anchor ?? null;
        const isContentDifferent = currentIcon?.content !== icon.content;
        const isAnchorDifferent = (currentAnchor?.x ?? null) !== (nextAnchor?.x ?? null) || (currentAnchor?.y ?? null) !== (nextAnchor?.y ?? null);
        if (isContentDifferent || isAnchorDifferent) {
          const element = marker.getElement();
          const patched = !isAnchorDifferent && typeof element?.querySelector === "function" && patchStableMarkerReviewBubble(element, icon.content);
          if (patched && currentIcon) {
            currentIcon.content = icon.content;
          } else if (!patched) {
            marker.setIcon(icon);
          }
        }
      }
      marker.__onClick = onClick;
      this.active.set(id, marker);
      return marker;
    }
    release(id) {
      const marker = this.active.get(id);
      if (!marker)
        return;
      this.active.delete(id);
      marker.setMap(null);
      if (this.pool.length < this.MAX_POOL_SIZE) {
        this.pool.push(marker);
      }
      this.stats.released++;
    }
    releaseMultiple(ids) {
      ids.forEach((id) => this.release(id));
    }
    releaseAll() {
      const ids = Array.from(this.active.keys());
      this.releaseMultiple(ids);
    }
    releaseExcept(keepIds) {
      const toRelease = Array.from(this.active.keys()).filter((id) => !keepIds.has(id));
      this.releaseMultiple(toRelease);
    }
    update(id, updates) {
      const marker = this.active.get(id);
      if (!marker)
        return;
      if (updates.position) {
        marker.setPosition(updates.position);
      }
      if (updates.icon) {
        marker.setIcon(updates.icon);
      }
      if (updates.zIndex !== undefined) {
        marker.setZIndex(updates.zIndex);
      }
    }
    get(id) {
      return this.active.get(id);
    }
    has(id) {
      return this.active.has(id);
    }
    clear() {
      this.active.forEach((marker) => {
        marker.setMap(null);
      });
      this.pool.forEach((marker) => {
        marker.setMap(null);
      });
      this.active.clear();
      this.pool = [];
    }
    getStats() {
      return {
        ...this.stats,
        activeCount: this.active.size,
        poolSize: this.pool.length,
        hitRate: this.stats.reused / (this.stats.created + this.stats.reused) || 0
      };
    }
    resetStats() {
      this.stats = {
        created: 0,
        reused: 0,
        released: 0
      };
    }
    logStats() {
      const stats = this.getStats();
      console.table({
        "Active Markers": stats.activeCount,
        "Pool Size": stats.poolSize,
        "Total Created": stats.created,
        "Total Reused": stats.reused,
        "Total Released": stats.released,
        "Hit Rate": `${(stats.hitRate * 100).toFixed(1)}%`
      });
    }
  }
  var markerPool = MarkerPool.getInstance();

  // ../../../../../../../../private/var/folders/8d/nwv_19w124zbq0dxqx2r1jn40000gn/T/tzudong-pool-dom-DtSdkx/baseline-entry.ts
  globalThis.__poolDOMProbe = { MarkerPool, createIndividualMarkerHTML };
})();
