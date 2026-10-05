import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';
const root = path.dirname(fileURLToPath(import.meta.url));
const evidence = '/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-web-contract';
const bundle = await readFile(path.join(root, 'bundle/entry.js'));
const baselineBundle = await readFile(path.join(root, 'bundle-baseline/entry.js'));
const css = await readFile(path.join(root, 'bundle/styles.css'));
const html = '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><title>Local modal fixture</title><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>';
const server = createServer((req, res) => {
 const pathname = new URL(req.url, 'http://localhost').pathname;
 res.setHeader('Content-Type', pathname === '/entry.js' ? 'text/javascript' : pathname === '/styles.css' ? 'text/css' : 'text/html');
 res.end(pathname === '/entry.js' ? (new URL(req.url, 'http://localhost').searchParams.has('baseline') ? baselineBundle : bundle) : pathname === '/styles.css' ? css : (new URL(req.url, 'http://localhost').searchParams.has('baseline') ? html.replace('/entry.js', '/entry.js?baseline=1') : html));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
let pageErrors = 0;
let blockedExternalRequests = 0;
try {
 const page = await browser.newPage();
 page.on('pageerror', () => pageErrors++);
 await page.route('**/*', route => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  blockedExternalRequests++;
  return route.abort();
 });
 await mkdir(evidence, {recursive:true});
 for (const revision of ['baseline','candidate']) {
 for (const width of [320,390,768,1024,1440]) {
  await page.setViewportSize({width,height:900});
  for (const kind of ['dialog','alert']) {
   for (const wide of [false,true]) {
    await page.goto(`${origin}/?kind=${kind}&wide=${Number(wide)}${revision==='baseline'?'&baseline=1':''}`);
    const modal = page.getByRole(kind === 'alert' ? 'alertdialog' : 'dialog');
    await modal.waitFor({state:'visible'});
    const geometry = await modal.evaluate(el => {
     const r = el.getBoundingClientRect();
     return {x:r.x,width:r.width,right:r.right,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
      focusInside:el.contains(document.activeElement),ariaModal:el.getAttribute('aria-modal')};
    });
    const expectedWidth = Math.min(width-(revision==='candidate'?32:0),wide ? 672 : 512);
    const requiredInset = revision==='candidate'?15.5:0;
    const passed = Math.abs(geometry.width-expectedWidth) < 1 && geometry.x >= requiredInset &&
     geometry.right <= width-requiredInset && geometry.documentWidth === width && geometry.focusInside;
    if ((width === 390 && !wide) || (width === 1440 && wide)) {
     await page.screenshot({path:path.join(evidence,`modal-${revision}-${kind}-${width}-${wide?'wide':'default'}.png`)});
    }
    if (kind === 'dialog') await page.keyboard.press('Escape');
    else await page.getByRole('button',{name:'닫기',exact:true}).click();
    await modal.waitFor({state:'hidden'});
    results.push({revision,viewportWidth:width,kind,wide,...geometry,expectedWidth,closePassed:true,passed});
   }
  }
 }
}
} finally {
 await browser.close();
 await new Promise(resolve => server.close(resolve));
 const receipt = {browser:'isolated headless installed Chrome',source:'actual local components bundled by Bun and Tailwind',cases:results.length,passed:results.filter(r=>r.passed).length,pageErrors,blockedExternalRequests,results};
 await writeFile(path.join(evidence,'modal-render.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({cases:receipt.cases,passed:receipt.passed,pageErrors,blockedExternalRequests}));
 if (results.length!==40 || results.some(r=>!r.passed) || pageErrors || blockedExternalRequests) process.exitCode=1;
}
