import {mkdirSync,readFileSync,writeFileSync,symlinkSync,existsSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import ts from '@typescript/old';
const out=resolve('performance/public-cms-followthrough-20261009/share-http-status-followup'), fixture=resolve(out,'fixture'), root=process.cwd();
for(const dir of ['app/s/[code]','app/legacy/[code]','app/notice/[code]','public/styles'])mkdirSync(resolve(fixture,dir),{recursive:true});
if(!existsSync(resolve(fixture,'node_modules')))symlinkSync(resolve(root,'node_modules'),resolve(fixture,'node_modules'),'dir');
writeFileSync(resolve(fixture,'package.json'),JSON.stringify({name:'owned-short-url-http-fixture',private:true,type:'module'})+'\n');
writeFileSync(resolve(fixture,'next.config.mjs'),`const fixtureConfig = { distDir: process.env.FIXTURE_NEXT_DIST_DIR ?? '.next-dev', webpack(config) { config.resolve.alias['@']=${JSON.stringify(root)}; return config; } }; export default fixtureConfig;\n`);
writeFileSync(resolve(fixture,'app/layout.jsx'),`export const dynamic='force-dynamic'; export default function Layout({children}) { return <html lang="ko"><body>{children}</body></html>; }\n`);
writeFileSync(resolve(fixture,'app/page.jsx'),`export default function Page(){return <main><h1>Owned fixture landing</h1></main>;}\n`);
writeFileSync(resolve(fixture,'app/not-found.jsx'),`export default function Missing(){
 return <main><h1>Owned legacy not-found</h1>
 {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- native legacy baseline must not introduce a client navigation boundary */}
 <a href="/">Home</a></main>;
}\n`);
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
writeFileSync(resolve(fixture,'app/legacy/[code]/page.js'),transpile(readFileSync(resolve(out,'archive/original-notfound-page.tsx.txt'),'utf8')));
writeFileSync(resolve(fixture,'app/notice/[code]/page.js'),transpile(readFileSync(resolve(out,'archive/direct-notice-page.tsx.txt'),'utf8')));
writeFileSync(resolve(fixture,'app/s/[code]/route.js'),transpile(readFileSync(resolve(root,'app/s/[code]/route.ts'),'utf8')));
copyFileSync(resolve(root,'public/styles/share-fallback.css'),resolve(fixture,'public/styles/share-fallback.css'));copyFileSync(resolve(root,'public/logo.webp'),resolve(fixture,'public/logo.webp'));
console.log('Owned fixture uses installed Next/React/SDK and exact archived/current route sources; no install or pin change.');
