import { isAllowedStoryboardGeminiModel } from './gemini-models';

type CatalogModel = { id: string; owned_by?: 'gemini-api' | 'mlx-serve'; capabilities: string[] };
export function storyboardModelsFor<T extends CatalogModel>(
  workers: { online: boolean; models: T[] }[], capability: 'chat' | 'image',
): T[] {
  const models = new Map<string, T>();
  for (const worker of workers.filter((item) => item.online)) for (const model of worker.models) {
    if (model.owned_by === 'gemini-api' && model.capabilities.includes(capability)
      && isAllowedStoryboardGeminiModel(model.id, capability === 'chat' ? 'text' : 'image')) models.set(model.id, model);
  }
  return [...models.values()];
}
