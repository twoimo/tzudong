import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  assertNewArtifactPath,
  buildSourceBinding,
  hashPublicConfiguration,
  parseLiveVerificationArguments,
  prepareEvidenceDirectory,
  readPackageVersion,
  readSecureOperatorEnv,
  reserveJsonReceipt,
  writeExclusiveArtifact,
} from './gemini-live-verification-io';

// One bounded text request and one image request. Never retry an uncertain response.
const cli = parseLiveVerificationArguments(process.argv.slice(2), {
  allowProImage: true,
  defaultOutputSubdirectory: 'ui-renewal-20261003',
});
const basename = cli.proImage ? 'gemini-live-pro-image' : 'gemini-live-generation';
const imageBasename = cli.proImage ? 'gemini-live-pro-image' : 'gemini-live-image';
const receiptPath = resolve(cli.outputDirectory, `${basename}.json`);
assertNewArtifactPath(receiptPath);

const envText = readSecureOperatorEnv(cli.envFile);
const { parse } = await import('dotenv');
const env: NodeJS.ProcessEnv = { ...parse(envText), NODE_ENV: 'production' };
const [clientModule, contractModule] = await Promise.all([
  import('../lib/admin/storyboard/gemini-client'),
  import('../lib/admin/storyboard/production-contract'),
]);
const key = clientModule.resolveStoryboardGeminiKey(env);
if (!key) throw new Error('funded_server_key_required');
const credentialSourceName = env.GEMINI_CREDITS_API_KEY?.trim()
  ? 'GEMINI_CREDITS_API_KEY'
  : env.STORYBOARD_GEMINI_API_KEY?.trim()
    ? 'STORYBOARD_GEMINI_API_KEY'
    : 'GEMINI_API_KEY';

prepareEvidenceDirectory(cli.outputDirectory);
const possibleImages = ['png', 'jpg', 'webp'].map((extension) => resolve(cli.outputDirectory, `${imageBasename}.${extension}`));
for (const imagePath of possibleImages) assertNewArtifactPath(imagePath, 'existing_artifact_requires_readback');

const request = contractModule.storyboardProductionRequestSchema.parse({
  workflow: contractModule.STORYBOARD_WORKFLOW,
  requestId: randomUUID(),
  prompt: '개인정보와 실제 식당 이름이 없는 합성 검증용 촬영안. 국수 한 그릇을 소재로 5개 장면을 구성하고 각 설명은 간결하게 작성하세요.',
  sceneCount: 5,
  providers: {
    externalAI: true,
    text: { id: 'gemini-api', model: 'gemini-3.8-flash' },
    image: { id: 'gemini-api', model: cli.proImage ? 'gemini-3-pro-image' : 'gemini-3.1-flash-image' },
  },
});
const usage: Array<{
  model: string;
  promptTokens: number | null;
  outputTokens: number | null;
  thoughtTokens: number | null;
  totalTokens: number | null;
}> = [];
const sourceBinding = buildSourceBinding([
  'lib/admin/storyboard/gemini-client.ts',
  'lib/admin/storyboard/gemini-models.ts',
  'lib/admin/storyboard/production-contract.ts',
  'package-lock.json',
  'scripts/gemini-live-verification-io.ts',
  'scripts/verify-storyboard-gemini-live.ts',
]);
const publicConfiguration = {
  proImage: cli.proImage,
  sceneCount: request.sceneCount,
  imageWidth: request.imageWidth,
  imageHeight: request.imageHeight,
  textModel: request.providers.text.model,
  imageModel: request.providers.image.model,
  imageSize: '1K',
  sdkAttempts: 1,
};
const result: Record<string, unknown> = {
  kind: 'live-funded-gemini-generation',
  measuredAt: new Date().toISOString(),
  environment: { sdk: readPackageVersion('node_modules/@google/genai/package.json') },
  syntheticInput: true,
  operationalDatabaseWrites: 0,
  maximumGenerationCalls: cli.proImage ? 1 : 2,
  generationCallsStarted: 0,
  sdkAttempts: 1,
  usage,
  credentialSourceName,
  configuration: publicConfiguration,
  configurationSha256: hashPublicConfiguration(publicConfiguration),
  sourceBinding,
  pending: 'reserved',
  limitations: [
    'Single request per modality; no speed comparison or confidence interval.',
    'Credit application and billed cost require a billing receipt.',
  ],
};
const receipt = reserveJsonReceipt(receiptPath, result);
const save = () => receipt.write(result);
const maximumCalls = cli.proImage ? 1 : 2;
let generationCalls = 0;
let stage = cli.proImage ? 'image' : 'draft';

try {
  const provider = new clientModule.GeminiStoryboardClient({
    apiKey: key,
    onUsage: (entry) => usage.push(entry),
  });
  if (!cli.proImage) {
    generationCalls += 1;
    if (generationCalls > maximumCalls) throw new Error('attempt_bound_exceeded');
    result.generationCallsStarted = generationCalls;
    result.pending = stage;
    save();
    const startText = performance.now();
    const text = await provider.draft(request);
    result.draft = {
      elapsedMs: performance.now() - startText,
      sceneCount: text.draft.scenes.length,
      sha256: createHash('sha256').update(JSON.stringify(text.draft)).digest('hex'),
      responseModel: text.provenance.responseModel,
      verified: true,
    };
  }

  stage = 'image';
  generationCalls += 1;
  if (generationCalls > maximumCalls) throw new Error('attempt_bound_exceeded');
  result.generationCallsStarted = generationCalls;
  result.pending = stage;
  save();
  const startImage = performance.now();
  const image = await provider.image(
    request,
    'Editorial food storyboard frame: a bowl of noodles on a simple pale table, overhead view, soft natural light, no people, no text, no logos.',
  );
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(image.bytes, { limitInputPixels: 16 * 1024 * 1024 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 16 * 1024 * 1024) {
    throw new Error('invalid_image_response');
  }
  const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  if (!extension || !['png', 'jpg', 'webp'].includes(extension)) throw new Error('invalid_image_response');
  result.image = {
    elapsedMs: performance.now() - startImage,
    bytes: image.bytes.length,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash('sha256').update(image.bytes).digest('hex'),
    responseModel: image.provenance.responseModel,
    verified: true,
  };
  writeExclusiveArtifact(resolve(cli.outputDirectory, `${imageBasename}.${extension}`), image.bytes);
  result.pending = null;
  result.passed = true;
  save();
  console.log(JSON.stringify({
    passed: true,
    generationCallsStarted: generationCalls,
    draft: result.draft,
    image: result.image,
    usage,
  }));
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'verification_failed';
  result.passed = false;
  result.failedStage = stage;
  result.code = /^[a-z_]{1,80}$/.test(code) ? code : 'verification_failed';
  result.deliveryUnknown = generationCalls > 0;
  result.generationCallsStarted = generationCalls;
  save();
  console.log(JSON.stringify({
    passed: false,
    failedStage: stage,
    code: result.code,
    deliveryUnknown: generationCalls > 0,
    generationCallsStarted: generationCalls,
  }));
  process.exitCode = 1;
} finally {
  receipt.close();
}
