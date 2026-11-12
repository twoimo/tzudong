#!/usr/bin/env node

// Keep the former entrypoint so old local commands stop with useful guidance.
// Do not add command execution here: release promotion belongs to protected PRs.
const guidance = [
  'LEGACY_RELEASE_SYNC_RETIRED',
  'This helper no longer performs Git, GitHub, or deployment operations.',
  'Use reviewed protected PRs in order: feature -> develop -> data -> main.',
  'Verify the exact head SHA and required checks before each normal merge.',
  'Do not use administrator bypass or force pushes.',
  'See docs/agents/release.md and docs/operations/staged-production-transition.md.',
].join('\n') + '\n';

const args = process.argv.slice(2);
const helpOnly = args.length === 1 && ['--help', '-h'].includes(args[0]);
if (helpOnly) {
  process.stdout.write(guidance);
} else {
  process.stderr.write(guidance);
  process.exitCode = 1;
}
