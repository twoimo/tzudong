/** Explicit, local-model-only smoke. Never part of ordinary CI. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { MlxTransport, type MlxDestinationReceipt } from '../lib/admin/storyboard/mlx-transport.ts';
import { MlxStoryboardClient } from '../lib/admin/storyboard/mlx-client.ts';
import { prepareStoryboardAsset } from '../lib/admin/storyboard/production-assets.ts';
import { STORYBOARD_WORKFLOW, storyboardProductionRequestSchema, storyboardProductionErrorCode } from '../lib/admin/storyboard/production-contract.ts';

if (!process.argv.includes('--run-local-models') || process.env.CI) {
  console.error('Pass --run-local-models outside CI to use installed local models.'); process.exit(2);
}
const output = path.resolve('.omx/artifacts/storyboard-mlx', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true, mode: 0o700 });
const destinations: MlxDestinationReceipt[] = [];
const client = new MlxStoryboardClient(new MlxTransport({ timeoutMs: 300_000, onDestination: (receipt) => destinations.push(receipt) }));
const memory = () => ({ at: new Date().toISOString(), swap: execFileSync('/usr/sbin/sysctl', ['vm.swapusage'], { encoding: 'utf8' }).trim(), vm: execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8' }).trim() });
const measurements: unknown[] = [memory()];
const projectId = randomUUID();
try {
  const models = await client.models();
  const text = models.find((model) => model.loaded && model.capabilities.includes('chat'));
  const image = models.find((model) => model.id === 'ddalcu/Krea-2-Turbo-MLX-Serve-mixed-4-8');
  if (!text || !image) throw new Error('installed_smoke_models_missing');
  const request = storyboardProductionRequestSchema.parse({
    workflow: STORYBOARD_WORKFLOW, requestId: randomUUID(), sceneCount: 5,
    prompt: '가상의 한국 음식 채널 첫 소개 영상을 제작합니다. 아침 시장의 식재료, 채소 손질, 국물 끓이기, 정갈한 한 상, 빈 식탁의 여운을 다섯 장면으로 구성하세요. 실제 상호, 인물, 영상이나 근거 수치를 만들지 마세요. 각 장면은 짧고 구체적으로 작성하세요.',
    providers: { externalAI: false, text: { id: 'local-mlx', model: text.id }, image: { id: 'local-mlx', model: image.id } },
  });
  const start = performance.now();
  const generated = await client.draft(request);
  measurements.push({ stage: 'text', elapsedMs: Math.round(performance.now() - start), ...memory() });
  await writeFile(path.join(output, 'draft.json'), JSON.stringify(generated, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ stage: 'text', scenes: generated.draft.scenes.length, output }));
  const assets = [];
  for (const scene of generated.draft.scenes) {
    const imageStart = performance.now();
    const generatedImage = await client.image(request, scene.imagePrompt);
    const prepared = await prepareStoryboardAsset(generatedImage.bytes, projectId, generatedImage.provenance);
    for (const file of prepared.files) {
      const destination = path.join(output, file.path);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, file.bytes, { mode: 0o600 });
    }
    assets.push({ sceneNo: scene.sceneNo, asset: prepared.asset });
    measurements.push({ stage: 'image', sceneNo: scene.sceneNo, elapsedMs: Math.round(performance.now() - imageStart), ...memory() });
    await writeFile(path.join(output, 'assets.json'), JSON.stringify(assets, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ stage: 'image', sceneNo: scene.sceneNo, bytes: generatedImage.bytes.length }));
  }
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'provider-smoke-only', projectId, externalAI: false, destinations, measurements, modelsBefore: models, modelsAfter: await client.models() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'provider-smoke-only', output, scenes: assets.length }));
} catch (error) {
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify({ status: 'failed', code: storyboardProductionErrorCode(error), destinations, measurements }, null, 2), { mode: 0o600 });
  console.error(JSON.stringify({ status: 'failed', code: storyboardProductionErrorCode(error), output })); process.exitCode = 1;
}
