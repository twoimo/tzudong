#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

const DEFAULT_TARGETS = ['main', 'develop', 'data'];

function printUsage() {
  console.log(`Usage: node scripts/${basename(process.argv[1])} --title <title> [options]

Automates the protected-branch sync flow used after a verified commit:
  1. Push current HEAD to one temporary branch per target.
  2. Create PRs into main/develop/data.
  3. Merge the PRs with --admin and delete temporary branches.
  4. Fetch targets and verify all target tree hashes are identical.

Options:
  --title <text>          PR title. Required unless --dry-run is used.
  --body <text>           PR body. Defaults to an automated sync note.
  --targets <csv>         Target branches. Default: main,develop,data.
  --prefix <text>         Temporary branch prefix. Default: sync/release.
  --remote <name>         Git remote. Default: origin.
  --dry-run               Print commands without executing mutating steps.
  --skip-merge            Create PRs but do not merge them.
  --allow-dirty           Do not fail when the worktree has uncommitted changes.
  --help                  Show this help.

Example:
  node scripts/sync-release-branches.mjs --title "Improve mobile map sheet" --body "Verified: bun test, eslint, build"
`);
}

function parseArgs(argv) {
  const options = {
    body: '',
    dryRun: false,
    skipMerge: false,
    allowDirty: false,
    prefix: 'sync/release',
    remote: 'origin',
    targets: DEFAULT_TARGETS,
    title: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--skip-merge':
        options.skipMerge = true;
        break;
      case '--allow-dirty':
        options.allowDirty = true;
        break;
      case '--title':
        options.title = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--body':
        options.body = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--targets':
        options.targets = requireValue(argv, index, arg)
          .split(',')
          .map((target) => target.trim())
          .filter(Boolean);
        index += 1;
        break;
      case '--prefix':
        options.prefix = requireValue(argv, index, arg).replace(/\/+$/u, '');
        index += 1;
        break;
      case '--remote':
        options.remote = requireValue(argv, index, arg);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function run(command, args, { dryRun = false, allowFailure = false } = {}) {
  const display = [command, ...args].map(shellQuote).join(' ');
  if (dryRun) {
    console.log(`[dry-run] ${display}`);
    return { stdout: '', stderr: '', status: 0 };
  }

  console.log(`$ ${display}`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`Command failed (${result.status}): ${display}`);
  }

  return result;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return JSON.stringify(value);
}

function output(command, args) {
  const result = run(command, args);
  return result.stdout.trim();
}

function ensureCleanWorktree({ allowDirty }) {
  const porcelain = output('git', ['status', '--porcelain']);
  if (porcelain && !allowDirty) {
    throw new Error('Worktree has uncommitted changes. Commit first or pass --allow-dirty.');
  }
}

function ensureTargets(targets) {
  if (targets.length === 0) throw new Error('At least one target branch is required.');
  const invalid = targets.find((target) => !/^[A-Za-z0-9._/-]+$/u.test(target));
  if (invalid) throw new Error(`Invalid target branch name: ${invalid}`);
}

function safeBranchSegment(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
}

function createPr({ base, body, dryRun, headBranch, title }) {
  const result = run(
    'gh',
    ['pr', 'create', '--base', base, '--head', headBranch, '--title', title, '--body', body],
    { dryRun },
  );

  const stdout = result.stdout.trim();
  if (dryRun) return `dry-run:${base}`;
  const url = stdout.split(/\s+/u).find((token) => /^https:\/\/github\.com\//u.test(token));
  if (!url) throw new Error(`Could not parse PR URL for ${base} from gh output: ${stdout}`);
  return url;
}

function mergePr({ dryRun, prRef }) {
  run('gh', ['pr', 'merge', prRef, '--merge', '--delete-branch', '--admin'], { dryRun });
}

function verifyTreeEquality({ dryRun, remote, targets }) {
  run('git', ['fetch', remote, ...targets], { dryRun });
  if (dryRun) return;

  const rows = targets.map((target) => {
    const tree = output('git', ['rev-parse', `${remote}/${target}^{tree}`]);
    return { target, tree };
  });
  const uniqueTrees = new Set(rows.map((row) => row.tree));

  for (const row of rows) {
    console.log(`${row.target}: ${row.tree}`);
  }

  if (uniqueTrees.size !== 1) {
    throw new Error('Target branches do not have identical trees after sync.');
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  ensureTargets(options.targets);

  if (!options.title && !options.dryRun) {
    throw new Error('--title is required.');
  }

  const head = output('git', ['rev-parse', 'HEAD']);
  const shortHead = head.slice(0, 12);
  const body = options.body || `Automated branch sync for ${shortHead}.\n\nVerification was completed before running this sync helper.`;
  const title = options.title || `Sync branches at ${shortHead}`;
  const prefix = `${options.prefix}/${shortHead}`;

  ensureCleanWorktree({ allowDirty: options.allowDirty });

  run('gh', ['auth', 'status'], { dryRun: options.dryRun });
  run('git', ['fetch', options.remote, ...options.targets], { dryRun: options.dryRun });

  for (const base of options.targets) {
    const headBranch = `${prefix}/${safeBranchSegment(base)}`;
    run('git', ['push', options.remote, `HEAD:refs/heads/${headBranch}`, '--force-with-lease'], {
      dryRun: options.dryRun,
    });
    const prRef = createPr({
      base,
      body,
      dryRun: options.dryRun,
      headBranch,
      title,
    });
    console.log(`PR for ${base}: ${prRef}`);
    if (!options.skipMerge) {
      mergePr({ dryRun: options.dryRun, prRef });
    }
  }

  if (!options.skipMerge) {
    verifyTreeEquality({ dryRun: options.dryRun, remote: options.remote, targets: options.targets });
    if (options.dryRun) {
      console.log(`Dry run complete; would sync ${options.targets.join(', ')} from HEAD ${shortHead}.`);
    } else {
      console.log(`Synced ${options.targets.join(', ')} to identical trees at ${shortHead}.`);
    }
  } else {
    console.log('Created PRs only; merge and tree verification were skipped.');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
