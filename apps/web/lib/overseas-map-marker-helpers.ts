export function buildOverseasMarkerHtml({
    imagePath,
    name,
}: {
    imagePath: string;
    name: string;
}) {
    return `
        <div class="marker-container" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            <img src="${imagePath}" style="width: 100%; height: 100%; object-fit: contain;" alt="${name}" />
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

    if (isSelected) {
        markerElement.style.width = '42px';
        markerElement.style.height = '42px';
        markerElement.classList.add('selected');
        container.style.transform = 'scale(1.1)';
        return;
    }

    markerElement.style.width = '32px';
    markerElement.style.height = '32px';
    markerElement.classList.remove('selected');
    container.style.transform = 'scale(1)';
}
