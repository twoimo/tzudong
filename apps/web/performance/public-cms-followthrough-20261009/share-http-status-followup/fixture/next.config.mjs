const fixtureConfig = { distDir: process.env.FIXTURE_NEXT_DIST_DIR ?? '.next-dev', webpack(config) { config.resolve.alias['@']="/Users/twoimo/.codex/worktrees/pipeline-admin-integration-20261007/tzudong/apps/web"; return config; } };

export default fixtureConfig;
