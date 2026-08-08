import { createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, '..');
const defaultEnvFile = path.join(appRoot, '.env.nightly.local');
const appPort = '8080';
const healthUrl = `http://127.0.0.1:${appPort}/api/health`;
const requiredEnvironment = [
  'NIGHTLY_SUPABASE_PROJECT_REF',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NIGHTLY_ADMIN_EMAIL',
  'NIGHTLY_ADMIN_PASSWORD',
];
const curatedBrowserSpecs = [
  'tests/smoke.spec.ts',
  'tests/navigation.spec.ts',
  'tests/browser-title.spec.ts',
  'tests/mobile-home-map.spec.ts',
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function usage() {
  return [
    'Usage: bun run test:nightly [-- --suite all|unit|e2e] [--env-file .env.nightly.local]',
    'Environment values may also be supplied explicitly in the shell.',
  ].join('\n');
}

function parseArguments(argumentsList) {
  let suite = 'all';
  let envFile;
  let validateOnly = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--validate-only') {
      validateOnly = true;
      continue;
    }
    if (argument === '--suite' || argument === '--env-file') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === '--suite') {
        suite = value;
      } else {
        envFile = value;
      }
      index += 1;
      continue;
    }
    if (argument.startsWith('--suite=')) {
      suite = argument.slice('--suite='.length);
      continue;
    }
    if (argument.startsWith('--env-file=')) {
      envFile = argument.slice('--env-file='.length);
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (!['all', 'unit', 'e2e'].includes(suite)) {
    throw new Error(`Unsupported nightly suite: ${suite}. Use all, unit, or e2e.`);
  }

  return { suite, envFile, validateOnly };
}

function loadNightlyEnvironment(envFileArgument) {
  const envFilePath = envFileArgument
    ? path.resolve(process.cwd(), envFileArgument)
    : defaultEnvFile;

  if (envFileArgument) {
    const fileName = path.basename(envFilePath).toLowerCase();
    if (!fileName.includes('nightly') || !fileName.endsWith('.local')) {
      throw new Error('Nightly env files must be dedicated files with a nightly name and .local suffix.');
    }
    if (!existsSync(envFilePath)) {
      throw new Error(`Nightly env file was not found: ${envFilePath}`);
    }
  }

  if (existsSync(envFilePath)) {
    const result = loadEnv({ path: envFilePath, override: false });
    if (result.error) {
      throw new Error(`Unable to load the nightly env file: ${envFilePath}`);
    }
  }
}

function validateNightlyEnvironment(environment = process.env) {
  const missing = requiredEnvironment.filter((name) => !environment[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required nightly environment variable(s): ${missing.join(', ')}`);
  }

  const projectRef = environment.NIGHTLY_SUPABASE_PROJECT_REF.trim();
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL.trim();
  if (!supabaseUrl.includes(projectRef)) {
    throw new Error('Nightly Supabase URL does not identify the configured isolated project.');
  }

  const adminEmail = environment.NIGHTLY_ADMIN_EMAIL.trim();
  if (!adminEmail.includes('nightly')) {
    throw new Error('Nightly admin identity must be a dedicated non-production account.');
  }

  return {
    ...environment,
    NIGHTLY_SUPABASE_PROJECT_REF: projectRef,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim(),
    NIGHTLY_ADMIN_EMAIL: adminEmail,
    NIGHTLY_ADMIN_PASSWORD: environment.NIGHTLY_ADMIN_PASSWORD.trim(),
  };
}

function runCommand(command, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd: options.cwd ?? appRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      shell: false,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolve({ code: typeof code === 'number' ? code : 1, signal });
    });
  });
}

async function waitForHealth(appProcess) {
  const deadline = Date.now() + 120_000;
  let spawnError;
  appProcess.once('error', (error) => {
    spawnError = error;
  });

  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Unable to start the nightly app: ${spawnError.message}`);
    }
    if (appProcess.exitCode !== null) {
      throw new Error('Nightly application exited before the health endpoint became ready.');
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // The dev server may still be compiling; retry until the bounded deadline.
    }
    await sleep(2_000);
  }

  throw new Error('Application did not become ready. See nightly-web.log for local diagnostics.');
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && Date.now() < deadline) {
    await sleep(100);
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function runUnitRegression(environment) {
  const result = await runCommand('bun', ['run', 'test:unit'], { env: environment });
  if (result.code !== 0) {
    throw new Error(`Nightly unit regressions failed with exit code ${result.code}.`);
  }
}

async function runBrowserRegression(environment) {
  const logPath = path.join(appRoot, 'nightly-web.log');
  const logStream = createWriteStream(logPath, { flags: 'w' });
  const appEnvironment = {
    ...environment,
    APP_PORT: appPort,
    NIGHTLY_LOCAL_ENV_ONLY: '1',
    NODE_ENV: 'test',
  };
  const appProcess = spawn('bun', ['run', 'dev:playwright'], {
    cwd: appRoot,
    env: appEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  });
  appProcess.stdout?.pipe(logStream);
  appProcess.stderr?.pipe(logStream);

  try {
    await waitForHealth(appProcess);
    const browserEnvironment = {
      ...appEnvironment,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${appPort}`,
      NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NIGHTLY_ADMIN_EMAIL: environment.NIGHTLY_ADMIN_EMAIL,
      NIGHTLY_ADMIN_PASSWORD: environment.NIGHTLY_ADMIN_PASSWORD,
      PLAYWRIGHT_REUSE_EXISTING_SERVER: '1',
    };
    const result = await runCommand(
      'bunx',
      [
        'playwright',
        'test',
        ...curatedBrowserSpecs,
        '--project=chromium',
        '--reporter=line,html',
      ],
      { env: browserEnvironment },
    );
    if (result.code !== 0) {
      throw new Error(`Nightly browser regressions failed with exit code ${result.code}.`);
    }
  } finally {
    await stopProcess(appProcess);
    logStream.end();
  }
}

async function main() {
  const { suite, envFile, validateOnly } = parseArguments(process.argv.slice(2));
  loadNightlyEnvironment(envFile);
  const environment = validateNightlyEnvironment();

  if (validateOnly) {
    console.log('Nightly environment validation passed.');
    return;
  }

  if (suite === 'all' || suite === 'unit') {
    await runUnitRegression(environment);
  }
  if (suite === 'all' || suite === 'e2e') {
    await runBrowserRegression(environment);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Nightly regression failed.';
  console.error(`[nightly] ${message}`);
  process.exitCode = 1;
});
