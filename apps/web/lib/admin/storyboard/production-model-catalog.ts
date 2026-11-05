import { isAllowedStoryboardGeminiModel, isAllowedStoryboardGeminiWorkerModel } from './gemini-models';

type CatalogModel = { id: string; owned_by?: 'gemini-api' | 'mlx-serve'; capabilities: string[];
  loaded: boolean; bytes_on_disk: number; bytes_resident: number };
export function storyboardModelsFor<T extends CatalogModel>(
  workers: { online: boolean; models: T[] }[], capability: 'chat' | 'image',
): T[] {
  const models = new Map<string, T>();
  for (const worker of workers.filter((item) => item.online)) for (const model of worker.models) {
    if (isAllowedStoryboardGeminiWorkerModel(model) && model.capabilities.includes(capability)
      && isAllowedStoryboardGeminiModel(model.id, capability === 'chat' ? 'text' : 'image')) models.set(model.id, model);
  }
  return [...models.values()];
}

/** Creation is executable only when one fresh worker advertises the exact pair. */
export function storyboardWorkerSupportsPair<T extends CatalogModel>(
  workers: { online: boolean; models: T[] }[], textModel: string, imageModel: string,
): boolean {
  return workers.some((worker) => worker.online
    && worker.models.some((model) => isAllowedStoryboardGeminiWorkerModel(model)
      && model.id === textModel && model.capabilities[0] === 'chat')
    && worker.models.some((model) => isAllowedStoryboardGeminiWorkerModel(model)
      && model.id === imageModel && model.capabilities[0] === 'image'));
}
