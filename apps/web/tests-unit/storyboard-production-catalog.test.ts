import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { StoryboardProductionStore } from '../lib/admin/storyboard/production-store';
import { storyboardModelsFor } from '../lib/admin/storyboard/production-model-catalog';
import { STORYBOARD_GEMINI_TEXT_MODEL, STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } from '../lib/admin/storyboard/gemini-models';
const model = (id: string, capability: string, owner?: string) => ({ id, capabilities: [capability], owned_by: owner,
  loaded: false, bytes_on_disk: 0, bytes_resident: 0 });
function store(models: unknown[], online = true) {
  return new StoryboardProductionStore({ database: { async rpc() { return { data: { ok: true, projects: [], workers: [{ id: randomUUID(), online,
    lastHeartbeat: null, models }] }, error: null }; }, async asset() { throw new Error('unexpected'); } } });
}
describe('store list to workspace provider selection', () => {
  test('validated Gemini ownership survives serialization for both selected capabilities', async () => {
    const models = [model(STORYBOARD_GEMINI_TEXT_MODEL, 'chat', 'gemini-api'), model(STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL, 'image', 'gemini-api')];
    const catalog = await store(models).list(randomUUID());
    expect(storyboardModelsFor(catalog.workers, 'chat').map((entry) => entry.id)).toEqual([STORYBOARD_GEMINI_TEXT_MODEL]);
    expect(storyboardModelsFor(catalog.workers, 'image').map((entry) => entry.id)).toEqual([STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL]);
  });
  test('missing, MLX ownership, offline, unapproved model or wrong capability cannot enable selection', async () => {
    for (const entry of [model(STORYBOARD_GEMINI_TEXT_MODEL, 'chat'), model(STORYBOARD_GEMINI_TEXT_MODEL, 'chat', 'mlx-serve'),
      model('unapproved-model', 'chat', 'gemini-api'), model(STORYBOARD_GEMINI_TEXT_MODEL, 'image', 'gemini-api')]) {
      expect(storyboardModelsFor((await store([entry]).list(randomUUID())).workers, 'chat')).toEqual([]);
    }
    expect(storyboardModelsFor((await store([model(STORYBOARD_GEMINI_TEXT_MODEL, 'chat', 'gemini-api')], false).list(randomUUID())).workers, 'chat')).toEqual([]);
    await expect(store([model(STORYBOARD_GEMINI_TEXT_MODEL, 'chat', 'forged-owner')]).list(randomUUID())).rejects.toThrow();
  });
});
