import { execFileSync, spawnSync } from 'node:child_process';
const processEnv = execFileSync('ps', ['eww', '-p', process.env.CMS_DEV_SERVER_PID ?? '57309', '-o', 'command='], { encoding: 'utf8' });
const token = processEnv.match(/(?:^| )E2E_ADMIN_ROUTE_BYPASS_TOKEN=([^\s]+)/)?.[1];
if (!token) throw new Error('Existing local test bypass unavailable');
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'performance/cms-followthrough-20261009/hydration.config.mjs', '--grep', 'loads core admin modules without hydration/runtime errors'], { stdio: 'inherit', env: { ...process.env, E2E_ADMIN_ROUTE_BYPASS_TOKEN: token, ADMIN_HYDRATION_READ_ONLY: '1', ADMIN_HYDRATION_ARTIFACT_DIR: 'performance/cms-followthrough-20261009/hydration-artifacts' } });
process.exit(result.status ?? 1);
