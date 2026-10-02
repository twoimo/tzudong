// Loopback-only visual fixture gateway. No request is forwarded to a hosted API.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const upstream = 'http://127.0.0.1:18792';
const origin = 'http://127.0.0.1:18794';
const stamp = '2026-10-03T00:00:00.000Z';
const logo = readFileSync('public/logo.webp');
const videos = Array.from({ length: 25 }, (_, index) => ({
  id: `fixture-video-${index + 1}`, title: `가을 맛집 탐방 ${index + 1}`, category: ['한식', '중식', '일식'][index % 3],
  viewCount: 500000 + index * 31000, likeCount: 3000 + index * 260, commentCount: 200 + index * 17,
  duration: 900, previousViewCount: 450000 + index * 27000, previousLikeCount: 2800 + index * 230,
  previousCommentCount: 170 + index * 15, previousDuration: 900, publishedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
}));
const restaurants = Array.from({ length: 25 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: `검증 맛집 ${index + 1}`,
  approved_name: `검증 맛집 ${index + 1}`, road_address: '서울특별시 중구 검증로', categories: ['한식'],
  lat: 37.55 + index * 0.001, lng: 126.98 + index * 0.001, status: 'approved', review_count: 3,
  verified_review_count: 3, youtube_link: '', created_at: stamp, updated_at: stamp,
}));
const evaluations = restaurants.map((restaurant, index) => ({
  ...restaurant, id: restaurant.id, trace_id: `fixture-trace-${index + 1}`, source_type: 'crawl', status: 'pending',
  restaurant_name: restaurant.name, video_id: videos[index].id, youtube_link: '', evaluation_results: {},
  address: restaurant.road_address, lat: restaurant.lat, lng: restaurant.lng,
  created_at: stamp, updated_at: stamp,
}));
const pending = { submissions: 4, recommendationRequests: 2, reviews: 3, total: 9, asOf: stamp,
  recommendationRequestsLifecycleReady: true, domains: {}, readiness: { status: 'ready', recommendationRequestsLifecycleReady: true, reasons: [] }, diagnostics: {} };
const summary = { asOf: stamp, totals: { restaurants: 25, videos: 25, categories: 3, withCoordinates: 25 },
  topCategories: [{ name: '한식', count: 25 }], videos: videos.map((video) => ({ videoId: video.id, youtubeLink: null,
    title: video.title, publishedAt: video.publishedAt, restaurantCount: 1, notSelectedCount: 0, geocodingFailedCount: 0, updatedAt: stamp })) };
const response = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Credentials': 'true' });
  res.end(JSON.stringify(value));
};
function api(pathname) {
  if (pathname === '/api/admin/pending-counts') return pending;
  if (pathname === '/api/dashboard/summary') return summary;
  if (pathname === '/api/admin/youtube-kpis') return { asOf: stamp, period: '1M', totalVideos: videos.length, videos };
  if (pathname === '/api/admin/youtube-channel') return { channelId: 'fixture', title: '쯔양', subscriberCount: 13500000,
    previousSubscriberCount: 13300000, subscriberDelta: 200000, videoCount: 25, previousVideoCount: 20, videoDelta: 5, deltaSource: 'snapshot-delta' };
  if (pathname === '/api/admin/youtube-kpi-collection-logs') return { logs: [], runs: [], total: 0 };
  if (pathname.includes('/preferences/')) return { order: null, preferences: null };
  if (pathname === '/api/admin/evaluations') return { evaluations, data: evaluations, records: evaluations,
    stats: { total: 25, pending: 25, approved: 0, deleted: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0 },
    revision: '1', nextCursor: null, hasMore: false, filteredTotal: 25, totalCount: 25,
    warnings: Object.fromEntries(evaluations.map((row) => [row.id, { sameVideo: { count: 0, candidates: [], message: '' }, identity: [] }])) };
  if (pathname === '/api/admin/users') return { users: [], summary: { total: 0, active: 0, admins: 0, disabled: 0 } };
  if (pathname === '/api/admin/restaurant-refresh-history') return { records: [], items: [], pagination: { page: 1, perPage: 50, total: 0 }, summary: {} };
  if (pathname === '/api/admin/audit-events') return { events: [], total: 0, coverage: { universal: false, mode: 'truthful-partial-domain-specific', domains: [] } };
  if (pathname === '/api/admin/storyboard/production') return { ok: true, projects: [], workers: [] };
  if (pathname === '/api/insights/treemap') return { rows: [], videos: [], totalVideos: 0, period: '1M', dataQuality: { status: 'ready' } };
  if (pathname.includes('banners')) return { banners: [], items: [] };
  if (pathname.includes('restaurants')) return { restaurants, data: restaurants, totalCount: restaurants.length };
  if (pathname.includes('leaderboard')) return { users: [], leaderboard: [], total: 0 };
  if (pathname.includes('notifications')) return { notifications: [], unreadCount: 0 };
  return { ok: true, data: [], records: [], items: [], total: 0 };
}

const mockSupabase = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1:18793').pathname;
  if (req.method === 'OPTIONS') return response(res, {});
  if (path.startsWith('/auth/v1/')) return response(res, { user: null, session: null });
  if (path.includes('/restaurants')) return response(res, restaurants);
  if (path.includes('/ad_banners') || path.includes('/banners')) return response(res, []);
  if (path.includes('/rpc/')) return response(res, []);
  return response(res, []);
});
mockSupabase.listen(18793, '127.0.0.1');

const preview = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/__fixture/start') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end('<!doctype html><title>합성 데이터 디자인 검증</title><script>localStorage.setItem("tzudong:e2e-admin-shell-bypass","1");location.replace("/admin")</script>');
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET') return response(res, { error: 'FIXTURE_WRITES_DISABLED' }, 405);
    return response(res, api(url.pathname));
  }
  if (url.pathname.startsWith('/_next/image')) {
    res.writeHead(200, { 'Content-Type': 'image/webp' }); return res.end(logo);
  }
  try {
    const incoming = Object.fromEntries(Object.entries(req.headers).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
    const result = await fetch(`${upstream}${url.pathname}${url.search}`, { redirect: 'manual',
      headers: { ...incoming, host: '127.0.0.1:18792', 'x-e2e-admin-bypass': '1', 'x-e2e-admin-bypass-token': 'design-fixture-local-only' } });
    const headers = Object.fromEntries(result.headers);
    delete headers['content-encoding']; delete headers['content-length'];
    res.writeHead(result.status, headers);
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch { response(res, { error: 'FIXTURE_UPSTREAM_UNAVAILABLE' }, 502); }
});
preview.listen(18794, '127.0.0.1', () => console.log('Design preview uses synthetic data on loopback port 18794; hosted APIs and mutations disabled.'));
preview.on('upgrade', (req, socket, head) => {
  const bridge = http.request(`${upstream}${req.url}`, { headers: { ...req.headers, host: '127.0.0.1:18792' } });
  bridge.on('upgrade', (reply, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n${Object.entries(reply.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`);
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    remote.pipe(socket); socket.pipe(remote);
    remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
  });
  bridge.on('error', () => socket.destroy()); bridge.end();
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { preview.close(); mockSupabase.close(); process.exit(0); });
