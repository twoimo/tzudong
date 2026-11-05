import { escapeHtmlAttribute, sanitizeMarkerImageUrl } from './html-escape';
import { publicPopularityTier, wrapMarkerWithPopularityTier } from './evidence-engineering/popularity-marker';

const OVERSEAS_MARKER_BASE_SIZE_CLASSES = ['!h-8', '!w-8'] as const;
const OVERSEAS_MARKER_SELECTED_SIZE_CLASSES = ['!h-[42px]', '!w-[42px]'] as const;

export function hasRenderableOverseasCoordinates({ lat, lng }: { lat: unknown; lng: unknown }) {
    const valid = (value: unknown, limit: number) =>
        (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
        && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
    return valid(lat, 90) && valid(lng, 180) && (Number(lat) !== 0 || Number(lng) !== 0);
}

export function buildOverseasMarkerHtml({
    imagePath,
    name,
    popularityTier,
}: {
    imagePath: string;
    name: string;
    popularityTier?: unknown;
}) {
    const safeImagePath = escapeHtmlAttribute(sanitizeMarkerImageUrl(imagePath));
    const safeName = escapeHtmlAttribute(name);

    return wrapMarkerWithPopularityTier(`
        <button type="button" aria-label="${safeName} 상세 보기" class="marker-container relative h-full w-full cursor-pointer border-0 bg-transparent p-0 hover:scale-110 focus-visible:ring-2 focus-visible:ring-primary">
            <img src="${safeImagePath}" class="h-full w-full object-contain" alt="" draggable="false" />
        </button>
    `, publicPopularityTier(popularityTier));
}

export function getOverseasMarkerActiveId({
    searchedRestaurantId,
    selectedRestaurantId,
}: {
    searchedRestaurantId?: string | null;
    selectedRestaurantId?: string | null;
}) {
    return selectedRestaurantId || searchedRestaurantId || null;
}

export function applyOverseasMarkerSelectedState({
    container,
    isSelected,
    markerElement,
}: {
    container: HTMLElement | null;
    isSelected: boolean;
    markerElement: HTMLElement;
}) {
    if (!container) return;

    markerElement.classList.remove(
        ...OVERSEAS_MARKER_BASE_SIZE_CLASSES,
        ...OVERSEAS_MARKER_SELECTED_SIZE_CLASSES,
        'selected',
    );
    markerElement.classList.add(
        ...(isSelected ? OVERSEAS_MARKER_SELECTED_SIZE_CLASSES : OVERSEAS_MARKER_BASE_SIZE_CLASSES),
    );
    container.classList.remove('scale-100', 'scale-110');

    if (isSelected) {
        markerElement.classList.add('selected');
        container.classList.add('scale-110');
        return;
    }

    container.classList.add('scale-100');
}
