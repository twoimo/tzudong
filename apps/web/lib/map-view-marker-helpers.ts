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
    return `
        <div style="
          position: relative;
          width: ${markerSize}px;
          height: ${markerSize}px;
          cursor: pointer;
          transition: all 0.3s ease;
          filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.3));
        " class="${isSelected ? 'animate-bounce' : ''} hover:scale-125">
          <img src="${imagePath}" alt="${name}" style="width: 100%; height: 100%; object-fit: contain;" draggable="false" />
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

    const markerSize = getMapViewMarkerSize(isSelected);
    innerDiv.style.width = `${markerSize}px`;
    innerDiv.style.height = `${markerSize}px`;

    if (isSelected) {
        innerDiv.classList.add('animate-bounce');
    } else {
        innerDiv.classList.remove('animate-bounce');
    }

    return true;
}
