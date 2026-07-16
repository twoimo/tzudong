import { escapeHtmlAttribute, sanitizeMarkerImageUrl } from './html-escape';

const MAP_VIEW_MARKER_BASE_SIZE_CLASSES = ['h-8', 'w-8'] as const;
const MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES = ['h-[42px]', 'w-[42px]'] as const;

export function isMapViewMarkerSelected({
    restaurantId,
    searchedRestaurantId,
    selectedRestaurantId,
}: {
    restaurantId: string;
    searchedRestaurantId?: string | null;
    selectedRestaurantId?: string | null;
}) {
    return selectedRestaurantId === restaurantId || searchedRestaurantId === restaurantId;
}

export function getMapViewMarkerSize(isSelected: boolean) {
    return isSelected ? 42 : 32;
}

export function buildMapViewMarkerHtml({
    imagePath,
    isSelected,
    markerSize,
    name,
}: {
    imagePath: string;
    isSelected: boolean;
    markerSize: number;
    name: string;
}) {
    const expectedMarkerSize = getMapViewMarkerSize(isSelected);
    const normalizedMarkerSize = Number.isFinite(markerSize) && markerSize === expectedMarkerSize
        ? markerSize
        : expectedMarkerSize;
    const markerSizeClasses = normalizedMarkerSize === 42
        ? MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES
        : MAP_VIEW_MARKER_BASE_SIZE_CLASSES;
    const safeImagePath = escapeHtmlAttribute(sanitizeMarkerImageUrl(imagePath));
    const safeName = escapeHtmlAttribute(name);

    return `
        <div class="relative ${markerSizeClasses.join(' ')} cursor-pointer transition-all duration-300 drop-shadow-md ${isSelected ? 'animate-bounce' : ''} hover:scale-125">
          <img src="${safeImagePath}" alt="${safeName}" class="h-full w-full object-contain" draggable="false" />
        </div>
      `;
}

export function applyMapViewMarkerSelectedState({
    isSelected,
    markerElement,
}: {
    isSelected: boolean;
    markerElement: HTMLElement;
}) {
    const innerDiv = markerElement.querySelector('div') as HTMLElement | null;
    if (!innerDiv) return false;

    innerDiv.classList.remove(
        ...MAP_VIEW_MARKER_BASE_SIZE_CLASSES,
        ...MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES,
        'animate-bounce',
    );
    innerDiv.classList.add(
        ...(isSelected ? MAP_VIEW_MARKER_SELECTED_SIZE_CLASSES : MAP_VIEW_MARKER_BASE_SIZE_CLASSES),
    );

    if (isSelected) {
        innerDiv.classList.add('animate-bounce');
    }

    return true;
}
