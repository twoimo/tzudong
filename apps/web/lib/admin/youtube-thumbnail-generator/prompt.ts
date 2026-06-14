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
const TZUYANG_CHANNEL_PRESET = 'tzuyang-food-travel-collage';
const PERSON_REFERENCE_ROLES = new Set<ThumbnailReferenceImage['role']>(['host', 'person']);

function requestsSpecificCreatorHost(payload: ThumbnailGeneratorPayload) {
  return TZUYANG_TOPIC_PATTERN.test(payload.topic)
    || (payload.stylePreset ?? TZUYANG_CHANNEL_PRESET) === TZUYANG_CHANNEL_PRESET;
}

function hasHostPersonReference(referenceImages: ThumbnailReferenceImage[]) {
  return referenceImages.some((image) => PERSON_REFERENCE_ROLES.has(image.role));
}

function allowsSpecificCreatorHost(_payload: ThumbnailGeneratorPayload, referenceImages: ThumbnailReferenceImage[]) {
  return hasHostPersonReference(referenceImages);
}

function isRedWarmHighSignalTopic(payload: ThumbnailGeneratorPayload) {
  return /(매운|불맛|마라|불닭|떡볶|제육|닭발|쭈꾸미|라면|치킨|갈비|빨간|고추장|양념|폭탄|도전|역대|전메뉴|전\s*메뉴)/i.test(
    `${payload.topic} ${payload.headline} ${payload.subHeadline ?? ''}`,
  );
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
    ? 'a clearly visible provided host/person reference-matched creator cutout, never an empty silhouette, missing person, generic woman, or alternate Korean mukbang host'
    : 'food-only composition with no human figure, no face, no silhouette, and no cutout unless a host/person reference is provided';
  const hostPersonGuidance = allowSpecificCreatorHost
    ? 'Host/person guidance: ALLOW_SPECIFIC_CREATOR_HOST_WITH_REFERENCE. A host/person reference image was provided, so the main YouTube mukbang creator cutout must be clearly visible and based only on that provided reference. Treat attached host/person references as strict identity-lock references: preserve the same creator face shape, forehead/bangs silhouette, hair length and parting, eye spacing/shape, nose/mouth proportions, cheek/jaw outline, expression energy, camera angle, and cutout placement from the references. Do not omit the creator, do not use a blank silhouette, and do not replace the creator with a generic woman, idol-like face, younger/older alternate, or newly invented mukbang host. Do not invent eyeglasses, hats, masks, heavy jewelry, new hairstyle, or new accessories unless the supplied host/person references consistently show them. If the host likeness cannot be followed from references, prefer no human figure over a wrong person. Keep it food/travel-context only, never defamatory, sexualized, deceptive, or private-life focused; do not render readable real names/logos in the bitmap because final text is edited separately.'
    : requestedSpecificCreatorHost
      ? 'Host/person guidance: SPECIFIC_CREATOR_REFERENCE_REQUIRED. The topic mentions Tzuyang (쯔양), but no host/person reference image was provided. Do not recreate or guess Tzuyang likeness. Create a food-first base thumbnail with no human face, no silhouette, no cutout, and no empty creator body zone that could be mistaken for Tzuyang.'
      : 'Host/person guidance: FOOD_ONLY_WITHOUT_REFERENCE. No host/person reference was provided, so do not draw any human figure, face, silhouette, hands-waving reaction cutout, or back-of-head placeholder. Use food detail, steam, utensils, bowls, and restaurant depth as the reaction energy instead.';
  const heroZoneDescription = allowSpecificCreatorHost
    ? `a reference-backed host/reaction zone with ${hostFigureDescription}`
    : 'a food-detail reaction zone using steam, chopsticks, sauce gloss, scale, and depth-of-field with no human figure';
  const safetyConstraints = allowSpecificCreatorHost
    ? 'Safety constraints: Do not render real names as readable text, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, or identifiable background crowd faces. The specific creator/person permission applies only to the supplied host/person reference-matched host figure. Text should be placeholder-safe because final typography will be edited separately in the app.'
    : 'Safety constraints: Do not render real names, account names, URLs, phone numbers, addresses, exact prices, brand logos, copied source text, real-person likeness recreation, creator face guesses, or identifiable background crowd faces. Force no-person/food-only output when no host/person reference is provided. Text should be placeholder-safe because final typography will be edited separately in the app.';

  const automaticTzuyangReferenceCount = referenceImages.filter((image) => image.name.startsWith('auto-tzuyang-thumbnail-')).length;
  const automaticTzuyangHostReferenceCount = referenceImages.filter((image) => image.name.startsWith('auto-tzuyang-thumbnail-') && PERSON_REFERENCE_ROLES.has(image.role)).length;
  const uploadedReferenceCount = Math.max(0, referenceImages.length - automaticTzuyangReferenceCount);
  const roleSummary = referenceImages.length
    ? referenceImages.map((image, index) => `${index + 1}. ${image.role} reference (${image.mime})${image.name.startsWith('auto-tzuyang-thumbnail-') ? PERSON_REFERENCE_ROLES.has(image.role) ? ' — collected Tzuyang thumbnail visual reference (host/person)' : ' — collected Tzuyang thumbnail visual reference (style)' : ''}`).join('\n')
    : requestedSpecificCreatorHost
      ? 'No host/person reference was provided; specific creator likeness requires a host/person reference, so create a food-only base with no person, no silhouette, and no cutout.'
      : 'No user image references were provided; create a food-only collage base with no human face, no silhouette, no cutout, and no generic host body.';

  const redWarmHighSignalTopic = isRedWarmHighSignalTopic(payload);
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
  const retrievedThumbnailVisualDirective = retrievalEvidence.length
    ? [
      `Collected Tzuyang thumbnail visual matching: ${retrievalEvidence.length} ranked existing Tzuyang video thumbnail reference(s) were selected from the local library.`,
      automaticTzuyangReferenceCount > 0
        ? automaticTzuyangHostReferenceCount > 0
          ? `${automaticTzuyangReferenceCount} selected existing Tzuyang thumbnail image(s) are attached as actual visual references, including ${automaticTzuyangHostReferenceCount} host/person reference(s). The final base image must include a visible reference-backed Tzuyang host cutout; do not produce a food-only frame, blank silhouette, missing host, generic woman, idol-like alternate, or newly invented mukbang host. Identity lock: use the attached host/person thumbnails to preserve the same creator face structure, forehead/bangs silhouette, hair length and parting, eye spacing/shape, nose/mouth proportions, cheek/jaw outline, expression energy, upper-body cutout feel, and typical Tzuyang thumbnail placement. Do not add eyeglasses, hats, masks, heavy jewelry, new hairstyle, or new accessories unless those exact accessories are consistently visible in the attached Tzuyang host references. Match their thumbnail grammar very closely: Tzuyang-style host cutout placement, food scale, saturated contrast, Korean mukbang collage density, hook-safe negative space, warm restaurant/market lighting, and final text-safe zones. Use these locally held thumbnail images as strict reference-backed host/style/composition/color/layout guides; do not copy readable text, logos, exact source frames, or create defamatory/sexualized/private-life context. If the references are too small or inconsistent for identity, omit the human figure rather than showing the wrong person.`
          : `${automaticTzuyangReferenceCount} selected Tzuyang thumbnail image(s) are attached as actual visual references. Match their thumbnail grammar very closely: food scale, saturated contrast, Korean mukbang collage density, hook-safe negative space, warm restaurant/market lighting, and final text-safe zones. Use them as style/composition/color/layout references only; do not copy readable text, logos, exact source frames, or treat them as host/person likeness permission.`
        : 'If the selected references are listed only as evidence, still follow their titles and reasons as the main Tzuyang-channel style/composition target, but do not claim image-reference matching.',
      uploadedReferenceCount > 0
        ? `${uploadedReferenceCount} user-uploaded reference image(s) remain higher priority than automatic references for any explicit food/object/person details.`
        : null,
    ].filter(Boolean).join(' ')
    : 'No collected Tzuyang thumbnail references are available; use the preset style only.';
  const retrievalModelUseProof = retrievalDiagnostics?.status === 'used' || retrievalDiagnostics?.status === 'partial'
    ? [
      retrievalDiagnostics.usedModels?.embedding === 'BAAI/bge-m3' && retrievalDiagnostics.operations?.denseSparseHybrid
        ? 'Embedding retrieval proof: BAAI/bge-m3 dense/sparse hybrid diagnostics present.'
        : null,
      retrievalDiagnostics.usedModels?.reranker === 'BAAI/bge-reranker-v2-m3' && retrievalDiagnostics.operations?.rerankerApplied
        ? 'Reranker proof: BAAI/bge-reranker-v2-m3 diagnostics present.'
        : null,
      retrievalDiagnostics.usedModels?.embedding === 'local-char-ngram-v1' && retrievalDiagnostics.operations?.localVectorSearch
        ? 'Local vector retrieval proof: deterministic char-ngram embedding diagnostics present.'
        : null,
      retrievalDiagnostics.usedModels?.reranker === 'local-lexical-reranker-v1' && retrievalDiagnostics.operations?.lexicalRerank
        ? 'Local reranker proof: lexical reranker diagnostics present; do not label as BGE.'
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
    redWarmHighSignalTopic ? 'Tzuyang benchmark color cue: recent high-view sample and the local thumbnail library skew warm/red for spicy, sauced, challenge, and street-food subjects. Use appetizing red-orange sauce/steam/lighting as a supporting visual cue, while preserving natural food color and not washing out the host face or text-safe areas.' : null,
    `Aesthetic quality loop constraints: avoid blank_space, synthetic_host, weak_focus, text_conflict, food_density, and lighting issues. If no verified host/person reference is available, food-only hero composition is mandatory. Do not place detailed food under the expected final Korean text zones, and never draw face-like silhouettes or placeholder text strips.`,
    `Layout target: main food impact in the lower/side foreground, secondary hook area in the upper right or upper left, and reaction energy expressed through steam, chopsticks, sauce gloss, food scale, and depth-of-field instead of human silhouettes or sticker-like collage edges. Keep text-safe areas on edges or darker low-detail bands so later canvas typography does not cover the host face, hands, or core food detail.`,
    hostPersonGuidance,
    safetyConstraints,
    '',
    'User image references:',
    roleSummary,
    '',
    'Automatic collected-reference evidence:',
    retrievalSummary,
    retrievedThumbnailVisualDirective,
    retrievalModelUseProof || 'No embedding/reranker model-use claim is made for automatic references unless diagnostics prove actual use.',
    automaticTzuyangHostReferenceCount > 0
      ? 'Automatic host/person visual references come only from selected existing Tzuyang thumbnail images; the host must be visible and reference-backed, not a generic woman, while keeping the final result respectful, food/travel-contextual, and editable. If identity matching is uncertain, do not invent a different person or add reference-mismatched accessories such as eyeglasses.'
      : 'Automatic style/composition/text-layout references are not host/person likeness references and must not be used to recreate a real creator face.',
    '',
    'Output only the base image; do not bake in final Korean typography because a separate editor will render fonts, stroke, shadow, and position.',
  ]
    .filter(Boolean)
    .join('\n');
}
