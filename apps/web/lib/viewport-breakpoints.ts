export const BREAKPOINTS = {
    mobileMax: 767,
    tabletMax: 1279,
} as const;

// Minimum widths and their complements also cover fractional CSS pixels.
export const TABLET_MIN_WIDTH_QUERY = `(min-width: ${BREAKPOINTS.mobileMax + 1}px)`;
export const DESKTOP_MIN_WIDTH_QUERY = `(min-width: ${BREAKPOINTS.tabletMax + 1}px)`;
