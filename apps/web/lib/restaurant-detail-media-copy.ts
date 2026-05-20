export type RestaurantDetailMediaKind = 'youtube' | 'review';

interface RestaurantDetailMediaCopy {
    title: string;
    countLabel: string;
    collapsedToggleLabel: string;
    expandedToggleLabel: string;
    collapsedHint: string;
    toggleAriaLabel: string;
    openAriaLabel: (index: number) => string;
    itemBadge: (index: number) => string;
}

const getMediaNoun = (kind: RestaurantDetailMediaKind): string =>
    kind === 'youtube' ? '영상' : '리뷰';

export function buildRestaurantDetailMediaCopy(
    kind: RestaurantDetailMediaKind,
    count: number,
    isExpanded: boolean,
): RestaurantDetailMediaCopy {
    const mediaNoun = getMediaNoun(kind);
    const title = kind === 'youtube' ? '쯔양 유튜브 영상' : '쯔양의 리뷰';
    const safeCount = Math.max(count, 0);
    const remainingCount = Math.max(safeCount - 1, 0);

    return {
        title,
        countLabel: `${safeCount}개 ${mediaNoun}`,
        collapsedToggleLabel: `${mediaNoun} ${remainingCount}개 더 보기`,
        expandedToggleLabel: '접기',
        collapsedHint: `${mediaNoun} ${safeCount}개가 연결되어 있어요. 펼쳐서 모두 확인할 수 있습니다.`,
        toggleAriaLabel: isExpanded ? `${title} 접기` : `${title} ${remainingCount}개 더 보기`,
        openAriaLabel: (index: number) => `${title} ${index}/${safeCount} 열기`,
        itemBadge: (index: number) => `${mediaNoun} ${index}/${safeCount}`,
    };
}
