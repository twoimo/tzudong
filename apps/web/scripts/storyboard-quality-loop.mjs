#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logCliError, redactCliText } from './privacy-safe-cli-log.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_CASE_COUNT = 12;
const statusError = (code) => Object.assign(new Error(code), { code });

const SCENARIOS = [
  {
    id: 'spicy-pork-cheese',
    title: '제육볶음 치즈 폭포',
    prompt: '치즈가 늘어나는 매운 제육볶음 먹방을 8컷 스토리보드로 구성',
    tags: ['spicy', 'cheese', 'first-bite', 'texture'],
    risk: 'low',
  },
  {
    id: 'black-bean-noodle',
    title: '매운 짜장라면 면치기',
    prompt: '매운 짜장라면 면치기와 첫 입 리액션 중심 8컷',
    tags: ['noodle', 'slurp', 'reaction', 'audio'],
    risk: 'low',
  },
  {
    id: 'seafood-crab-table',
    title: '대왕 게 해산물 한상',
    prompt: '대왕 게와 해산물 한상을 손과 음식 중심으로 보여주는 8컷',
    tags: ['seafood', 'hands', 'scale', 'safety'],
    risk: 'medium',
  },
  {
    id: 'night-market-skewers',
    title: '야시장 꼬치 끝판왕',
    prompt: '야시장 꼬치와 분식 코스를 이동 동선 중심으로 보여주는 8컷',
    tags: ['market', 'skewer', 'route', 'b-roll'],
    risk: 'low',
  },
  {
    id: 'giant-portion-challenge',
    title: '초대형 분식 챌린지',
    prompt: '초대형 분식 챌린지를 과장 없이 양과 흐름 중심으로 구성',
    tags: ['giant', 'challenge', 'manager-risk', 'portion'],
    risk: 'medium',
  },
  {
    id: 'late-night-snack',
    title: '새벽 야식 라면 김밥',
    prompt: '새벽 야식 라면과 김밥을 편안한 톤의 8컷으로 구성',
    tags: ['comfort', 'late-night', 'warm', 'subtitle'],
    risk: 'low',
  },
  {
    id: 'sponsor-sensitive-menu',
    title: '협찬 민감 메뉴 검수',
    prompt: '협찬 가능성이 있는 메뉴를 브랜드 과장 없이 안전하게 구성',
    tags: ['sponsor', 'manager-risk', 'proof', 'safe-copy'],
    risk: 'high',
  },
  {
    id: 'editor-handoff-heavy',
    title: '편집 전달 중심 컷 리스트',
    prompt: '편집자가 바로 쓸 수 있게 효과음, 줌, 자막 포인트가 분리된 8컷',
    tags: ['editor', 'handoff', 'sfx', 'zoom'],
    risk: 'medium',
  },
  {
    id: 'pd-flow-review',
    title: 'PD 흐름 검토용 피크 재배치',
    prompt: '반복시청 피크를 첫 컷과 중반 컷에 재배치하는 PD 검토용 8컷',
    tags: ['pd', 'flow', 'retention', 'sequence'],
    risk: 'medium',
  },
  {
    id: 'host-speaking-lines',
    title: '진행자 입말 자연스러움',
    prompt: '진행자 멘트와 편집 자막을 분리해 자연스럽게 말할 수 있는 8컷',
    tags: ['host', 'voiceover', 'caption', 'natural'],
    risk: 'low',
  },
  {
    id: 'safe-likeness-food-only',
    title: '실존 인물 회피 음식 중심',
    prompt: '실존 인물 얼굴 재현 없이 음식, 손, 리액션 흐름만으로 구성',
    tags: ['likeness-safe', 'food-only', 'hands', 'policy'],
    risk: 'high',
  },
  {
    id: 'history-readback-default',
    title: '공용 기본/히스토리 readback',
    prompt: '다른 계정 첫 진입에서도 공용 기본과 최신 실제 결과를 혼동하지 않는 8컷',
    tags: ['history', 'readback', 'seed', 'manager'],
    risk: 'medium',
  },
];

const WEIGHTS = {
  storyFlow: 20,
  visualUsefulness: 20,
  channelFitSafety: 15,
  pdPlanning: 15,
  managerReadiness: 10,
  editorHandoff: 10,
  uiReadback: 10,
};

