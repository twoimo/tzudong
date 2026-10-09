/** Test-only fixture output preparation. Uses the production sandbox runner and parser,
 * never the retired production generation entrypoint or an automatic provider CLI. */
import path from 'node:path';
import { __runStoryboardAgentCommandForTests, normalizeStoryboardBackendAgentOutput } from '../../lib/admin/storyboard/backend-agent';
import { createBoundStoryboardAgentTestCommandCapability } from '../../lib/admin/storyboard/test-command-capability';
import { generateLocalStoryboard } from '../../lib/admin/storyboard/generator';
import type { StoryboardGenerateRequest, StoryboardBackendAgentStatus } from '../../lib/admin/storyboard/types';

export async function normalizeFixtureCommand(input?: Partial<StoryboardGenerateRequest> | null,
  options: { env?: NodeJS.ProcessEnv; testCommandCapability?: unknown } = {}) {
  const env = options.env ?? process.env;
  const commandPath = env.STORYBOARD_AGENT_COMMAND?.trim();
  if (!commandPath || /[;&|`$<>]/.test(commandPath)) throw new Error('STORYBOARD_WORKFLOW_RETIRED');
  const command = commandPath.endsWith('.py')
    ? { executable: env.STORYBOARD_AGENT_PYTHON ?? 'python3', args: [commandPath], source: 'configured' as const }
    : { executable: commandPath, args: [] as string[], source: 'configured' as const };
  const root = path.resolve(import.meta.dir, '../../../../backend/storyboard-agent');
  const status: StoryboardBackendAgentStatus = {
    available: true, mode: 'command', rootPath: root, notebooks: [], graphEntrypoint: path.join(root, 'src/graph.py'),
    commandConfigured: true, commandAvailable: true, commandSource: 'configured', commandPath: command.executable,
    localAdapterAvailable: false, missingPythonModules: [], runtime: ['codex_cli_oauth_legacy','codex_cli_oauth'].includes(env.STORYBOARD_AGENT_RUNTIME ?? '') ? 'codex_cli_oauth_legacy' : 'langgraph',
    codexModel: env.STORYBOARD_AGENT_CODEX_MODEL ?? 'gpt-5.5', codexEffort: env.STORYBOARD_AGENT_CODEX_EFFORT ?? 'low',
  };
  const base = generateLocalStoryboard(input);
  const capability = createBoundStoryboardAgentTestCommandCapability({ executable: path.resolve(command.executable), args: command.args, fixture: 'checked-in-data-fixture-only' });
  const result = await __runStoryboardAgentCommandForTests(command, { request: base.request, localStoryboard: base, backendAgentRoot: root, graphEntrypoint: status.graphEntrypoint }, undefined, { env, testCommandCapability: capability });
  return normalizeStoryboardBackendAgentOutput(input, result, status);
}

export * from "../../lib/admin/storyboard/backend-agent";
