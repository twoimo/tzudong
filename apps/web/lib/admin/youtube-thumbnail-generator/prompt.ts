import type { ThumbnailBriefPreset, ThumbnailGeneratorPayload, ThumbnailReferenceImage } from './types';
import { validateThumbnailSafety } from './safety';

const BRIEF_PRESET_PROMPTS: Record<ThumbnailBriefPreset, string> = {
  'tzuyang-food-travel-collage':
    'Tzudong-style food travel collage: high-energy visible host/reaction cutout zone, oversized glossy food foreground, dense local food-place background, large editable Korean title safe area.',
  'night-market-reaction':
    'Night market reaction: warm lantern/food-stall lighting, crowded but non-identifying background silhouettes, one clearly visible host/reaction cutout, street food plates filling the lower frame.',
  'convenience-store-haul':
    'Convenience-store haul: bright fluorescent store lighting, many generic snack/meal packages with fictional labels only, instant noodles and desserts stacked across the lower frame.',
  'grilled-meat-feast':
    'Grilled-meat feast: huge glossy skewers and roasted meat across the foreground, warm restaurant lighting, visible sauce/char textures, reaction faces separated from food piles.',
  'sushi-seafood-table':
    'Sushi/seafood table: bright casual restaurant, many white plates with glossy seafood pieces, low table-angle perspective, host holding a large bite near the lens.',
};

const TZUYANG_TOPIC_PATTERN = /(쯔양|tzuyang)/i;
const PERSON_REFERENCE_ROLES = new Set<ThumbnailReferenceImage['role']>(['host', 'person']);

function allowsSpecificCreatorHost(payload: ThumbnailGeneratorPayload, referenceImages: ThumbnailReferenceImage[]) {
  return TZUYANG_TOPIC_PATTERN.test(payload.topic) || referenceImages.some((image) => PERSON_REFERENCE_ROLES.has(image.role));
}

export function buildYoutubeThumbnailPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[] = [],
) {
  validateThumbnailSafety(payload);
  const stylePreset = payload.stylePreset ?? 'tzuyang-food-travel-collage';
  const allowSpecificCreatorHost = allowsSpecificCreatorHost(payload, referenceImages);
  const hostFigureDescription = allowSpecificCreatorHost
    ? 'the requested YouTube creator/Tzuyang-style host cutout or a reference-matched host/person figure'
    : 'a generic non-identifying host/reaction figure or silhouette';
  const hostPersonGuidance = allowSpecificCreatorHost
    ? 'Host/person guidance: ALLOW_SPECIFIC_CREATOR_HOST. The operator acknowledged image rights/safety. It is allowed to include Tzuyang (쯔양) or the provided host/person reference as the main respectful YouTube mukbang creator cutout. Keep it food/travel-context only, never defamatory, sexualized, deceptive, or private-life focused; do not render readable real names/logos in the bitmap because final text is edited separately.'
    : 'Host/person guidance: GENERIC_HOST_ONLY. Use a generic non-identifying host/reaction figure or silhouette; do not recreate any specific real-person likeness.';
  const safetyConstraints = allowSpecificCreatorHost
    ? 'Safety constraints: Do not render real names as readable text, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, or identifiable background crowd faces. The specific creator/person permission applies only to the main host cutout/reference-matched host figure. Text should be placeholder-safe because final typography will be edited separately in the app.'
    : 'Safety constraints: Do not render real names, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, real-person likeness recreation, or identifiable background crowd faces. Generic non-identifying host silhouettes/cutouts are allowed. Text should be placeholder-safe because final typography will be edited separately in the app.';

  const roleSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} reference (${image.mime})`).join('\n')
    : allowSpecificCreatorHost
      ? 'No user image references were provided; use the requested Tzuyang/YouTube creator context for the main host cutout while keeping all visible text editable and non-identifying.'
      : 'No user image references were provided; create a generic non-identifying collage base with one visible non-identifying host/reaction figure or silhouette.';

  return [
    'Create a 16:9 YouTube thumbnail base image for Korean food travel / mukbang content.',
    `Content topic: ${payload.topic}`,
    `Style preset: ${stylePreset} — ${BRIEF_PRESET_PROMPTS[stylePreset]}`,
    `Editable headline placeholder to reserve space for later canvas text: ${payload.headline}`,
    payload.subHeadline ? `Secondary editable caption placeholder: ${payload.subHeadline}` : null,
    '',
    `Style grammar: high-saturation photo-collage composition, bright social thumbnail contrast, oversized foreground food, a clearly visible host/reaction zone with ${hostFigureDescription}, warm market/restaurant/convenience-store lighting, dense but readable layout, clear center/side title safe areas, bold editable Korean title placeholders.`,
    `Composition requirements: bottom 35-55% dominated by vivid food closeups, one main host/reaction zone containing ${hostFigureDescription}, optional small reaction stickers, busy contextual background without readable real signage.`,
    hostPersonGuidance,
    safetyConstraints,
    '',
    'User image references:',
    roleSummary,
    '',
    'Output only the base image; do not bake in final Korean typography because a separate editor will render fonts, stroke, shadow, and position.',
  ]
    .filter(Boolean)
    .join('\n');
}