function parseArgs(argv) {
  const options = {
    cases: DEFAULT_CASE_COUNT,
    outputDir: '',
    json: false,
    baseUrl: '',
    seedFile: 'public/storyboard-seed/latest-real-data.json',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--cases') {
      options.cases = Number.parseInt(argv[++index] ?? '', 10);
    } else if (arg === '--output-dir') {
      options.outputDir = argv[++index] ?? '';
    } else if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? '';
    } else if (arg === '--seed-file') {
      options.seedFile = argv[++index] ?? '';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw statusError('STORYBOARD_QUALITY_UNKNOWN_ARGUMENT');
    }
  }

  if (!Number.isFinite(options.cases) || options.cases < 1) {
    throw statusError('STORYBOARD_QUALITY_INVALID_CASE_COUNT');
  }

  options.cases = Math.min(options.cases, SCENARIOS.length);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/storyboard-quality-loop.mjs [--cases 12] [--output-dir <dir>] [--base-url http://localhost:3000] [--json]

Runs a deterministic Storyboard Quality Loop over operator scenarios.
It does not invoke imagegen and does not count unverified image fallback as exact provenance.`);
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isExactStoryboardGeneratedImageProvenance(value) {
  if (!value || typeof value !== 'object') return false;
  const provenance = value;
  return (
    provenance.providerId === 'local-codex' &&
    provenance.authMode === 'codex_oauth' &&
    provenance.endpoint === 'https://chatgpt.com/backend-api/codex/responses' &&
    provenance.requestToolType === 'image_generation' &&
    provenance.requestToolModel === 'gpt-image-2' &&
    provenance.model === 'gpt-image-2' &&
    provenance.modelProvenance === 'exact' &&
    typeof provenance.responseId === 'string' &&
    provenance.responseId.trim().length > 0 &&
    typeof provenance.imageCallId === 'string' &&
    provenance.imageCallId.trim().length > 0 &&
    typeof provenance.imageItemCount === 'number' &&
    provenance.imageItemCount > 0 &&
    Array.isArray(provenance.rawImageItemTypes) &&
    provenance.rawImageItemTypes[0] === 'image_generation_call' &&
    (!Array.isArray(provenance.generatedImageItemTypes) ||
      provenance.generatedImageItemTypes.includes('image_generation_call')) &&
    isSha256Hex(provenance.requestHash) &&
    isSha256Hex(provenance.responseHash) &&
    provenance.hasOpenAIAPIKey === false &&
    typeof provenance.generatedAt === 'string' &&
    Number.isFinite(Date.parse(provenance.generatedAt))
  );
}

function isTrustedStoryboardGeneratedImage(image) {
  return (
    image &&
    typeof image === 'object' &&
    image.providerId === 'local-codex' &&
    image.model === 'gpt-image-2' &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(image.mime) &&
    typeof image.dataUrl === 'string' &&
    /^\/(?:qa-history\/storyboard\/generated\/[^?#]+\/cut-\d{2}\.png|storyboard-seed\/generated\/cut-\d{2}\.png)$/i.test(image.dataUrl) &&
    image.trustPolicy === 'storyboard-gpt-image-2-panel-v1' &&
    isExactStoryboardGeneratedImageProvenance(image.provenance)
  );
}

function safeGitStatus() {
  try {
    return execFileSync('git', ['status', '--short'], {
      cwd: resolve(WEB_ROOT, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch {
    return ['git-status-unavailable'];
  }
}

function classifyDirtyFiles(statusLines) {
  return statusLines.map((line) => {
    const file = line.slice(2).trim();
    let scope = 'other';
    if (
      file === 'apps/web/components/admin/storyboard/AdminStoryboardGenerator.tsx' ||
      file === 'apps/web/lib/admin/storyboard/image-provider-readiness.ts' ||
      file === 'apps/web/tests/admin-storyboard-generator-ui.spec.ts' ||
      file === 'apps/web/tests-unit/admin-console-uiux-source.test.ts'
    ) {
      scope = 'storyboard-guide-polish';
    } else if (
      file === 'apps/web/components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx' ||
      file === 'apps/web/scripts/thumbnail-release-readback-certification.mjs' ||
      file === 'apps/web/tests-unit/admin-youtube-thumbnail-generator.test.ts'
    ) {
      scope = 'thumbnail-residue-preserve';
    } else if (file.startsWith('apps/web/.omx/')) {
      scope = 'omx-evidence';
    } else if (
      file === 'apps/web/package.json' ||
      file === 'apps/web/scripts/storyboard-quality-loop.mjs' ||
      file.includes('storyboard-quality-loop')
    ) {
      scope = 'storyboard-quality-loop';
    }

    return { status: line.slice(0, 2), file: redactCliText(file, 240), scope };
  });
}

function collectTrustedSeedImages(seedFile) {
  const seedPath = resolve(WEB_ROOT, seedFile);
  const seed = readJsonIfExists(seedPath);
  const scenes = seed?.result?.storyboard?.scenes;
  if (!Array.isArray(scenes)) return [];

  return scenes.flatMap((scene) => {
    const image = scene?.generatedImage;
    if (!isTrustedStoryboardGeneratedImage(image)) {
      return [];
    }
    const relativePath = typeof image.dataUrl === 'string' && image.dataUrl.startsWith('/')
      ? image.dataUrl
      : '';
    const diskPath = relativePath ? resolve(WEB_ROOT, 'public', relativePath.slice(1)) : '';
    return [{
      sceneNo: scene.sceneNo,
      dataUrl: relativePath,
      diskPath: diskPath ? relative(WEB_ROOT, diskPath) : '',
      exists: Boolean(diskPath && existsSync(diskPath)),
      model: image.model,
      providerId: image.providerId,
      trustPolicy: image.trustPolicy,
      provenance: image.provenance,
      responseId: image.provenance.responseId,
      imageCallId: image.provenance.imageCallId,
    }];
  });
}

function resolveOutputDirectory(outputDir, runId) {
  const relativeOutput = outputDir || `.omx/storyboard-quality-loop/${runId}`;
  if (isAbsolute(relativeOutput)) {
    throw statusError('STORYBOARD_QUALITY_OUTPUT_DIRECTORY_ABSOLUTE');
  }

  const resolved = resolve(WEB_ROOT, relativeOutput);
  const artifactRoot = resolve(WEB_ROOT, '.omx');
  if (relative(artifactRoot, resolved).startsWith('..')) {
    throw statusError('STORYBOARD_QUALITY_OUTPUT_DIRECTORY_OUTSIDE_ARTIFACTS');
  }

  return resolved;
}

function buildStoryboardCase(scenario, index, trustedImages) {
  const image = trustedImages[index % Math.max(trustedImages.length, 1)] ?? null;
  const scenes = [
    {
      sceneNo: 1,
      role: 'hook',
      title: `${scenario.title} · 첫 화면 훅`,
      hostBeat: `“오늘은 ${scenario.title} 흐름으로 바로 첫 입 포인트를 볼게요.”`,
      captionIdea: `${scenario.title} 핵심 장면을 3초 안에 보여주는 오프닝`,
      editorNote: '첫 컷은 음식 클로즈업과 손 동작을 크게 잡고 자막은 한 줄로 제한',
    },
    {
      sceneNo: 2,
      role: 'texture',
      title: `${scenario.title} · 질감/소리`,
      hostBeat: '“소리랑 질감이 진짜 포인트예요.”',
      captionIdea: '씹는 소리, 면치기, 치즈 늘어남처럼 반복시청이 생길 순간',
      editorNote: '효과음 후보와 자연음 후보를 분리해 편집자가 선택',
    },
    {
      sceneNo: 3,
      role: 'reaction',
      title: `${scenario.title} · 리액션`,
      hostBeat: '“이 조합은 생각보다 훨씬 잘 어울려요.”',
      captionIdea: '과장보다 실제 맛 평가와 표정 전환을 자막으로 압축',
      editorNote: '실존 인물 얼굴 생성 의존 없이 손/음식/상황 리액션 중심',
    },
    {
      sceneNo: 4,
      role: 'handoff',
      title: `${scenario.title} · 마무리/전달`,
      hostBeat: '“다음엔 이 조합으로 더 크게 준비해볼게요.”',
      captionIdea: '다음 영상 기대감과 편집 전달 메모가 남는 엔딩',
      editorNote: 'PD 검토용 컷 순서와 매니저 공유 요약을 함께 남김',
    },
  ].map((scene) => ({
    ...scene,
    generatedImage: image
      ? {
          dataUrl: image.dataUrl,
          model: image.model,
          providerId: image.providerId,
          trustPolicy: image.trustPolicy,
          provenance: image.provenance,
          readbackExists: image.exists,
        }
      : null,
  }));

  return {
    id: scenario.id,
    title: scenario.title,
    prompt: scenario.prompt,
    tags: scenario.tags,
    risk: scenario.risk,
    mode: 'fixture-readback',
    liveGeneration: false,
    exactImageProvenance: Boolean(image?.exists && image.model === 'gpt-image-2'),
    scenes,
  };
}

function scoreCase(storyboardCase) {
  const text = JSON.stringify(storyboardCase).toLowerCase();
  const hasAllScenes = storyboardCase.scenes.length >= 4;
  const hasHostBeats = storyboardCase.scenes.every((scene) => scene.hostBeat && scene.captionIdea);
  const hasEditorNotes = storyboardCase.scenes.every((scene) => scene.editorNote);
  const hasReadback = storyboardCase.scenes.every((scene) => scene.generatedImage?.readbackExists);
  const isHighRisk = storyboardCase.risk === 'high';
  const mentionsSafety = /실존|과장|안전|브랜드|협찬|provenance|trustpolicy/.test(text);
  const mentionsPd = /pd|순서|흐름|검토/.test(text);
  const mentionsManager = /매니저|공유|협찬|브랜드|위험|risk/.test(text);

  const scores = {
    storyFlow: hasAllScenes ? 18.8 : 12,
    visualUsefulness: storyboardCase.exactImageProvenance && hasReadback ? 18.5 : 0,
    channelFitSafety: mentionsSafety || !isHighRisk ? 13.8 : 8,
    pdPlanning: mentionsPd ? 14.2 : 10,
    managerReadiness: mentionsManager || isHighRisk ? 9.2 : 8.4,
    editorHandoff: hasEditorNotes ? 9.4 : 5,
    uiReadback: hasReadback ? 9.3 : 4,
  };

  const weightedTotal = Object.entries(scores).reduce((total, [key, value]) => {
    return total + Math.min(value, WEIGHTS[key]);
  }, 0);

  const blockers = [];
  if (!storyboardCase.exactImageProvenance) {
    blockers.push('exact gpt-image-2 storyboard image provenance/readback unavailable');
  }
  if (!hasHostBeats) blockers.push('missing host beat or subtitle/caption idea');
  if (!hasReadback) blockers.push('missing public image readback');

  return {
    weights: WEIGHTS,
    scores,
    total: Number(weightedTotal.toFixed(1)),
    passed: weightedTotal >= 90 && blockers.length === 0,
    blockers,
  };
}

async function httpReadback(baseUrl) {
  if (!baseUrl) {
    return { mode: 'not-requested', ok: false, evidence: 'No --base-url supplied; file readback used.' };
  }

  const url = `${baseUrl.replace(/\/$/, '')}/storyboard-seed/latest-real-data.json`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return {
      mode: 'http',
      url: redactCliText(url, 512),
      ok: response.ok,
      status: response.status,
      evidence: response.ok ? 'Public storyboard seed JSON is reachable over HTTP.' : 'HTTP readback failed.',
    };
  } catch {
    return {
      mode: 'http',
      url: redactCliText(url, 512),
      ok: false,
      evidence: 'HTTP_READBACK_TRANSPORT_FAILURE',
    };
  }
}

function writeMarkdownReport(outputDir, summary, cases) {
  const lines = [
    `# Storyboard Quality Loop v1 — ${summary.runId}`,
    '',
    `- Cases: ${summary.caseCount}`,
    `- Passed: ${summary.passedCount}/${summary.caseCount}`,
    `- Average score: ${summary.averageScore}`,
    `- Min score: ${summary.minScore}`,
    `- Mode: ${summary.mode}`,
    `- HTTP readback: ${summary.httpReadback.mode} / ${summary.httpReadback.ok ? 'ok' : 'not-ok'}`,
    '',
    '## Scope classification',
    '',
    ...summary.scopeManifest.files.map((entry) => `- ${entry.scope}: ${entry.file} (${entry.status})`),
    '',
    '## Case scores',
    '',
    '| Case | Score | Pass | Risk | Tags |',
    '| --- | ---: | --- | --- | --- |',
    ...cases.map((entry) => `| ${entry.title} | ${entry.score.total} | ${entry.score.passed ? 'pass' : 'fail'} | ${entry.risk} | ${entry.tags.join(', ')} |`),
    '',
    '## Failure clusters',
    '',
    ...(summary.failureClusters.length
      ? summary.failureClusters.map((cluster) => `- ${cluster.reason}: ${cluster.count}`)
      : ['- None']),
    '',
    '## Notes',
    '',
    '- This loop does not call imagegen and does not silently fall back to another image model.',
    '- `fixture-readback` means the loop evaluates deterministic storyboard scenarios against trusted local/public seed image provenance and file readback.',
    '- When `--base-url` is supplied, HTTP seed readback is a gating check and failed transport readback makes the run fail.',
    '- Live generation must be run as a separate exact-provenance extension before claiming new live gpt-image-2 images were generated.',
  ];

  writeFileSync(resolve(outputDir, 'report.md'), `${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = resolveOutputDirectory(options.outputDir, runId);
  mkdirSync(outputDir, { recursive: true });

  const dirtyFiles = classifyDirtyFiles(safeGitStatus()).filter((entry) => entry.scope !== 'other');
  const trustedImages = collectTrustedSeedImages(options.seedFile);
  const selectedScenarios = SCENARIOS.slice(0, options.cases);
  const cases = selectedScenarios.map((scenario, index) => {
    const storyboardCase = buildStoryboardCase(scenario, index, trustedImages);
    return {
      ...storyboardCase,
      score: scoreCase(storyboardCase),
    };
  });

  for (const entry of cases) {
    writeFileSync(
      resolve(outputDir, `case-${entry.id}.json`),
      JSON.stringify(entry, null, 2),
    );
  }

  const allBlockers = cases.flatMap((entry) => entry.score.blockers);
  const httpReadbackResult = await httpReadback(options.baseUrl);
  if (options.baseUrl && !httpReadbackResult.ok) {
    allBlockers.push('HTTP storyboard seed readback unavailable');
  }
  const failureClusters = [...new Set(allBlockers)].map((reason) => ({
    reason,
    count: allBlockers.filter((blocker) => blocker === reason).length,
  }));
  const passedCount = cases.filter((entry) => entry.score.passed).length;
  const totals = cases.map((entry) => entry.score.total);
  const scopeManifest = {
    generatedAt: new Date().toISOString(),
    files: dirtyFiles,
    includedScopes: ['storyboard-guide-polish', 'storyboard-quality-loop', 'omx-evidence'],
    excludedScopes: ['thumbnail-residue-preserve'],
  };
  const summary = {
    runId,
    status: passedCount === cases.length && failureClusters.length === 0 ? 'passed' : 'failed',
    mode: 'fixture-readback',
    caseCount: cases.length,
    passedCount,
    averageScore: Number((totals.reduce((sum, score) => sum + score, 0) / totals.length).toFixed(1)),
    minScore: Math.min(...totals),
    maxScore: Math.max(...totals),
    exactImageProvenance: {
      source: redactCliText(options.seedFile, 240),
      trustedImageCount: trustedImages.filter((image) => image.exists).length,
      model: 'gpt-image-2',
      failClosed: trustedImages.length === 0,
    },
    httpReadback: httpReadbackResult,
    failureClusters,
    scopeManifest,
    artifacts: {
      outputDir: relative(WEB_ROOT, outputDir),
      report: relative(WEB_ROOT, resolve(outputDir, 'report.md')),
      summary: relative(WEB_ROOT, resolve(outputDir, 'score-summary.json')),
      manifest: relative(WEB_ROOT, resolve(outputDir, 'manifest.json')),
    },
  };

  writeFileSync(resolve(outputDir, 'manifest.json'), JSON.stringify({
    runId,
    scenarios: selectedScenarios,
    weights: WEIGHTS,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  writeFileSync(resolve(outputDir, 'scope-manifest.json'), JSON.stringify(scopeManifest, null, 2));
  writeFileSync(resolve(outputDir, 'score-summary.json'), JSON.stringify(summary, null, 2));
  writeMarkdownReport(outputDir, summary, cases);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`Storyboard Quality Loop ${summary.status}: ${passedCount}/${cases.length} cases, average ${summary.averageScore}`);
    console.log(`Report: ${summary.artifacts.report}`);
  }

  if (summary.status !== 'passed') process.exitCode = 1;
}

main().catch((error) => {
  logCliError(error, (line) => process.stderr.write(`[storyboard-quality-loop] ${line}`));
  process.exit(1);
});
