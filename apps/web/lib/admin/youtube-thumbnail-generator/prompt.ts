import type { ThumbnailBriefPreset, ThumbnailGeneratorPayload, ThumbnailReferenceImage } from './types';
import { validateThumbnailSafety } from './safety';

const BRIEF_PRESET_PROMPTS: Record<ThumbnailBriefPreset, string> = {
  'tzuyang-food-travel-collage':
    'Tzudong-style food travel collage: high-energy food-first composition, oversized glossy food foreground, dense local food-place background, large editable Korean title safe area; host/person appears only when a host/person reference is supplied.',
  'night-market-reaction':
    'Night market reaction: warm lantern/food-stall lighting, crowded food-stall depth without identifiable people, street food plates filling the lower frame; host/person appears only when a host/person reference is supplied.',
  'convenience-store-haul':
    'Convenience-store haul: bright fluorescent store lighting, many generic snack/meal packages with fictional labels only, instant noodles and desserts stacked across the lower frame.',
  'grilled-meat-feast':
    'Grilled-meat feast: huge glossy skewers and roasted meat across the foreground, warm restaurant lighting, visible sauce/char textures, food-detail reaction energy separated from text-safe zones.',
  'sushi-seafood-table':
    'Sushi/seafood table: bright casual restaurant, many white plates with glossy seafood pieces, low table-angle perspective, oversized food detail near the lens.',
};

const TZUYANG_TOPIC_PATTERN = /(쯔양|tzuyang)/i;
const PERSON_REFERENCE_ROLES = new Set<ThumbnailReferenceImage['role']>(['host', 'person']);

function requestsSpecificCreatorHost(payload: ThumbnailGeneratorPayload) {
  return TZUYANG_TOPIC_PATTERN.test(payload.topic);
}

function hasHostPersonReference(referenceImages: ThumbnailReferenceImage[]) {
  return referenceImages.some((image) => PERSON_REFERENCE_ROLES.has(image.role));
}

function allowsSpecificCreatorHost(_payload: ThumbnailGeneratorPayload, referenceImages: ThumbnailReferenceImage[]) {
  return hasHostPersonReference(referenceImages);
}

