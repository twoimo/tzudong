import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { callGeminiReceiptOcr, buildGeminiReceiptOcrRequest, getGeminiOcrModels } from '../lib/ocr/gemini';
import { getEnvFallbackSecrets } from '../lib/ocr/runtime-config';
import { RECEIPT_OCR_EXTRACTION_PROMPT } from '../lib/ocr/receipt-prompt';

// One provider attempt, synthetic text only, no raw OCR/image/credential output.
const file = process.argv[2];
if (!file || !isAbsolute(file)) throw new Error('absolute_operator_env_required');
const args = process.argv.slice(3);
const currentCandidate = args.includes('--current-candidate-defaults');
const outputIndex = args.indexOf('--output-dir');
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--current-candidate-defaults') continue;
  if (args[index] === '--output-dir' && args[index + 1]) { index++; continue; }
  throw new Error('verification_arguments_invalid');
}
const directory = outputIndex < 0 ? 'performance/ui-renewal-20261003' : resolve(args[outputIndex + 1]);
const outputRelative = relative(resolve('performance'), resolve(directory));
if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative)) throw new Error('verification_output_outside_performance');
const receipt = `${directory}/ocr-live-readback.json`;
if (existsSync(receipt)) throw new Error('existing_receipt_requires_readback');
const source = parse(readFileSync(file));
const key = source.GEMINI_CREDITS_API_KEY || source.GEMINI_API_KEY;
if (!key) throw new Error('funded_server_key_required');
const env: NodeJS.ProcessEnv = { NODE_ENV: 'production', GEMINI_CREDITS_API_KEY: key };
const production = '/Users/twoimo/.codex/runtime-cache/tzudong-release-20261003/production-after.env';
// A dated operating snapshot is historical evidence, not current configuration.
// The explicit candidate mode binds the existing vault copy and current defaults.
const config = currentCandidate ? source : existsSync(production) ? parse(readFileSync(production)) : {};
for (const name of ['GEMINI_OCR_MODEL','GEMINI_OCR_DEFAULT_MODEL','GEMINI_OCR_THINKING_LEVEL','GEMINI_THINKING_LEVEL']) {
  if (config[name]) env[name] = config[name];
}
const models = getGeminiOcrModels(env);
if (models.length !== 1 || getEnvFallbackSecrets('gemini', env).length !== 1) throw new Error('single_attempt_configuration_required');
const provider = new GoogleGenAI({ apiKey: key, httpOptions: { retryOptions: { attempts: 1 }, timeout: 12_000 } });
let calls = 0;
const report: Record<string, unknown> = { kind:'live-synthetic-ocr-readback',measuredAt:new Date().toISOString(),
  models, syntheticInput:true, operationalDatabaseWrites:0, maximumCalls:1, callsStarted:0,
  configurationSource:currentCandidate?'current-candidate-and-existing-vault-copy':'historical-operating-snapshot',
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  sourceHashes:Object.fromEntries(['lib/ocr/gemini.ts','lib/ocr/runtime-config.ts','lib/ocr/receipt-prompt.ts','scripts/verify-ocr-gemini-live.ts']
    .map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),
  sampleCount:1,confidenceInterval95:null,
  limits:['Single synthetic receipt only; no general accuracy or speed comparison.','Candidate helper call only; no Auth/quota/DB/browser operating flow.','No deployment or promotional credit deduction receipt.'] };
mkdirSync(directory,{recursive:true});
const save = () => writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');
writeFileSync(receipt,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
try {
  // Readiness is not an inference or a quota deduction.
  const metadata=await provider.models.get({ model: models[0], config: { httpOptions:{timeout:12_000} } });
  if(metadata.name?.replace(/^models\//,'')!==models[0]) throw new Error('model_identity_mismatch');
  const text = ['Synthetic Noodle Shop','2026-10-03 12:34','Noodles   10000 KRW','Tea        2000 KRW','TOTAL     12000 KRW'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620"><rect width="900" height="620" fill="white"/>${text.map((t,i)=>`<text x="55" y="${90+i*95}" fill="black" font-family="sans-serif" font-size="42">${t}</text>`).join('')}</svg>`;
  const image = await sharp(Buffer.from(svg)).png().toBuffer();
  report.inputSha256 = createHash('sha256').update(image).digest('hex');
  report.pending='provider'; save();
  const start = performance.now();
  const result = await callGeminiReceiptOcr({apiKey:key,imageBase64:image.toString('base64'),mimeType:'image/png',
    prompt:RECEIPT_OCR_EXTRACTION_PROMPT,env,generateContentImpl:async(input)=>{
      if (calls) throw new Error('attempt_bound_exceeded');
      calls++; report.callsStarted=calls; save();
      const response=await provider.models.generateContent(buildGeminiReceiptOcrRequest({...input,timeoutMs:12_000}));
      report.responseModel=response.modelVersion ?? null;
      const u=response.usageMetadata;
      report.usage={promptTokens:u?.promptTokenCount??null,outputTokens:u?.candidatesTokenCount??null,thoughtTokens:u?.thoughtsTokenCount??null,totalTokens:u?.totalTokenCount??null};
      return response.text ?? '';
    }});
  report.elapsedMs=performance.now()-start;
  const items=result.data.items??[];
  const responseModel=String(report.responseModel??'').replace(/^models\//,'');
  const revisionPrefix=`${models[0]}-`;
  report.matches={model:responseModel===models[0] || (responseModel.startsWith(revisionPrefix) && /^(?:\d{3}|\d{2}-\d{2})$/.test(responseModel.slice(revisionPrefix.length))),
    store:result.data.store_name==='Synthetic Noodle Shop',date:result.data.date==='2026-10-03',
    time:result.data.time==='12:34',total:result.data.total_amount===12000,
    items:items.length===2 && items.some(item=>item.name==='Noodles' && item.price===10000) && items.some(item=>item.name==='Tea' && item.price===2000),
    arithmetic:items.every(item=>typeof item.price==='number') && items.reduce((sum,item)=>sum+(item.price??0),0)===result.data.total_amount};
  report.outputSha256=createHash('sha256').update(JSON.stringify(result.data)).digest('hex');
  report.pending=null;report.passed=Object.values(report.matches as Record<string,boolean>).every(Boolean);save();
  console.log(JSON.stringify({passed:report.passed,model:report.responseModel,elapsedMs:report.elapsedMs,matches:report.matches,usage:report.usage,callsStarted:calls}));
  if(!report.passed)process.exitCode=1;
}catch{
  report.passed=false;report.callsStarted=calls;report.code='ocr_live_verification_failed';report.deliveryUnknown=calls>0;save();
  console.log(JSON.stringify({passed:false,code:report.code,callsStarted:calls,deliveryUnknown:calls>0}));process.exitCode=1;
}
