import { escapeHtmlAttribute, sanitizeMarkerImageUrl } from './html-escape';

const OVERSEAS_MARKER_BASE_SIZE_CLASSES = ['!h-8', '!w-8'] as const;
const OVERSEAS_MARKER_SELECTED_SIZE_CLASSES = ['!h-[42px]', '!w-[42px]'] as const;

export function buildOverseasMarkerHtml({
    imagePath,
    name,
}: {
    imagePath: string;
    name: string;
}) {
    const safeImagePath = escapeHtmlAttribute(sanitizeMarkerImageUrl(imagePath));
    const safeName = escapeHtmlAttribute(name);

    return `
        <div class="marker-container relative h-full w-full cursor-pointer drop-shadow-md transition-transform duration-200 hover:scale-110">
            <img src="${safeImagePath}" class="h-full w-full object-contain" alt="${safeName}" draggable="false" />
        </div>
    `;
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
