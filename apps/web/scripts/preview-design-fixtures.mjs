// Loopback-only visual fixture gateway. No request is forwarded to a hosted API.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const upstream = 'http://127.0.0.1:18792';
const origin = 'http://127.0.0.1:18794';
const stamp = '2026-10-03T00:00:00.000Z';
const storyboardProjects = ['gemini-api','manual'].map((provider,index) => {
  const id=`00000000-0000-4000-b100-${String(index+1).padStart(12,'0')}`;
  const textModel=provider==='gemini-api'?'gemini-3.8-flash':'manual';
  const imageModel=provider==='gemini-api'?'gemini-3.1-flash-image':'manual';
  return {id,revision:0,status:'partial',createdAt:stamp,updatedAt:stamp,
    request:{workflow:'storyboard-mlx-v1',requestId:id,prompt:'합성 검증용 맛집 촬영안',sceneCount:5,
      providers:{externalAI:provider==='gemini-api',text:{id:provider,model:textModel},image:{id:provider,model:imageModel}},retrieval:'none',sources:[],imageWidth:1024,imageHeight:576},
    document:{schema:'storyboard-mlx-v1',projectId:id,revision:0,generatedAt:stamp,title:provider==='gemini-api'?'Gemini 합성 프로젝트':'수동 합성 프로젝트',logline:'실제 모델 호출 없이 입력 경로를 검증합니다.',
      textProvenance:{providerId:provider,model:textModel,verification:'user-import',generatedAt:stamp,requestId:id,responseId:null,responseModel:null,modelEvidence:'unverified'},
      scenes:Array.from({length:5},(_,scene)=>({sceneNo:scene+1,title:`검증 장면 ${scene+1}`,durationSec:10,description:'합성 식당 장면',visualDirection:'정면 촬영',narration:'',caption:'',productionNotes:['합성 검증용'],imagePrompt:'합성 식당',sourceIds:[],revision:0,image:null,imageError:null}))}};
});
const logo = readFileSync('public/logo.webp');
const videos = Array.from({ length: 25 }, (_, index) => ({
  id: `fixture-video-${index + 1}`, title: `가을 맛집 탐방 ${index + 1}`, category: ['한식', '중식', '일식'][index % 3],
  viewCount: 500000 + index * 31000, likeCount: 3000 + index * 260, commentCount: 200 + index * 17,
  duration: 900, previousViewCount: 450000 + index * 27000, previousLikeCount: 2800 + index * 230,
  previousCommentCount: 170 + index * 15, previousDuration: 900, publishedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
}));
const restaurants = Array.from({ length: 25 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: `검증 맛집 ${index + 1}`,
  approved_name: `검증 맛집 ${index + 1}`, road_address: `서울특별시 중구 검증로 ${index + 1}`, jibun_address:null, categories: ['한식'],
  lat: 37.55 + index * 0.001, lng: 126.98 + index * 0.001, status: 'approved', review_count: 3,
  verified_review_count: 3, youtube_link: '', created_at: stamp, updated_at: stamp,
}));
const fixtureProfiles = Array.from({ length: 3 }, (_, i) => ({user_id:`00000000-0000-4000-9000-${String(i+1).padStart(12,'0')}`,nickname:`검증 사용자 ${i+1}`,avatar_url:null}));
const fixtureUser = { id: fixtureProfiles[0].user_id, aud: 'authenticated', role: 'authenticated',
  email: 'fixture@example.test', created_at: stamp, app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { nickname: fixtureProfiles[0].nickname }, identities: [] };
