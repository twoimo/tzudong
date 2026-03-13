import { Restaurant } from '@/types/restaurant';

export type ArrowNavigationStep = -1 | 1;

type KeyboardEventTargetLike = {
    tagName?: string | null;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
};

export type ArrowNavigationEventLike = {
    key: string;
    defaultPrevented?: boolean;
    isComposing?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    target?: EventTarget | KeyboardEventTargetLike | null;
};

type ArrowNavigationGuardInput = {
    event: ArrowNavigationEventLike;
    isDesktop: boolean;
    isPanelOpen: boolean;
    hasCurrentRestaurant: boolean;
    swipeableCount: number;
};

const KEYBOARD_NAV_INTERACTIVE_SELECTOR = 'button, a, [role="button"], [role="link"]';
const KEYBOARD_NAV_MAP_CONTROL_SELECTOR = '[data-testid="map-container"] button';
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const toTargetLike = (target: ArrowNavigationEventLike['target']): KeyboardEventTargetLike | null => {
    if (!target || typeof target !== 'object') return null;
    return target as KeyboardEventTargetLike;
};

export const isEditableOrInteractiveKeyboardTarget = (target: ArrowNavigationEventLike['target']): boolean => {
    const targetLike = toTargetLike(target);
    if (!targetLike) return false;

    const normalizedTagName = targetLike.tagName?.toUpperCase();
    if (normalizedTagName && EDITABLE_TAGS.has(normalizedTagName)) {
        return true;
    }

    if (targetLike.isContentEditable) {
        return true;
    }

    if (typeof targetLike.closest === 'function') {
        if (targetLike.closest('[contenteditable]')) {
            return true;
        }
        if (targetLike.closest(KEYBOARD_NAV_INTERACTIVE_SELECTOR)) {
            return true;
        }
        if (targetLike.closest(KEYBOARD_NAV_MAP_CONTROL_SELECTOR)) {
            return true;
        }
    }

    return false;
};

export const getDesktopArrowNavigationStep = ({
    event,
    isDesktop,
    isPanelOpen,
    hasCurrentRestaurant,
    swipeableCount,
}: ArrowNavigationGuardInput): ArrowNavigationStep | null => {
    if (!isDesktop || !isPanelOpen || !hasCurrentRestaurant || swipeableCount <= 1) {
        return null;
    }

    if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
    ) {
        return null;
    }

    if (isEditableOrInteractiveKeyboardTarget(event.target)) {
        return null;
    }

    if (event.key === 'ArrowLeft') {
        return -1;
    }

    if (event.key === 'ArrowRight') {
        return 1;
    }

    return null;
};

type GetAdjacentRestaurantInput = {
    restaurants: Restaurant[];
    currentRestaurant: Restaurant;
    step: ArrowNavigationStep;
    isSameRestaurant: (a: Restaurant, b: Restaurant) => boolean;
};

export const getAdjacentRestaurantByStep = ({
    restaurants,
    currentRestaurant,
    step,
    isSameRestaurant,
}: GetAdjacentRestaurantInput): Restaurant | null => {
    if (restaurants.length <= 1) return null;

    const currentIndex = restaurants.findIndex((restaurant) =>
        isSameRestaurant(restaurant, currentRestaurant)
    );

    if (currentIndex < 0) return null;

    const nextIndex = currentIndex + step;
    const nextRestaurant = restaurants[nextIndex];
    return nextRestaurant ?? null;
};

type HandleDesktopArrowNavigationInput = ArrowNavigationGuardInput & {
    event: ArrowNavigationEventLike & { preventDefault?: () => void };
    onNavigate: (step: ArrowNavigationStep) => boolean;
};

export const handleDesktopArrowNavigationEvent = ({
    event,
    onNavigate,
    ...guardInput
}: HandleDesktopArrowNavigationInput): boolean => {
    const step = getDesktopArrowNavigationStep({
        event,
        ...guardInput,
    });

    if (!step) {
        return false;
    }

    const moved = onNavigate(step);
    if (moved) {
        event.preventDefault?.();
    }

    return moved;
};
