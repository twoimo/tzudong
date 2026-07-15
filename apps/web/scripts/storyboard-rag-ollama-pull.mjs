#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { logCliError, safeCliErrorName } from './privacy-safe-cli-log.mjs';

const MANUAL_GATE_ENV = 'STORYBOARD_RAG_PULL_OLLAMA_MODELS';
const DEFAULT_OUTPUT = '.omx/artifacts/storyboard-rag-ollama-pull/latest.json';

const OLLAMA_MODELS = [
  {
    id: 'a.x-4.0-light-imatrix:Q8_0',
    role: 'contextual_retrieval',
    source: 'screenshot_model_stack',
    pullId: 'cookieshake/a.x-4.0-light-imatrix:Q8_0',
  },
  {
    id: 'exaone3.5:7.8b',
    role: 'llm_judge',
    source: 'screenshot_model_stack',
  },
  {
    id: 'EEVE-Korean-Instruct-10.8B',
    role: 'llm_judge',
    source: 'screenshot_model_stack',
    pullId: 'bnksys/eeve:10.8b-korean-instruct-q8-v1',
  },
  {
    id: 'qwen3:8b',
    role: 'llm_judge',
    source: 'screenshot_model_stack',
  },
  {
    id: 'solar:10.7b-instruct-v1-q5_0',
    role: 'llm_judge',
    source: 'screenshot_model_stack',
  },
];

const NON_OLLAMA_MODELS = [
  {
    id: 'BAAI/bge-m3',
    role: 'dense_sparse_embedding',
    provider: 'huggingface_or_flag_embedding',
    manualGateEnv: 'STORYBOARD_AGENT_ENABLE_BGE_RETRIEVAL',
  },
  {
    id: 'BAAI/bge-reranker-v2-m3',
    role: 'reranker',
    provider: 'huggingface_or_flag_embedding',
    manualGateEnv: 'STORYBOARD_AGENT_ENABLE_BGE_RETRIEVAL',
  },
  {
    id: 'LLaVA-NeXT-Video-7B-hf',
    role: 'video_captioning',
    provider: 'huggingface',
    manualGateEnv: 'STORYBOARD_AGENT_ENABLE_VIDEO_CAPTIONING',
  },
  {
    id: 'gemini-cli',
    role: 'llm_judge',
    provider: 'gemini_cli',
    manualGateEnv: 'STORYBOARD_AGENT_ENABLE_REAL_JUDGE',
  },
  {
    id: 'openai-api',
    role: 'llm_judge',
    provider: 'openai_api',
    manualGateEnv: 'STORYBOARD_AGENT_ENABLE_REAL_JUDGE',
  },
];

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}


function createOllamaListCollector() {
  const names = new Set();
  let firstLine = true;
  let remainder = '';

  const consumeLine = (line) => {
    if (firstLine) {
      firstLine = false;
      return;
    }
    const name = line.trim().split(/\s+/)[0];
    if (name) names.add(name);
  };

  return {
    write(chunk) {
      const lines = `${remainder}${chunk}`.split(/\r?\n/);
      remainder = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    },
    names() {
      if (remainder) consumeLine(remainder);
      remainder = '';
      return names;
    },
  };
}

function runProcess(command, args, { timeoutMs = 30_000, onStdout } = {}) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      onStdout?.(chunk.toString('utf8'));
    });
    child.stderr.on('data', () => {});
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        timedOut,
        startedAt,
        completedAt: new Date().toISOString(),
        errorName: safeCliErrorName(error),
        errorCode: 'ollama_process_error',
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        timedOut,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    });
  });
}

function selectedOllamaModels(names) {
  return OLLAMA_MODELS
    .filter((model) => names.has(model.id) || (model.pullId && names.has(model.pullId)))
    .map((model) => model.id)
    .sort();
}

