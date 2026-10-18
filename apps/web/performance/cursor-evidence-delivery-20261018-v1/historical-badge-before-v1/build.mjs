import { fileURLToPath } from 'node:url';
import { dirname,join } from 'node:path';
import { writeFile,mkdir } from 'node:fs/promises';
const root=dirname(fileURLToPath(import.meta.url));
await mkdir(join(root,'build'),{recursive:true});
const result=await Bun.build({entrypoints:[join(root,'harness.jsx')],outdir:join(root,'build'),target:'browser',format:'esm',splitting:true,minify:true,define:{'process.env.NODE_ENV':'"production"'}});
if(!result.success)throw new Error(result.logs.map(String).join('\n'));
await writeFile(join(root,'build/index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>Badge component verification</title><link rel="stylesheet" href="/harness.css"><div id="root"></div><script type="module" src="/harness.js"></script></html>');
console.log(JSON.stringify({success:true,outputs:result.outputs.map(x=>({name:x.path.split('/').pop(),bytes:x.size}))}));
