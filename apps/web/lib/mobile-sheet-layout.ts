'use client';

const ROOT = () => document.documentElement;

export const MOBILE_SHEET_HIDE_NAV_VAR = '--mobile-sheet-hide-bottom-nav';
export const MOBILE_SHEET_HEADER_PROGRESS_VAR = '--mobile-sheet-header-progress';
export const MOBILE_SHEET_HEADER_OFFSET_VAR = '--mobile-sheet-header-offset';
export const MOBILE_BOTTOM_NAV_HEIGHT_VAR = '--mobile-bottom-nav-height';
export const MOBILE_BOTTOM_NAV_EFFECTIVE_HEIGHT_VAR = '--mobile-bottom-nav-effective-height';
export const APP_HEADER_HEIGHT_VAR = '--app-header-height';
const MOBILE_SHEET_SOURCE_ATTR = 'data-mobile-sheet-source';

const DEFAULT_BOTTOM_NAV_HEIGHT = 60;
const DEFAULT_HEADER_HEIGHT = 56;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const parseCssNumber = (raw: string, fallback: number) => {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
};

const setRootCssVar = (name: string, value: string) => {
    const rootStyle = ROOT().style;
    if (rootStyle.getPropertyValue(name) === value) {
        return false;
    }
    rootStyle.setProperty(name, value);
    return true;
};

const getBottomNavHeight = () => {
    const styles = getComputedStyle(ROOT());
    return parseCssNumber(styles.getPropertyValue(MOBILE_BOTTOM_NAV_HEIGHT_VAR), DEFAULT_BOTTOM_NAV_HEIGHT);
};

const getHeaderHeight = () => {
    const styles = getComputedStyle(ROOT());
    return parseCssNumber(styles.getPropertyValue(APP_HEADER_HEIGHT_VAR), DEFAULT_HEADER_HEIGHT);
};

const getHideBottomNav = () => {
    const styles = getComputedStyle(ROOT());
    return parseCssNumber(styles.getPropertyValue(MOBILE_SHEET_HIDE_NAV_VAR), 0) >= 0.5;
};

const setHeaderDerivedOffset = (progress: number) => {
    const offset = getHeaderHeight() * clamp01(progress);
    setRootCssVar(MOBILE_SHEET_HEADER_OFFSET_VAR, `${offset.toFixed(2)}px`);
};

const syncEffectiveBottomNavHeight = () => {
    const height = getHideBottomNav() ? 0 : getBottomNavHeight();
    setRootCssVar(MOBILE_BOTTOM_NAV_EFFECTIVE_HEIGHT_VAR, `${height.toFixed(2)}px`);
};

export const updateMobileHeaderHeight = (heightPx: number) => {
    if (typeof window === 'undefined') return;
    const didChange = setRootCssVar(APP_HEADER_HEIGHT_VAR, `${Math.max(0, heightPx).toFixed(2)}px`);
    if (!didChange) return;
    const styles = getComputedStyle(ROOT());
    const progress = parseCssNumber(styles.getPropertyValue(MOBILE_SHEET_HEADER_PROGRESS_VAR), 0);
    setHeaderDerivedOffset(progress);
};

export const updateMobileBottomNavHeight = (heightPx: number) => {
    if (typeof window === 'undefined') return;
    const didChange = setRootCssVar(MOBILE_BOTTOM_NAV_HEIGHT_VAR, `${Math.max(0, heightPx).toFixed(2)}px`);
    if (!didChange) return;
    syncEffectiveBottomNavHeight();
};

interface MobileSheetLayoutOptions {
    hideBottomNav: boolean;
    headerHideProgress: number;
    source?: string;
}

export const setMobileSheetLayoutState = ({
    hideBottomNav,
    headerHideProgress,
    source,
}: MobileSheetLayoutOptions) => {
    if (typeof window === 'undefined') return;

    const root = ROOT();
    const progress = clamp01(headerHideProgress);
    const hideValue = hideBottomNav ? '1' : '0';
    const progressValue = progress.toFixed(4);

    const hideChanged = setRootCssVar(MOBILE_SHEET_HIDE_NAV_VAR, hideValue);
    const progressChanged = setRootCssVar(MOBILE_SHEET_HEADER_PROGRESS_VAR, progressValue);
    let sourceChanged = false;

    if (source) {
        if (root.getAttribute(MOBILE_SHEET_SOURCE_ATTR) !== source) {
            root.setAttribute(MOBILE_SHEET_SOURCE_ATTR, source);
            sourceChanged = true;
        }
    }

    if (!hideChanged && !progressChanged && !sourceChanged) {
        return;
    }

    if (progressChanged) {
        setHeaderDerivedOffset(progress);
    }
    if (hideChanged) {
        syncEffectiveBottomNavHeight();
    }
};

export const resetMobileSheetLayoutState = (source?: string) => {
    if (typeof window === 'undefined') return;

    const root = ROOT();
    const currentSource = root.getAttribute(MOBILE_SHEET_SOURCE_ATTR);
    if (source && currentSource && currentSource !== source) {
        return;
    }

    const hideChanged = setRootCssVar(MOBILE_SHEET_HIDE_NAV_VAR, '0');
    setRootCssVar(MOBILE_SHEET_HEADER_PROGRESS_VAR, '0');
    setRootCssVar(MOBILE_SHEET_HEADER_OFFSET_VAR, '0px');
    if (root.hasAttribute(MOBILE_SHEET_SOURCE_ATTR)) {
        root.removeAttribute(MOBILE_SHEET_SOURCE_ATTR);
    }

    if (hideChanged) {
        syncEffectiveBottomNavHeight();
    }
};
