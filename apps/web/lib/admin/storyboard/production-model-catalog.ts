import { isAllowedStoryboardGeminiModel, isAllowedStoryboardGeminiWorkerModel } from './gemini-models';
import { isAllowedStoryboardOpenAIModel, isAllowedStoryboardOpenAIWorkerModel } from './openai-models';
export type StoryboardProviderId = 'gemini-api' | 'openai-api';
type CatalogModel = { id: string; owned_by?: StoryboardProviderId | 'mlx-serve'; capabilities: string[]; loaded: boolean; bytes_on_disk: number; bytes_resident: number };
function allowed(model: CatalogModel): boolean { return isAllowedStoryboardGeminiWorkerModel(model) || isAllowedStoryboardOpenAIWorkerModel(model); }
function allowedProviderModel(model: CatalogModel, provider: StoryboardProviderId, modality: 'text' | 'image'): boolean {
  return model.owned_by === provider && (provider === 'gemini-api' ? isAllowedStoryboardGeminiModel(model.id, modality) : isAllowedStoryboardOpenAIModel(model.id, modality));
}
export function storyboardModelsFor<T extends CatalogModel>(workers: { online: boolean; models: T[] }[], capability: 'chat' | 'image', provider: StoryboardProviderId = 'gemini-api'): T[] {
  const modality = capability === 'chat' ? 'text' : 'image'; const models = new Map<string, T>();
  for (const worker of workers.filter((item) => item.online)) for (const model of worker.models) {
    if (allowed(model) && model.capabilities.includes(capability) && allowedProviderModel(model, provider, modality)) models.set(model.id, model);
  }
  return [...models.values()];
}
export function storyboardWorkerSupportsPair<T extends CatalogModel>(workers: { online: boolean; models: T[] }[], textModel: string, imageModel: string, textProvider: StoryboardProviderId = 'gemini-api', imageProvider: StoryboardProviderId = 'gemini-api'): boolean {
  return workers.some((worker) => worker.online
    && worker.models.some((model) => allowed(model) && model.owned_by === textProvider && model.id === textModel && model.capabilities.includes('chat') && allowedProviderModel(model, textProvider, 'text'))
    && worker.models.some((model) => allowed(model) && model.owned_by === imageProvider && model.id === imageModel && model.capabilities.includes('image') && allowedProviderModel(model, imageProvider, 'image')));
}
