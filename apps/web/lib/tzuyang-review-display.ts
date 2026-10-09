// Internal video references belong to the source data, not the reading surface.
// Leave dates, prose, line breaks and ordinary bracketed content intact.
const VIDEO_TIME_REFERENCES = /\[\s*ts\s*:[^\[\]]*\]/gi;
// Explicit ts wrappers distinguish video evidence from opening hours/durations.
const LEGACY_VIDEO_TIME_REFERENCES = /\(\s*ts\s*:[^()]*\)|\{\s*ts\s*:[^{}]*\}/gi;
const PAIRED_EMPHASIS = /\*\*([^*\n]+)\*\*/g;

export function formatTzuyangReviewForDisplay(value: string): string {
    return value
        .replace(VIDEO_TIME_REFERENCES, '')
        .replace(LEGACY_VIDEO_TIME_REFERENCES, '')
        .replace(PAIRED_EMPHASIS, '$1')
        .replace(/(?<=[가-힣])[ \t]+([.,!?])(?=\s|$)/g, '$1')
        .trim();
}