async function main() {
  const allow = hasArg('--yes') || process.env[MANUAL_GATE_ENV] === '1';
  const strict = hasArg('--strict');
  const dryRun = hasArg('--dry-run');
  const pullTimeoutMs = Number(argValue('--pull-timeout-ms', '900000')) || 900_000;
  const outputPath = argValue('--output', DEFAULT_OUTPUT);
  const startedAt = new Date().toISOString();

  const result = {
    schemaVersion: 1,
    kind: 'storyboard-rag-ollama-pull',
    manualGateEnv: MANUAL_GATE_ENV,
    manualGateSatisfied: allow,
    dryRun,
    strict,
    startedAt,
    completedAt: null,
    normalCiSafe: true,
    normalCiRequiresCredentials: false,
    normalCiUsesNetwork: false,
    ollamaModels: OLLAMA_MODELS,
    nonOllamaModels: NON_OLLAMA_MODELS.map((model) => ({
      ...model,
      status: 'manual_gate_external_provider',
      note: 'Not pulled by Ollama. Kept behind its own manual provider gate and never required by normal CI.',
    })),
    ollamaAvailable: false,
    beforeList: [],
    afterList: [],
    pulls: [],
    summary: {
      attempted: 0,
      alreadyPresent: 0,
      pulled: 0,
      failed: 0,
      skipped: 0,
    },
  };

  if (!allow) {
    result.completedAt = new Date().toISOString();
    result.summary.skipped = OLLAMA_MODELS.length;
    result.reason = `manual gate required: set ${MANUAL_GATE_ENV}=1 or pass --yes`;
    writeResult(outputPath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(strict ? 2 : 0);
  }

  if (dryRun) {
    result.ollamaAvailable = 'not_checked_dry_run';
    result.summary.skipped = OLLAMA_MODELS.length;
    result.pulls = OLLAMA_MODELS.map((model) => ({
      ...model,
      status: 'dry_run_skipped',
      exitCode: 0,
    }));
    for (const model of OLLAMA_MODELS) {
      console.log(`PULL_DRY_RUN ${model.id}`);
    }
    result.completedAt = new Date().toISOString();
    writeResult(outputPath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const version = await runProcess('ollama', ['--version'], { timeoutMs: 30_000 });
  result.ollamaAvailable = version.exitCode === 0;
  result.ollamaVersion = version.exitCode === 0 ? 'ollama_available' : null;
  if (!result.ollamaAvailable) {
    result.completedAt = new Date().toISOString();
    result.summary.failed = OLLAMA_MODELS.length;
    result.error = 'ollama_unavailable';
    result.installHint = 'Install Ollama locally, then rerun with STORYBOARD_RAG_PULL_OLLAMA_MODELS=1.';
    result.versionCheck = {
      operationCode: 'ollama_version_check',
      ...version,
    };
    writeResult(outputPath, result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(strict ? 1 : 0);
  }

  const beforeCollector = createOllamaListCollector();
  await runProcess('ollama', ['list'], { timeoutMs: 30_000, onStdout: beforeCollector.write });
  const beforeNames = beforeCollector.names();
  result.beforeList = selectedOllamaModels(beforeNames);

  for (const model of OLLAMA_MODELS) {
    const pullId = model.pullId || model.id;
    if (beforeNames.has(model.id) || beforeNames.has(pullId)) {
      result.summary.alreadyPresent += 1;
      result.pulls.push({ ...model, pullId, status: 'already_present', exitCode: 0 });
      console.log(`PULL_SKIP already_present ${model.id} via ${pullId}`);
      continue;
    }
    result.summary.attempted += 1;
    console.log(`PULL_START ${model.id} via ${pullId}`);
    if (dryRun) {
      result.summary.skipped += 1;
      result.pulls.push({ ...model, status: 'dry_run_skipped', exitCode: 0 });
      console.log(`PULL_DRY_RUN ${model.id}`);
      continue;
    }
    const pull = await runProcess('ollama', ['pull', pullId], {
      timeoutMs: pullTimeoutMs,
    });
    if (pull.exitCode === 0) {
      result.summary.pulled += 1;
      result.pulls.push({
        ...model,
        pullId,
        status: 'pulled',
        exitCode: pull.exitCode,
        timedOut: pull.timedOut,
      });
      console.log(`\nPULL_DONE ${model.id}`);
    } else {
      result.summary.failed += 1;
      result.pulls.push({
        ...model,
        pullId,
        status: pull.timedOut ? 'timeout' : 'failed',
        exitCode: pull.exitCode,
        timedOut: pull.timedOut,
        operationCode: 'ollama_pull',
        errorCode: pull.timedOut ? 'ollama_pull_timeout' : 'ollama_pull_failed',
        ...(pull.errorName ? { errorName: pull.errorName } : {}),
      });
      console.log(`\nPULL_FAILED ${model.id} via ${pullId} exit=${pull.exitCode ?? 'null'}`);
    }
  }

  const afterCollector = createOllamaListCollector();
  await runProcess('ollama', ['list'], { timeoutMs: 30_000, onStdout: afterCollector.write });
  result.afterList = selectedOllamaModels(afterCollector.names());
  result.completedAt = new Date().toISOString();
  writeResult(outputPath, result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(strict && result.summary.failed > 0 ? 1 : 0);
}

function writeResult(outputPath, result) {
  const resolved = path.resolve(process.cwd(), outputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  const failed = {
    schemaVersion: 1,
    kind: 'storyboard-rag-ollama-pull',
    status: 'script_error',
    operationCode: 'storyboard_rag_ollama_pull',
    errorName: safeCliErrorName(error),
    errorCode: 'storyboard_rag_ollama_pull_failed',
    completedAt: new Date().toISOString(),
  };
  const outputPath = argValue('--output', DEFAULT_OUTPUT);
  writeResult(outputPath, failed);
  logCliError({ name: failed.errorName, code: failed.errorCode }, (line) => process.stderr.write(`[storyboard-rag-ollama-pull] ${line}`));
  console.log(JSON.stringify(failed, null, 2));
  process.exit(1);
});