const fixtureSession = () => {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:fixtureUser.id,aud:'authenticated',role:'authenticated',iat:now,exp:now+86400})}.synthetic-loopback-only`,
    refresh_token:'synthetic-loopback-only',token_type:'bearer',expires_in:86400,expires_at:now+86400,user:fixtureUser };
};
const managedUsers = fixtureProfiles.map((profile, i) => ({ id: profile.user_id, email: `fixture${i+1}@example.test`,
  username: `fixture${i+1}`, nickname: profile.nickname, avatarUrl:null, profileRole:'user', isAdmin:i===0,
  isDisabled:i===2,bannedUntil:null,createdAt:stamp,lastSignInAt:stamp,emailConfirmedAt:stamp,
  statusLabel:i===2?'비활성':'활성',roleLabel:i===0?'관리자':'사용자' }));
const fixtureBanners = [{ id:'00000000-0000-4000-b000-000000000001',title:'검증용 맛집 안내',description:'합성 배너입니다.',
  image_url:null,video_url:null,media_type:'none',link_url:null,is_active:true,priority:1,
  display_target:['sidebar'],created_at:stamp,updated_at:stamp,created_by:fixtureUser.id }];
const fixtureSubmissions = [ {id:'00000000-0000-4000-a100-000000000001',user_id:fixtureUser.id,submission_type:'new',status:'pending',
  restaurant_name:'검증 제보 맛집',restaurant_address:'서울특별시 중구 검증로 1',restaurant_phone:null,restaurant_categories:['한식'],
  admin_notes:null,rejection_reason:null,resolved_by_admin_id:null,reviewed_at:null,created_at:stamp,updated_at:stamp } ];
const fixtureSubmissionItems = [{id:'00000000-0000-4000-a200-000000000001',submission_id:fixtureSubmissions[0].id,
  youtube_link:'https://www.youtube.com/watch?v=dQw4w9WgXcQ',tzuyang_review:'검증용 제보 근거',target_restaurant_id:null,
  item_status:'pending',rejection_reason:null,created_at:stamp }];
const fixtureReviews = restaurants.flatMap((restaurant, i) => fixtureProfiles.map((profile, j) => ({
  id:`00000000-0000-4000-a000-${String(i*3+j+1).padStart(12,'0')}`,restaurant_id:restaurant.id,user_id:profile.user_id,
  title:`검증 리뷰 ${j+1}`,content:`검증용 리뷰 ${j+1}. 음식과 공간의 분위기를 확인하는 합성 데이터입니다.`,visited_at:stamp,created_at:stamp,
  verification_photo:'',updated_at:stamp,is_duplicate:false,receipt_data:null,ocr_processed_at:null,food_photos:[],categories:['한식'],is_verified:true,is_pinned:false,is_edited_by_admin:false,admin_note:null,like_count:j+1,
})));
const pendingReviews = fixtureReviews.slice(0,3).map((row,i)=>({...row,id:`00000000-0000-4000-a400-${String(i+1).padStart(12,'0')}`,is_verified:false}));
function filteredRows(req,rows) {
  const query=new URL(req.url,origin).searchParams;
  let selected=rows;
  for(const field of ['id','restaurant_id','user_id','is_verified']) {
    const filter=query.get(field);
    if(filter?.startsWith('eq.'))selected=selected.filter(row=>String(row[field])===filter.slice(3));
    if(filter?.startsWith('in.(')) {const ids=filter.slice(4,-1).split(',').map(s=>s.replaceAll('"',''));selected=selected.filter(row=>ids.includes(String(row[field])));}
  }
  const limit=Number(query.get('limit'));
  if(Number.isInteger(limit)&&limit>0)selected=selected.slice(0,Math.min(limit,200));
  if(String(req.headers.accept).includes('vnd.pgrst.object'))return selected[0]??null;
  return selected;
}
const evaluations = restaurants.map((restaurant, index) => ({
  ...restaurant, id: restaurant.id, trace_id: `fixture-trace-${index + 1}`, source_type: 'crawl', status: 'pending',
  restaurant_name: restaurant.name, video_id: videos[index].id, youtube_link: '', evaluation_results: {},
  address: restaurant.road_address, lat: restaurant.lat, lng: restaurant.lng,
  created_at: stamp, updated_at: stamp,
}));
const refreshCandidates = restaurants.slice(0,3).map((row,i)=>({
  id:`00000000-0000-4000-a700-${String(i+1).padStart(12,'0')}`,restaurant_id:row.id,restaurant_name:row.name,
  restaurant_address:row.road_address,current_phone:null,candidate_status:'needs_review',detected_change_types:[['phone','name','closure'][i]],
  previous_snapshot:{name:row.name,approved_name:row.name,phone:null,road_address:row.road_address,jibun_address:null},
  candidate_snapshot:{name:i===1?row.name+' 변경 후보':row.name,approved_name:i===1?row.name+' 변경 후보':row.name,phone:i===0?'02-0000-0000':null,road_address:row.road_address,jibun_address:null},
  evidence:{source:'synthetic-fixture'},created_at:stamp,decided_at:null,applied_at:null,
  readback_state:{status:'not_required',checked_at:null,run_id:null,notes:null},
}));
const pending = { submissions: 6, recommendationRequests: 2, reviews: 3, total: 9, asOf: stamp,
  recommendationRequestsLifecycleReady: true, domains: { restaurant_submissions: { id: 'restaurant_submissions', count: 4, ready: true, status: 'ready' }, restaurant_recommendation_requests: { id: 'restaurant_recommendation_requests', count: 2, ready: true, status: 'ready' }, reviews: { id: 'reviews', count: 3, ready: true, status: 'ready' } }, readiness: { status: 'ready', recommendationRequestsLifecycleReady: true, reasons: [] }, diagnostics: {} };
const summary = { asOf: stamp, totals: { restaurants: 25, videos: 25, categories: 3, withCoordinates: 25 },
  topCategories: [{ name: '한식', count: 25 }], videos: videos.map((video) => ({ videoId: video.id, youtubeLink: null,
    title: video.title, publishedAt: video.publishedAt, restaurantCount: 1, notSelectedCount: 0, geocodingFailedCount: 0, updatedAt: stamp })) };
const response = (res, value, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Credentials': 'true' });
  res.end(JSON.stringify(value));
};
// In-memory synthetic automation state only. The gateway never forwards these
// mutations to a database; production route/SQL are verified independently.
const fixtureAutomation = { policy:{version:1,enabled:false,batch_size:50,daily_limit:50,last_run_at:null},runs:[],items:[],queue:{queued:0,running:0,failed:0},policyEvents:[] };
function fixtureAutomationAction(body) {
  if(body.action==='preview') return {version:String(fixtureAutomation.policy.version),previewHash:'a'.repeat(32),counts:{approve:0,recheck:0,hold:25,protected:0},batchSize:body.batchSize,dailyLimit:body.dailyLimit};
  if(body.action==='preview-run'||body.action==='preview-stop') return {action:body.action.slice(8),version:String(fixtureAutomation.policy.version),previewHash:'a'.repeat(32),counts:{approve:0,recheck:0,hold:25,protected:0},batchSize:fixtureAutomation.policy.batch_size,dailyLimit:fixtureAutomation.policy.daily_limit,remainingApprovals:fixtureAutomation.policy.daily_limit,queue:{queued:fixtureAutomation.queue.queued,running:fixtureAutomation.queue.running}};
  if(body.action==='start') { Object.assign(fixtureAutomation.policy,{version:fixtureAutomation.policy.version+1,enabled:true,batch_size:body.batchSize,daily_limit:body.dailyLimit}); }
  else if(body.action==='stop') { fixtureAutomation.policy.enabled=false;fixtureAutomation.policy.version++; }
  else if(body.action==='run'&&fixtureAutomation.policy.enabled&&!fixtureAutomation.runs.some(run=>run.request_id===body.requestId)) {
    const at=new Date().toISOString();
    fixtureAutomation.runs.unshift({id:body.requestId,request_id:body.requestId,started_at:at,scanned:25,approved:0,held:25,recheck:0,protected:0});
    fixtureAutomation.policy.last_run_at=at;
    fixtureAutomation.items=evaluations.slice(0,10).map((row,i)=>({id:`00000000-0000-4000-a600-${String(i+1).padStart(12,'0')}`,restaurant_id:row.id,restaurant_name:row.name,reason:'location_requires_review',state:'applied'}));
  }
  return fixtureAutomation;
}
function api(pathname, params = new URLSearchParams()) {
  if (pathname === '/api/admin/sentry') return { state: 'not_configured', collection: { browser: false, server: false }, dashboardUrl: null, issues: [], nextCursor: null, fetchedAt: null };
  if (pathname === '/api/admin/knowledge-graph') {
    const snapshot = JSON.parse(readFileSync('data/knowledge-graph/tzudong.json', 'utf8'));
    const q = (params.get('q') ?? '').normalize('NFKC').toLowerCase().trim(), kind = params.get('kind');
    const filtered = snapshot.nodes.filter(node => (!kind || node.kind === kind) && (!q || `${node.label} ${node.summary}`.normalize('NFKC').toLowerCase().includes(q)));
    const nodes = filtered.slice(0, 100), ids = new Set(nodes.map(node => node.id));
    const edges = snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    return { revision: snapshot.revision, generatedAt: snapshot.generatedAt, coverage: snapshot.coverage, nodes, edges,
      selected: snapshot.nodes.find(node => node.id === params.get('node')) ?? null,
      totalNodes: snapshot.nodes.length, totalEdges: snapshot.edges.length, filteredTotal: filtered.length,
      omittedEdges: snapshot.edges.length - edges.length, nextCursor: null };
  }
  if (pathname === '/api/admin/evaluations/automation') return fixtureAutomation;
  if (pathname === '/api/dashboard/restaurants') return {asOf:stamp,total:restaurants.length,limit:500,offset:0,filters:{onlyWithCoordinates:true},items:restaurants.map(row=>({
    id:row.id,name:row.name,category:'한식',address:row.road_address,lat:row.lat,lng:row.lng,youtubeLink:null,videoId:null,
    sourceType:'crawl',status:'approved',geocodingSuccess:true,isNotSelected:false,createdAt:stamp,updatedAt:stamp}))};
  if (pathname === '/api/admin/pipeline') return {source:'github_actions',hardware:'합성 환경',dataEnv:'fixture',targets:[],jobs:[
    {id:'fixture-run-1',target:'tzuyang',profile:'lite_gha',status:'Succeeded',dry_run:true,adapter_index:6}],failures:[],failureFrames:[],gauges:{}};
  if (pathname.startsWith('/api/admin/evaluations/')) return {record:evaluations.find(row=>row.id===pathname.split('/').at(-1))??null,revision:'1'};
  if (pathname === '/api/privacy/consents') return {
    policy:{policyVersionId:'00000000-0000-4000-8000-000000000001',version:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'},
    consents:{ordinary:{email:false,sms:false,push:false},night:{email:false,sms:false,push:false}} };
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
  if (pathname === '/api/admin/users') return { users: managedUsers,
    summary: { loadedUsers:3,adminUsers:1,disabledUsers:1,unconfirmedUsers:0 },page:1,perPage:120,total:3 };
  if (pathname === '/api/admin/restaurant-refresh-history') return {candidates:refreshCandidates,summary:{approved_restaurants_total:25,needs_review:3,approved:0,rejected:0,applied:0,last_checked_at:stamp}};
  if (pathname === '/api/admin/audit-events') return { asOf: stamp, source: 'admin_audit_events', unavailable: null,
    coverage: { universal: false, mode: 'truthful-partial-domain-specific', domains: ['admin_user_management'], sources: ['admin_audit_events'] },
    events: ['applied','intent','failed'].map((status,i)=>({id:`fixture-audit-${i+1}`,actorUserId:fixtureUser.id,targetUserId:fixtureProfiles[i].user_id,
      action:['admin_user_profile_updated','admin_user_role_granted','admin_user_disabled'][i],status,reasonCode:'operator-review',correlationId:`fixture-correlation-${i+1}`,
      appliedAt:status==='applied'?stamp:null,errorCode:status==='failed'?'FIXTURE_REJECTED':null,createdAt:stamp,counts:{},flags:{}})) };
  if (pathname === '/api/admin/storyboard/production') return { ok: true, projects: storyboardProjects.map(project=>({id:project.id,revision:project.revision,status:project.status,title:project.document.title,createdAt:stamp,updatedAt:stamp})), workers: [] };
  if (pathname.startsWith('/api/admin/storyboard/production/')) {const project=storyboardProjects.find(project=>project.id===pathname.split('/').at(-1));return project?{ok:true,project,job:null,events:[]}:{ok:false,error:'not_found'};}
  if (pathname === '/api/insights/treemap') return { asOf:stamp,videos,totalVideos:videos.length,period:'ALL',availablePeriods:['1M','ALL'],meta:{dataSource:'supabase-treemap'} };
  if (pathname.includes('banners')) return { banners: fixtureBanners, items: fixtureBanners };
  if (pathname.includes('restaurants')) return { restaurants, data: restaurants, totalCount: restaurants.length };
  if (pathname.includes('leaderboard')) return { users: [], leaderboard: [], total: 0 };
  if (pathname.includes('notifications')) return { notifications: [], unreadCount: 0 };
  return { ok: true, data: [], records: [], items: [], total: 0 };
}

const mockSupabase = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1:18793').pathname;
  if (req.method === 'OPTIONS') return response(res, {});
  if (path === '/auth/v1/user') return response(res, fixtureUser);
  if (path.startsWith('/auth/v1/')) return response(res, { user: null, session: null });
  if (req.method !== 'GET' && !path.includes('/rpc/')) return response(res,{error:'FIXTURE_WRITES_DISABLED'},405);
  if (path.endsWith('/rpc/get_current_privacy_eligibility')) return response(res,{
    schemaVersion:1,eligible:true,reasonCode:'PRIVACY_ELIGIBLE',policyVersionId:'00000000-0000-4000-8000-000000000001',
    policyVersion:'2026-08-04.1',contentSha256:'6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' });
  if (path.endsWith('/user_roles')) return response(res,filteredRows(req,[{user_id:fixtureUser.id,role:'admin'}]));
  if (path.endsWith('/restaurant_submissions')) return response(res,filteredRows(req,fixtureSubmissions));
  if (path.endsWith('/restaurant_submission_items')) return response(res,filteredRows(req,fixtureSubmissionItems));
  if (path.endsWith('/user_bookmarks')) return response(res,filteredRows(req,restaurants.slice(0,3).map((restaurant,i)=>({
    id:`00000000-0000-4000-a300-${String(i+1).padStart(12,'0')}`,user_id:fixtureUser.id,restaurant_id:restaurant.id,created_at:stamp }))));
  if (path.includes('/restaurants')) return response(res, filteredRows(req,restaurants));
  if (path.endsWith('/reviews')) return response(res,filteredRows(req,[...fixtureReviews,...pendingReviews]));
  if (path.endsWith('/rpc/read_public_profile_summaries')) {
    let body=''; for await (const chunk of req) { body+=chunk.toString(); if(body.length>65536)return response(res,{error:'FIXTURE_INPUT_LIMIT'},413); }
    let ids=[]; try { ids=JSON.parse(body).p_user_ids??[]; } catch { return response(res,{error:'FIXTURE_INPUT_INVALID'},400); }
    return response(res,ids.map(id=>fixtureProfiles.find(profile=>profile.user_id===id)).filter(Boolean));
  }
  if (path.endsWith('/rpc/read_public_profile_leaderboard_page') || path.endsWith('/rpc/read_public_profile_leaderboard')) return response(res,fixtureProfiles.map((p,i)=>({user_id:p.user_id,nickname:p.nickname,review_count:3,verified_review_count:3,total_likes:6,avg_likes_per_review:2,quality_score:100-i*5})));
  if (path.includes('/ad_banners') || path.includes('/banners')) return response(res, fixtureBanners);
  if (path.includes('/rpc/')) return response(res, []);
  return response(res, []);
});
mockSupabase.listen(18793, '127.0.0.1');

const preview = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/__fixture/session') {
    const cookie = `base64-${Buffer.from(JSON.stringify(fixtureSession())).toString('base64url')}`;
    res.writeHead(303,{'Set-Cookie':`sb-127-auth-token=${cookie}; Path=/; SameSite=Lax; Max-Age=86400`,Location:'/mypage/profile','Cache-Control':'no-store'});
    return res.end();
  }
  if (url.pathname === '/__fixture/anonymous') {
    res.writeHead(303,{'Set-Cookie':'sb-127-auth-token=; Path=/; SameSite=Lax; Max-Age=0',Location:'/','Cache-Control':'no-store'});
    return res.end();
  }
  if (url.pathname === '/__fixture/start') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end('<!doctype html><title>합성 데이터 디자인 검증</title><script>localStorage.setItem("tzudong:e2e-admin-shell-bypass","1");location.replace("/admin")</script>');
  }
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/admin/evaluations/automation' && req.method === 'POST') {
      let body='';for await(const chunk of req){body+=chunk.toString();if(body.length>2048)return response(res,{error:'FIXTURE_INPUT_LIMIT'},413);}
      try {return response(res,fixtureAutomationAction(JSON.parse(body)));}catch{return response(res,{error:'FIXTURE_INPUT_INVALID'},400);}
    }
    if (url.pathname === '/api/admin/profile-summaries' && req.method === 'POST') {
      let body=''; for await (const chunk of req) { body+=chunk.toString(); if(body.length>65536)return response(res,{error:'FIXTURE_INPUT_LIMIT'},413); }
      let ids=[]; try { ids=JSON.parse(body).userIds??[]; } catch { return response(res,{error:'FIXTURE_INPUT_INVALID'},400); }
      if(!Array.isArray(ids)||ids.length>100)return response(res,{error:'FIXTURE_INPUT_INVALID'},400);
      return response(res,{rows:ids.map(id=>({userId:id,nickname:fixtureProfiles.find(profile=>profile.user_id===id)?.nickname??null}))});
    }
    if (req.method !== 'GET') return response(res, { error: 'FIXTURE_WRITES_DISABLED' }, 405);
    return response(res, api(url.pathname, url.searchParams));
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
  let path;
  try {
    const target = new URL(req.url, origin);
    if (target.origin !== origin) throw new Error('origin mismatch');
    path = target.pathname + target.search;
  } catch { socket.destroy(); return; }
  const bridge = http.request({ hostname: '127.0.0.1', port: 18792, path,
    headers: { ...req.headers, host: '127.0.0.1:18792' } });
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
