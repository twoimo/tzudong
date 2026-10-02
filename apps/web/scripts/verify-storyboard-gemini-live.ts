import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import sharp from 'sharp';
import { GeminiStoryboardClient, resolveStoryboardGeminiKey } from '../lib/admin/storyboard/gemini-client';
import { storyboardProductionRequestSchema } from '../lib/admin/storyboard/production-contract';

// One bounded text request and one image request. Never retry an uncertain response.
const envFile = process.argv[2];
if (!envFile || !isAbsolute(envFile)) throw new Error('absolute_operator_env_required');
const directory = 'performance/ui-renewal-20261003';
const proImage = process.argv[3] === '--pro-image';
const receipt = `${directory}/${proImage ? 'gemini-live-pro-image' : 'gemini-live-generation'}.json`;
if (existsSync(receipt)) throw new Error('existing_receipt_requires_readback');
mkdirSync(directory, { recursive: true });
const env: NodeJS.ProcessEnv = { ...parse(readFileSync(envFile)), NODE_ENV: 'production' };
const usage: Array<{ model: string; promptTokens: number | null; outputTokens: number | null; thoughtTokens: number | null; totalTokens: number | null }> = [];
const provider = new GeminiStoryboardClient({ apiKey: resolveStoryboardGeminiKey(env) ?? undefined, onUsage: (entry) => usage.push(entry) });
const request = storyboardProductionRequestSchema.parse({ workflow: 'storyboard-mlx-v1', requestId: crypto.randomUUID(),
  prompt: '개인정보와 실제 식당 이름이 없는 합성 검증용 촬영안. 국수 한 그릇을 소재로 5개 장면을 구성하고 각 설명은 간결하게 작성하세요.',
  sceneCount: 5, providers: { externalAI: true, text: { id: 'gemini-api', model: 'gemini-3.8-flash' },
    image: { id: 'gemini-api', model: proImage ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image' } } });
const result: Record<string, unknown> = { kind: 'live-funded-gemini-generation', measuredAt: new Date().toISOString(),
  environment: { sdk: JSON.parse(readFileSync('node_modules/@google/genai/package.json', 'utf8')).version },
  syntheticInput: true, operationalDatabaseWrites: 0, maximumGenerationCalls: proImage ? 1 : 2, generationCallsStarted: 0, usage,
  limitations: ['Single request per modality; no speed comparison or confidence interval.', 'Credit application and billed cost require a billing receipt.'] };
const save = () => writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n');
let stage = 'draft';
try {
  if (!proImage) {
  result.generationCallsStarted = 1; result.pending = stage; save();
  const startText = performance.now();
  const text = await provider.draft(request);
  result.draft = { elapsedMs: performance.now() - startText, sceneCount: text.draft.scenes.length,
    sha256: createHash('sha256').update(JSON.stringify(text.draft)).digest('hex'), responseModel: text.provenance.responseModel, verified: true };
  }
  stage = 'image'; result.generationCallsStarted = proImage ? 1 : 2; result.pending = stage; save();
  const startImage = performance.now();
  const image = await provider.image(request, 'Editorial food storyboard frame: a bowl of noodles on a simple pale table, overhead view, soft natural light, no people, no text, no logos.');
  const metadata = await sharp(image.bytes, { limitInputPixels: 16 * 1024 * 1024 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 16 * 1024 * 1024) throw new Error('invalid_image_response');
  result.image = { elapsedMs: performance.now() - startImage, bytes: image.bytes.length, width: metadata.width, height: metadata.height,
    sha256: createHash('sha256').update(image.bytes).digest('hex'), responseModel: image.provenance.responseModel, verified: true };
  writeFileSync(`${directory}/${proImage ? 'gemini-live-pro-image' : 'gemini-live-image'}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`, image.bytes);
  result.pending = null; result.passed = true; save();
  console.log(JSON.stringify({ passed: true, generationCallsStarted: result.generationCallsStarted, draft: result.draft, image: result.image, usage }));
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'verification_failed';
  result.passed = false; result.failedStage = stage; result.code = /^[a-z_]{1,80}$/.test(code) ? code : 'verification_failed';
  result.deliveryUnknown = true; save();
  console.log(JSON.stringify({ passed: false, failedStage: stage, code: result.code, deliveryUnknown: true }));
  process.exitCode = 1;
}
