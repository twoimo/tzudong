import type { ThumbnailBriefPreset, ThumbnailGeneratorPayload, ThumbnailReferenceImage } from './types';
import { validateThumbnailSafety } from './safety';

const BRIEF_PRESET_PROMPTS: Record<ThumbnailBriefPreset, string> = {
  'tzuyang-food-travel-collage':
    'Tzudong-style food travel collage: high-energy host/reaction zones, oversized glossy food foreground, dense local food-place background, large editable Korean title safe area.',
  'night-market-reaction':
    'Night market reaction: warm lantern/food-stall lighting, crowded but non-identifying background silhouettes, dramatic host/reaction cutouts, street food plates filling the lower frame.',
  'convenience-store-haul':
    'Convenience-store haul: bright fluorescent store lighting, many generic snack/meal packages with fictional labels only, instant noodles and desserts stacked across the lower frame.',
  'grilled-meat-feast':
    'Grilled-meat feast: huge glossy skewers and roasted meat across the foreground, warm restaurant lighting, visible sauce/char textures, reaction faces separated from food piles.',
  'sushi-seafood-table':
    'Sushi/seafood table: bright casual restaurant, many white plates with glossy seafood pieces, low table-angle perspective, host holding a large bite near the lens.',
};

export function buildYoutubeThumbnailPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[] = [],
) {
  validateThumbnailSafety(payload);
  const stylePreset = payload.stylePreset ?? 'tzuyang-food-travel-collage';

  const roleSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} reference (${image.mime})`).join('\n')
    : 'No user image references were provided; create a generic non-identifying collage base.';

  return [
    'Create a 16:9 YouTube thumbnail base image for Korean food travel / mukbang content.',
    `Content topic: ${payload.topic}`,
    `Style preset: ${stylePreset} — ${BRIEF_PRESET_PROMPTS[stylePreset]}`,
    `Editable headline placeholder to reserve space for later canvas text: ${payload.headline}`,
    payload.subHeadline ? `Secondary editable caption placeholder: ${payload.subHeadline}` : null,
    '',
    'Style grammar: high-saturation photo-collage composition, bright social thumbnail contrast, oversized foreground food, host/reaction cutout zones, warm market/restaurant/convenience-store lighting, dense but readable layout, clear center/side title safe areas, bold editable Korean title placeholders.',
    'Composition requirements: bottom 35-55% dominated by vivid food closeups, one main host/reaction zone, optional small reaction stickers, busy contextual background without readable real signage.',
    'Safety constraints: Do not render real names, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, or identifiable background crowd faces. Text should be placeholder-safe because final typography will be edited separately in the app.',
    '',
    'User image references:',
    roleSummary,
    '',
    'Output only the base image; do not bake in final Korean typography because a separate editor will render fonts, stroke, shadow, and position.',
  ]
    .filter(Boolean)
    .join('\n');
}
