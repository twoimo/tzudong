import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium, serve, pageSetup, origin, catalog} from './real-sdk-runtime-v8.mjs';

const kind = process.argv[2];
assert.ok(['baseline', 'candidate'].includes(kind));
assert.equal(process.versions.node, '24.21.0');
const receipt = JSON.parse(await readFile(new URL('build-receipts-v8.json', import.meta.url))).find(r => r.kind === kind);
assert.equal((await readFile(receipt.root+'/'+receipt.distDir+'/BUILD_ID', 'utf8')).trim(), receipt.buildId);
assert.equal(createHash('sha256').update(await readFile(receipt.root+'/package-lock.json')).digest('hex'), receipt.lockSha256);
const allowedTrace = new Set(['RunTask', 'FunctionCall', 'EvaluateScript', 'Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'Layerize', 'CompositeLayers', 'Commit', 'FireAnimationFrame', 'TimerFire', 'RunMicrotasks', 'MinorGC', 'MajorGC', 'UpdateLayerTree', 'ParseHTML', 'EventDispatch', 'V8.GCScavenger', 'V8.GCCompactor', 'V8.GCIncrementalMarking']);
function safeFrame(frame) {
  let group = 'builtin', asset = null;
  try {
    const url = new URL(frame.url);
    group = url.hostname === 'localhost' ? 'application' : /naver|pstatic|ntruss/.test(url.hostname) ? 'naver-family' : 'other-remote';
    const base = url.pathname.split('/').at(-1);
    if (group === 'application' && /^[A-Za-z0-9_.-]{1,100}\.js$/.test(base)) asset = base;
    if (group === 'naver-family' && base === 'maps.js') asset = 'maps.js';
  } catch {}
  const functionName = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/.test(frame.functionName) || ['(root)', '(program)', '(idle)', '(garbage collector)'].includes(frame.functionName)
    ? frame.functionName : frame.functionName ? 'opaque-'+createHash('sha256').update(frame.functionName).digest('hex').slice(0,12) : '(anonymous)';
  return {group, asset, functionName, line: frame.lineNumber, column: frame.columnNumber};
}

const result = {kind, sourceCommit: receipt.sourceCommit, buildId: receipt.buildId,
  startedAtUtc: new Date().toISOString(), diagnosticOnly: true, profilerMayAlterTiming: true,
  physicalDevice: false, fieldAdmission: 0, performanceAdmission: 0,
  environment: {cpuRate: 4, cache: 'disabled; SW bypass', viewport: '390x844/dpr1', data: 'syntheticREST735/Auth401; actual remoteSDK/tiles'},
  cycles: [], rawTraceArgumentsPersisted: false, rawProfileUrlsPersisted: false};
let browser, server, t, profiling = false, tracing = false, profile, trace, stage = 'start', traceBytes = 0;
try {
  server = await serve(receipt);
  browser = await chromium.launch({channel: 'chrome', headless: true});
  result.browserVersion = await browser.version();
  t = await pageSetup(browser);
  await t.page.addInitScript(() => {
    const probe = window.__sdkMethodProbe = {markerCreates: 0, methods: {}};
    const geometry = window.__geometryReadProbe = {};
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = new Proxy(NativeResizeObserver, {construct(target,args,newTarget) {
      const callback=args[0];
      return Reflect.construct(target,[(entries,observer)=>{
        const mapRoot=window.__swipeCacheUiProbe?.mapRef?.deref()?.getElement?.();
        for(const entry of entries)if(entry.target===mapRoot) {
          const item=geometry.mapSizeNotifications??={count:0,sizes:[]};item.count++;
          if(item.sizes.length<64)item.sizes.push({width:entry.contentRect.width,height:entry.contentRect.height});
        }
        callback(entries,observer);
      }],newTarget);
    }});
    const record = (name, start) => {
      const item = geometry[name] ??= {count: 0, durationMs: 0};
      item.count++; item.durationMs += performance.now()-start;
    };
    const descriptor = Object.getOwnPropertyDescriptor(VisualViewport.prototype, 'height');
    if (descriptor?.get && descriptor.configurable) Object.defineProperty(VisualViewport.prototype, 'height', {...descriptor, get() {
      const start=performance.now();try{return descriptor.get.call(this);}finally{record('visualViewportHeight',start);}
    }});
    const readProperty=CSSStyleDeclaration.prototype.getPropertyValue;
    CSSStyleDeclaration.prototype.getPropertyValue=function(name) {
      if(name !== '--mobile-bottom-nav-effective-height')return readProperty.call(this,name);
      const start=performance.now();try{return readProperty.call(this,name);}finally{record(this===document.documentElement.style?'inlineNavHeight':'computedNavHeight',start);}
    };
    document.addEventListener('load', event => {
      if (event.target?.tagName !== 'SCRIPT' || !event.target.src.includes('oapi.map.naver.com/openapi/v3/maps.js')) return;
      const maps = window.naver?.maps;
      if (!maps?.Marker) return;
      const originalTrigger=maps.Event.trigger;
      maps.Event.trigger=function(target,event,...args) {
        const start=performance.now();
        try{return originalTrigger.call(this,target,event,...args);}
        finally{if(event==='resize'&&target===window.__swipeCacheUiProbe?.mapRef?.deref())record('SDKresize',start);}
      };
      const Marker = maps.Marker;
      for (const name of ['setIcon', 'setMap', 'setPosition', 'setZIndex']) {
        const original = Marker.prototype[name];
        if (typeof original !== 'function') continue;
        Marker.prototype[name] = function(...args) {
          const start = performance.now();
          try {return original.apply(this, args);}
          finally {
            const metric = probe.methods[name] ??= {count: 0, durationMs: 0};
            metric.count += 1;
            metric.durationMs += performance.now()-start;
          }
        };
      }
      maps.Marker = new Proxy(Marker, {construct(target,args,newTarget) {
        probe.markerCreates += 1;
        return Reflect.construct(target,args,newTarget);
      }});
    }, true);
  });
  await t.page.goto(origin+'/?__qa=swipe-cache-20261009', {waitUntil: 'domcontentloaded', timeout: 30000});
  await t.page.locator('.cluster-marker-container').filter({hasText: '735'}).waitFor({state: 'visible', timeout: 45000});
  await t.awaitSdkReceipt();
  assert.equal(t.sdkScript.sha256, '802f8c5bb436eeb0014e0e8c72e7f675ae88e102766d2a923cd2c24c7eca74d1');
  result.sdkScript = {...t.sdkScript};
  await t.cdp.send('Profiler.enable');
  await t.cdp.send('Profiler.setSamplingInterval', {interval: 1000});
  await t.cdp.send('Profiler.start'); profiling = true;
  await t.cdp.send('Tracing.start', {categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream'}); tracing = true;
  const rows = catalog();
  for (let pass=0; pass<2; pass++) for (let query=0; query<8; query++) {
    const r = rows[(query*37+1)%rows.length];
    const label = `diagnostic-p${pass}-q${query}`;
    const markTime = await t.page.evaluate(label => {const marked = performance.mark(label); window.__sdkMethodProbe.methods = {}; for(const key of Object.keys(window.__geometryReadProbe))delete window.__geometryReadProbe[key]; window.__swipeCacheUiProbe.tasks.length = 0;return marked.startTime;}, label);
    const requestsBefore = t.requests.restaurant;
    await t.page.getByLabel('맛집 검색 열기', {exact: true}).click();
    await t.page.getByLabel('맛집 검색어 입력', {exact: true}).fill(r.name);
    await t.page.getByRole('button', {name: new RegExp(r.name)}).first().click();
    await t.page.getByTestId('restaurant-detail-panel').filter({hasText: r.name}).waitFor({state: 'visible', timeout: 15000});
    const state = await t.page.evaluate(async ({id,name}) => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const probe = window.__swipeCacheUiProbe;
      const ids = Array.from(document.querySelectorAll('[data-testid="marker"][data-restaurant-id]'), e => e.dataset.restaurantId);
      return {observedAt: performance.now(), inputToObservedMs: performance.now()-probe.lastClick,
        panelMatches: document.querySelector('[data-testid="restaurant-detail-panel"]')?.textContent?.includes(name),
        selectedMarkerPresent: ids.includes(id), duplicateMarkers: ids.length-new Set(ids).size,
        markerCount: ids.length, mapCreates: probe.mapCreates,
        geometry: structuredClone(window.__geometryReadProbe), methods: structuredClone(window.__sdkMethodProbe.methods), markerCreates: window.__sdkMethodProbe.markerCreates,
        tasks: probe.tasks.map(({time,duration}) => ({time,duration}))};
    }, {id: r.id, name: r.name});
    assert.ok(state.panelMatches && state.selectedMarkerPresent && !state.duplicateMarkers && state.mapCreates===1);
    result.cycles.push({pass, query, label, markTime, requests: t.requests.restaurant-requestsBefore, state});
  }
  stage = 'profile-stop';
  ({profile} = await t.cdp.send('Profiler.stop')); profiling = false;
  const completed = new Promise(resolve => t.cdp.once('Tracing.tracingComplete', resolve));
  await t.cdp.send('Tracing.end'); tracing = false;
  stage = 'trace-complete';
  const {stream} = await completed;
  let bytes=0, chunks=[];
  for (;;) {
    stage = 'trace-stream-read';
    const chunk = await t.cdp.send('IO.read', {handle: stream, size: 65536});
    const data = chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data;
    bytes += Buffer.byteLength(data); traceBytes = bytes;
    assert.ok(bytes <= 32*1024*1024, 'bounded_trace_exceeded');
    chunks.push(data);
    if (chunk.eof) break;
  }
  await t.cdp.send('IO.close', {handle: stream});
  stage = 'trace-json-parse';
  trace = JSON.parse(chunks.join('')); chunks = [];
  const events = trace.traceEvents.filter(e => allowedTrace.has(e.name) || /^diagnostic-p[01]-q[0-7]$/.test(e.name)).map(e => {
    const safe = {name: e.name, ph: e.ph, pid: e.pid, tid: e.tid, ts: e.ts};
    if (typeof e.dur === 'number') safe.dur = e.dur;
    return safe;
  });
  stage = 'profile-sanitize';
  const sanitizedProfile = {startTime: profile.startTime, endTime: profile.endTime,
    nodes: profile.nodes.map(n => ({id: n.id, callFrame: safeFrame(n.callFrame), children: n.children ?? [], hitCount: n.hitCount ?? 0})),
    samples: profile.samples, timeDeltas: profile.timeDeltas};
  stage = 'profile-aggregate';
  const sampling = new Map();
  const nodes = new Map(sanitizedProfile.nodes.map(n => [n.id,n]));
  for (let i=0; i<sanitizedProfile.samples.length; i++) {
    const frame = nodes.get(sanitizedProfile.samples[i]).callFrame;
    const key = JSON.stringify(frame);
    const row = sampling.get(key) ?? {...frame, sampledSelfUs: 0, samples: 0};
    row.sampledSelfUs += sanitizedProfile.timeDeltas[i]; row.samples++;
    sampling.set(key,row);
  }
  result.profile = {windowUs: profile.endTime-profile.startTime, intervalUs: 1000,
    topSelfFrames: [...sampling.values()].sort((a,b) => b.sampledSelfUs-a.sampledSelfUs).slice(0,40),
    groups: Object.fromEntries(['application','naver-family','builtin','other-remote'].map(group => [group,[...sampling.values()].filter(r => r.group===group).reduce((n,r) => n+r.sampledSelfUs,0)]))};
  result.trace = {retainedEvents: events.length, originalBytesNotPersisted: bytes,
    completeEventTotalsUs: Object.fromEntries([...allowedTrace].map(name => [name,events.filter(e => e.name===name && e.ph==='X').reduce((n,e) => n+(e.dur??0),0)])),
    totalsMayOverlapAndMustNotBeAdded: true};
  await writeFile(new URL(`trace-${kind}-sanitized-v8.json`,import.meta.url),JSON.stringify({traceEvents: events, privacy: 'No args, URLs, code, screenshots or request data retained'})+'\n',{flag:'wx'});
  await writeFile(new URL(`profile-${kind}-sanitized-v8.json`,import.meta.url),JSON.stringify(sanitizedProfile)+'\n',{flag:'wx'});
  result.passed = true;
} catch (error) {
  result.passed = false; result.failure = 'bounded_diagnostic_flow_unavailable';
  result.failureStage = stage;
  result.failureKind = error.code === 'ERR_ASSERTION' ? 'bounded_assertion' : error instanceof SyntaxError ? 'json_parse' : 'other-diagnostic';
  result.traceBytesAtFailure = traceBytes;
} finally {
  if (t) {
    if (profiling) await t.cdp.send('Profiler.stop').catch(()=>{});
    if (tracing) await t.cdp.send('Tracing.end').catch(()=>{});
    result.errors = {...t.errors}; result.requests = {...t.requests};
    await t.close();
  }
  if (browser) await browser.close();
  if (server) await server.close();
}
result.endedAtUtc = new Date().toISOString();
await writeFile(new URL(`diagnostic-${kind}-v8.json`, import.meta.url), JSON.stringify(result,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify({kind,passed:result.passed,cycles:result.cycles.length,profile:result.profile,trace:result.trace,errors:result.errors}));
if (!result.passed) process.exitCode = 1;
