import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { safeCliErrorName } from './privacy-safe-cli-log.mjs';

const SMOKE_FLAG = 'STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_SMOKE';
const CI_OVERRIDE_FLAG = 'STORYBOARD_ALLOW_CI_REAL_PROVIDER_SMOKE';
const ARGS_JSON_OVERRIDE_FLAG = 'STORYBOARD_EIGHT_PRESET_REAL_PROVIDER_ALLOW_ARGS_JSON';
const DEFAULT_OUTPUT_DIR = '.omx/ultraqa/storyboard-eight-real-smoke';
const CASE_COUNT = 8;

function printUsage() {
  console.log(`Usage: bun run storyboard:eight-real-smoke -- [--case <id> | --limit <1-7> | --all] [--output-dir <path>]\n\nManual only. Requires ${SMOKE_FLAG}=1, refuses CI by default, and consumes real provider quota.`);
}

function fail(message: string, code = 1): never {
  console.error(`[storyboard:eight-real-smoke] ${message}`);
  process.exit(code);
}

function isTruthy(value: string | undefined) {
  return value === '1' || value === 'true' || value === 'yes';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function redact(value: string | undefined) {
  if (!value) return undefined;
  if (value.length <= 8) return '<redacted>';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function resolveOutputBase(outputDir: string) {
  const base = resolve(DEFAULT_OUTPUT_DIR);
  const requested = resolve(outputDir);
  const relativeToBase = relative(base, requested);
  if (
    requested !== base &&
    (relativeToBase.startsWith('..') || isAbsolute(relativeToBase))
  ) {
    fail(`--output-dir must stay under ignored ${DEFAULT_OUTPUT_DIR}`, 2);
  }
  return requested;
}

function parseArgs(argv: string[]) {
  let caseId: string | null = null;
  let limit = 1;
  let all = false;
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
    if (arg === '--all') {
      all = true;
      continue;
    }
    if (arg === '--case') {
      caseId = argv[index + 1] ?? fail('--case requires an id', 2);
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      const raw = argv[index + 1] ?? fail('--limit requires a number', 2);
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed >= CASE_COUNT) {
        fail('--limit must be an integer from 1 to 7; use --all for all eight quota-consuming cases', 2);
      }
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === '--output-dir') {
      outputDir = argv[index + 1] ?? fail('--output-dir requires a path', 2);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`, 2);
  }

  if (all && caseId) {
    fail('Use either --all or --case, not both', 2);
  }
  if (all) {
    limit = CASE_COUNT;
  }

  return { all, caseId, limit, outputDir };
}

function assertManualGuards(env: NodeJS.ProcessEnv) {
  if (!isTruthy(env[SMOKE_FLAG])) {
    fail(`${SMOKE_FLAG}=1 is required; refusing before proof/provider execution.`, 3);
  }
  if (isTruthy(env.CI) && !isTruthy(env[CI_OVERRIDE_FLAG])) {
    fail(`CI=true detected; set ${CI_OVERRIDE_FLAG}=1 only for an intentional operator-run smoke.`, 3);
  }
  if (env.STORYBOARD_LOCAL_CODEX_ARGS_JSON && !isTruthy(env[ARGS_JSON_OVERRIDE_FLAG])) {
    fail(`${ARGS_JSON_OVERRIDE_FLAG}=1 is required when STORYBOARD_LOCAL_CODEX_ARGS_JSON is present; refusing likely fake-provider args before execution.`, 3);
  }
  const proofPath = env.STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE;
  if (!proofPath || !existsSync(proofPath)) {
    fail('A fresh exact proof path in STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE is required before provider execution.', 3);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputBase = resolveOutputBase(options.outputDir);
  assertManualGuards(process.env);

  const [presetsModule, generatorModule, imageProviderModule, imageTrustModule] = await Promise.all([
    import('../lib/admin/storyboard/guided-example-presets.ts'),
    import('../lib/admin/storyboard/generator.ts'),
    import('../lib/admin/storyboard/image-provider.ts'),
    import('../lib/admin/storyboard/image-trust.ts'),
  ]);

  const availability = imageProviderModule.getStoryboardImageProviderAvailability(process.env);
  if (!availability.available) {
    fail(`Storyboard provider is unavailable: ${availability.reason}`);
  }
  if (
    availability.providerId !== 'local-codex' ||
    availability.model !== 'gpt-image-2' ||
    availability.modelProvenance !== 'exact'
  ) {
    fail('Real-provider smoke requires local-codex gpt-image-2 exact provenance.');
  }

  const starterPresets = presetsModule.STORYBOARD_GUIDED_EXAMPLE_STARTER_PRESETS;
  const selectedPresets = options.caseId
    ? starterPresets.filter((preset) => preset.id === options.caseId)
    : starterPresets.slice(0, options.limit);

  if (selectedPresets.length === 0) {
    fail(`Unknown starter preset id: ${options.caseId}`, 2);
  }

  const runDir = join(
    outputBase,
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  mkdirSync(runDir, { recursive: true });

  const cases = [];
  for (const preset of selectedPresets) {
    const request = {
      prompt: preset.prompt,
      tone: preset.tone,
      targetLengthMinutes: preset.targetLengthMinutes,
      sourceLimit: preset.sourceLimit,
      segmentCount: preset.segmentCount,
      includeProductionNotes: true,
      generationMode: 'backend_agent' as const,
    };
    const result = generatorModule.generateLocalStoryboard(request);
    const scenes = result.storyboard.scenes.slice(0, 4);
    const images = await imageProviderModule.generateStoryboardSceneImages(
      scenes,
      {
        title: result.storyboard.title,
        logline: result.storyboard.logline,
        request,
      },
      process.env,
    );
    const trustedImages = images.filter((entry) =>
      imageTrustModule.isTrustedStoryboardGeneratedImage(entry.image),
    );
    if (trustedImages.length !== scenes.length) {
      fail(`${preset.id}: expected ${scenes.length} trusted images, received ${trustedImages.length}`);
    }
    cases.push({
      id: preset.id,
      label: preset.label,
      requestedSegmentCount: preset.segmentCount,
      generatedSceneCount: result.storyboard.scenes.length,
      imageGenerationSceneNos: scenes.map((scene) => scene.sceneNo),
      trustedImageCount: trustedImages.length,
      imageHashes: trustedImages.map((entry) => sha256(entry.image.dataUrl)),
      verdict: 'passed',
    });
  }

  const report = {
    schemaVersion: 1,
    kind: 'storyboard-eight-real-provider-smoke',
    verdict: 'passed',
    generatedAt: new Date().toISOString(),
    manualOnly: true,
    ciAllowedByOverride: isTruthy(process.env[CI_OVERRIDE_FLAG]),
    selectedCaseCount: cases.length,
    allCasesRequested: options.all,
    provider: {
      providerId: availability.providerId,
      model: availability.model,
      modelProvenance: availability.modelProvenance,
      proofPath: redact(process.env.STORYBOARD_LOCAL_CODEX_PROVENANCE_FILE),
    },
    cases,
  };

  const reportPath = join(runDir, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, selectedCaseCount: cases.length, reportPath }, null, 2));
}

main().catch((error) => {
  fail(safeCliErrorName(error));
});