export function buildYoutubeThumbnailPrompt(
  payload: ThumbnailGeneratorPayload,
  referenceImages: ThumbnailReferenceImage[] = [],
) {
  validateThumbnailSafety(payload);
  const stylePreset = payload.stylePreset ?? 'tzuyang-food-travel-collage';
  const requestedSpecificCreatorHost = requestsSpecificCreatorHost(payload);
  const allowSpecificCreatorHost = allowsSpecificCreatorHost(payload, referenceImages);
  const hostFigureDescription = allowSpecificCreatorHost
    ? 'the provided host/person reference-matched figure'
    : 'food-only composition with no human figure, no face, no silhouette, and no cutout unless a host/person reference is provided';
  const hostPersonGuidance = allowSpecificCreatorHost
    ? 'Host/person guidance: ALLOW_SPECIFIC_CREATOR_HOST_WITH_REFERENCE. A host/person reference image was provided, so match only that provided reference respectfully for the main YouTube mukbang creator cutout. Keep it food/travel-context only, never defamatory, sexualized, deceptive, or private-life focused; do not render readable real names/logos in the bitmap because final text is edited separately.'
    : requestedSpecificCreatorHost
      ? 'Host/person guidance: SPECIFIC_CREATOR_REFERENCE_REQUIRED. The topic mentions Tzuyang (쯔양), but no host/person reference image was provided. Do not recreate or guess Tzuyang likeness. Create a food-first base thumbnail with no human face, no silhouette, no cutout, and no empty creator body zone that could be mistaken for Tzuyang.'
      : 'Host/person guidance: FOOD_ONLY_WITHOUT_REFERENCE. No host/person reference was provided, so do not draw any human figure, face, silhouette, hands-waving reaction cutout, or back-of-head placeholder. Use food detail, steam, utensils, bowls, and restaurant depth as the reaction energy instead.';
  const heroZoneDescription = allowSpecificCreatorHost
    ? `a reference-backed host/reaction zone with ${hostFigureDescription}`
    : 'a food-detail reaction zone using steam, chopsticks, sauce gloss, scale, and depth-of-field with no human figure';
  const safetyConstraints = allowSpecificCreatorHost
    ? 'Safety constraints: Do not render real names as readable text, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, or identifiable background crowd faces. The specific creator/person permission applies only to the supplied host/person reference-matched host figure. Text should be placeholder-safe because final typography will be edited separately in the app.'
    : 'Safety constraints: Do not render real names, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, real-person likeness recreation, creator face guesses, or identifiable background crowd faces. Force no-person/food-only output when no host/person reference is provided. Text should be placeholder-safe because final typography will be edited separately in the app.';

  const roleSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} reference (${image.mime})`).join('\n')
    : requestedSpecificCreatorHost
      ? 'No host/person reference was provided; specific creator likeness requires a host/person reference, so create a food-only base with no person, no silhouette, and no cutout.'
      : 'No user image references were provided; create a food-only collage base with no human face, no silhouette, no cutout, and no generic host body.';

  const retrievalEvidence = payload.retrievalEvidence ?? [];
  const retrievalSummary = retrievalEvidence.length
    ? retrievalEvidence.slice(0, 6).map((evidence, index) => {
      const source = [evidence.videoId, evidence.title].filter(Boolean).join(' · ') || evidence.id;
      const score = typeof evidence.rerankScore === 'number'
        ? `rerank=${evidence.rerankScore.toFixed(3)}`
        : typeof evidence.hybridScore === 'number'
          ? `score=${evidence.hybridScore.toFixed(1)}`
          : 'score=n/a';
      return `${index + 1}. intent=${evidence.intent} uploadRole=${evidence.uploadRole} source=${source} ${score} reason=${evidence.selectedReason}`;
    }).join('\n')
    : 'No automatic Tzuyang thumbnail/video retrieval references selected.';
  const retrievalDiagnostics = payload.retrievalDiagnostics;
  const retrievalModelUseProof = retrievalDiagnostics?.status === 'used' || retrievalDiagnostics?.status === 'partial'
    ? [
      retrievalDiagnostics.usedModels?.embedding && retrievalDiagnostics.operations?.denseSparseHybrid
        ? 'Embedding retrieval proof: BAAI/bge-m3 dense/sparse hybrid diagnostics present.'
        : null,
      retrievalDiagnostics.usedModels?.reranker && retrievalDiagnostics.operations?.rerankerApplied
        ? 'Reranker proof: BAAI/bge-reranker-v2-m3 diagnostics present.'
        : null,
    ].filter(Boolean).join(' ')
    : '';

  return [
    'Create a 16:9 YouTube thumbnail base image for Korean food travel / mukbang content.',
    `Content topic: ${payload.topic}`,
    `Style preset: ${stylePreset} — ${BRIEF_PRESET_PROMPTS[stylePreset]}`,
    `Editable headline placeholder to reserve space for later canvas text: ${payload.headline}`,
    payload.subHeadline ? `Secondary editable caption placeholder: ${payload.subHeadline}` : null,
    '',
    `Style grammar: high-saturation photo-collage composition, bright social thumbnail contrast, oversized foreground food, ${heroZoneDescription}, warm market/restaurant/convenience-store lighting, dense but readable layout, clear center/side title safe areas, bold editable Korean title placeholders.`,
    `Composition requirements: food must occupy roughly 70-85% of the final 1280x720 frame with crisp appetizing closeups; reserve deliberate text-safe zones as natural shallow-depth background or dark gradients without drawing blank rectangles, beige brush strips, label bars, or placeholder boxes; keep the main subject focus readable at mobile thumbnail size.`,
    `Aesthetic quality loop constraints: avoid blank_space, synthetic_host, weak_focus, text_conflict, food_density, and lighting issues. If no verified host/person reference is available, food-only hero composition is mandatory. Do not place detailed food under the expected final Korean text zones, and never draw face-like silhouettes or placeholder text strips.`,
    `Layout target: main food impact in the lower/side foreground, secondary hook area in the upper right or upper left, and reaction energy expressed through steam, chopsticks, sauce gloss, food scale, and depth-of-field instead of human silhouettes or sticker-like collage edges.`,
    hostPersonGuidance,
    safetyConstraints,
    '',
    'User image references:',
    roleSummary,
    '',
    'Automatic collected-reference evidence:',
    retrievalSummary,
    retrievalModelUseProof || 'No embedding/reranker model-use claim is made for automatic references unless diagnostics prove actual use.',
    'Automatic style/composition/text-layout references are not host/person likeness references and must not be used to recreate a real creator face.',
    '',
    'Output only the base image; do not bake in final Korean typography because a separate editor will render fonts, stroke, shadow, and position.',
  ]
    .filter(Boolean)
    .join('\n');
}
