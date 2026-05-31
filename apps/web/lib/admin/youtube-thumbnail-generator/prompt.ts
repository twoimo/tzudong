import type { ThumbnailGeneratorPayload, ThumbnailReferenceImage } from './types';
import { validateThumbnailSafety } from './safety';

export function buildYoutubeThumbnailPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[] = [],
) {
  validateThumbnailSafety(payload);

  const roleSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} reference (${image.mime})`).join('\n')
    : 'No user image references were provided; create a generic non-identifying collage base.';

  return [
    'Create a 16:9 YouTube thumbnail base image for Korean food travel / mukbang content.',
    `Content topic: ${payload.topic}`,
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
