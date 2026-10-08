// Internal video references belong to the source data, not the reading surface.
// Leave dates, prose, line breaks and ordinary bracketed content intact.
const VIDEO_TIME_REFERENCES = /\[\s*ts\s*:[^\[\]]*\]/gi;

export function formatTzuyangReviewForDisplay(value: string): string {
    return value.replace(VIDEO_TIME_REFERENCES, '').trim();
}
