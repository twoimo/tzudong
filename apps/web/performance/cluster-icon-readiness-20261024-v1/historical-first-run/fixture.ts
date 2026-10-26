import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export const appRoot = resolve(import.meta.dir, '../..');
export const baseline = '1b5230ac93021c72499f4950bff6cda24e2515e5';
export const categories = ['고기', '치킨', '한식', '중식', '일식', '양식', '분식', '카페·디저트', '아시안', '패스트푸드', '족발·보쌈', '돈까스·회', '피자', '찜·탕', '야식', '도시락', '사용자 제보', '트렌드', '제철'];
export const baselineSource = execFileSync('git', ['show', `${baseline}:apps/web/lib/cluster-marker.ts`], {cwd: appRoot, encoding:'utf8'});

export async function bundleFixture(candidate: boolean) {
  const entry = `import { createIndividualMarkerHTML } from './lib/cluster-marker';
    ${candidate ? "import { primeCategoryMarkerImages } from './lib/category-marker-image-primer';" : ''}
    const cats = ${JSON.stringify(categories)};
    window.fixture = { dispose: ${candidate ? 'primeCategoryMarkerImages(document)' : '() => {}'}, expand() {
      window.expandedAt = performance.now();
      document.querySelector('#map').innerHTML = Array.from({length:76}, (_,i) => createIndividualMarkerHTML(cats[i%cats.length],false,2,'fixture-'+i)).join('');
    }};
    document.querySelector('#map').innerHTML = createIndividualMarkerHTML('한식',false,0,'initial-cluster');
    document.querySelector('#expand').addEventListener('click',window.fixture.expand);`;
  const built = await Bun.build({entrypoints:['icon-readiness-fixture'],target:'browser',format:'iife',write:false,
    plugins:[{name:'icon-readiness',setup(builder) {
      builder.onResolve({filter:/^icon-readiness-fixture$/},()=>({path:'entry',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:entry,loader:'ts',resolveDir:appRoot}));
      if (!candidate) builder.onLoad({filter:/\/lib\/cluster-marker\.ts$/},()=>({contents:baselineSource,loader:'ts',resolveDir:resolve(appRoot,'lib')}));
    }}]});
  if (!built.success) throw new Error('Fixture bundle failed');
  return built.outputs[0].text();
}

export async function serveFixture(page: Page, bundle: string, delayMs = 80, failure = false) {
  const requests: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/*',async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://icon-readiness.test') {unexpected.push(url.origin);return route.abort();}
    if (url.pathname.startsWith('/images/maker-images/')) {
      requests.push(url.pathname);
      // Deliberate, identical first-transfer latency in both arms. This is not
      // a simulated decode delay or a measurement of production network speed.
      await new Promise(resolveDelay => setTimeout(resolveDelay,delayMs));
      if (failure) return route.fulfill({status:404,body:''});
      return route.fulfill({contentType:url.pathname.endsWith('.webp')?'image/webp':'image/png',
        headers:{'cache-control':'public,max-age=31536000,immutable'},body:readFileSync(resolve(appRoot,'public'+url.pathname))});
    }
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><button id="expand">Expand cluster</button><div id="map" aria-label="fixture map"></div><style>
      #map{display:flex;gap:8px;flex-wrap:wrap;max-width:100%}.tzudong-marker-image{width:32px;height:32px}.tzudong-marker-picture{display:block}
      </style>`});
  });
  await page.goto('https://icon-readiness.test/');
  await page.addScriptTag({content:bundle});
  return {requests,unexpected};
}
