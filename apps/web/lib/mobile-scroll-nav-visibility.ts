export type MobileScrollNavVisibilityAction = 'hide' | 'show' | 'unchanged';

type MobileScrollNavVisibilityInput = {
    previousScrollTop: number;
    currentScrollTop: number;
    isHidden: boolean;
    thresholdPx?: number;
    topRevealOffsetPx?: number;
};

const DEFAULT_SCROLL_THRESHOLD_PX = 18;
const DEFAULT_TOP_REVEAL_OFFSET_PX = 12;

export function getMobileScrollNavVisibilityAction({
    previousScrollTop,
    currentScrollTop,
    isHidden,
    thresholdPx = DEFAULT_SCROLL_THRESHOLD_PX,
    topRevealOffsetPx = DEFAULT_TOP_REVEAL_OFFSET_PX,
}: MobileScrollNavVisibilityInput): MobileScrollNavVisibilityAction {
    if (currentScrollTop <= topRevealOffsetPx) {
        return isHidden ? 'show' : 'unchanged';
    }

    const delta = currentScrollTop - previousScrollTop;

    if (delta >= thresholdPx) {
        return isHidden ? 'unchanged' : 'hide';
    }

    if (delta <= -thresholdPx) {
        return isHidden ? 'show' : 'unchanged';
    }

    return 'unchanged';
}
