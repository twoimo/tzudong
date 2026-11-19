# Home map and restaurant detail

The home page at `/` shows the restaurant map with a popular-restaurant list beside it. Choosing a restaurant opens its detail panel, puts its id in the URL, and the panel closes back to the map.

## Sub-features

- `map-load` renders the map container and the map runtime.
- `detail-open-list` opens a restaurant from the desktop popular list.
- `detail-open-marker` opens a restaurant from its map marker.
- `detail-open-search` opens a restaurant from the name search.
- `detail-url` writes `?restaurant=<id>` so the detail survives a reload or a shared link.
- `detail-close` closes the panel and returns to the map.

## How to get to it (user POV)

- Open `/` on desktop and choose `정원분식 인기 맛집 상세 보기` in the left panel.
- Choose the restaurant's marker on the map. A marker is a button named `<name> 상세 보기`.
- Type the name in the search box labeled `맛집 이름 검색어 입력`. On a phone, choose `맛집 검색 열기` first.
- Open `/?restaurant=<id>` directly from a shared link.

## Driving it with tzv

Preconditions:

- Baseline preconditions from the index hold.
- No sign-in is needed.

- **Load the map.** Run `tzv drive map-detail`. Step `open home map` waits for `data-testid="map-container"` and `window.__TZUDONG_DEBUG_MAP__`, then captures `01-home`.
- **Open from the list.** Step `open 정원분식 from the popular list` chooses the button named `정원분식 인기 맛집 상세 보기`. The panel `data-testid="restaurant-detail-panel"` shows an `h2` named `정원분식`, and the URL contains `restaurant=00000000-0000-4000-8000-000000000101`. It captures `02-detail` scoped to the panel.
- **Close.** Step `close the detail panel` chooses the close button in the group named `패널 동작` (`맛집 상세 닫기`, `이전 목록으로 돌아가기`, or `이전 화면으로 돌아가기`). The panel is hidden. It captures `03-closed`.
- **Marker and search entries.** Not in the journey yet. To add them, choose `button[data-testid="marker"][data-restaurant-id="<id>"]` or fill `맛집 이름 검색어 입력`, then assert the same panel heading and URL.

## Gotchas

- The map is the offline Naver stub at `/__local/naver-maps.js`. Tiles do not render. Markers and clusters are still clickable buttons.
- At low zoom only `.cluster-marker-container` exists. Zoom in or use the list before you look for a single marker.
- The first `/` request compiles the home route. Under load it takes minutes, so the journey waits up to 120 s for the map.
- The popular list is a desktop layout. A phone-width viewport hides it.
