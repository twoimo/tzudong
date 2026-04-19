export function getRegionalClusterTargetZoom(currentZoom: number) {
    return Math.min(currentZoom + 2, 9);
}

export function getSeoulDistrictTargetZoom(currentZoom: number) {
    if (currentZoom <= 10) return 11;
    if (currentZoom <= 12) return 13;
    return 13;
}

export function getSuperclusterTargetZoom(currentZoom: number, expansionZoom: number) {
    const nextZoom = expansionZoom <= currentZoom ? currentZoom + 2 : expansionZoom;
    return Math.max(nextZoom, 9);
}

export function shouldHideInSeoulDistrictMode({
    address,
    isPointInSeoul,
    shouldUseSeoulDistrictCluster,
}: {
    address?: string | null;
    isPointInSeoul: boolean;
    shouldUseSeoulDistrictCluster: boolean;
}) {
    if (!shouldUseSeoulDistrictCluster) return false;
    if (address) return address.includes('서울');
    return isPointInSeoul;
}
