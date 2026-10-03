interface RetainedMarkerAccessibility {
    getElement: () => HTMLElement | null;
    __tzudongRetainedMarkerAriaHidden?: boolean;
}

const OWNER_ATTRIBUTE = 'data-tzudong-retained-marker-hidden';
const MARKER_SELECTOR = '[data-testid="marker"]';

/** Keep retained SDK objects out of the mobile AX tree beyond the padded view. */
export function syncRetainedMarkerAccessibility(marker: RetainedMarkerAccessibility, visible: boolean): void {
    const hidden = !visible;
    if (!hidden && !marker.__tzudongRetainedMarkerAriaHidden) return;

    const element = marker.getElement();
    const root = element?.matches?.(MARKER_SELECTOR)
        ? element
        : element?.querySelector<HTMLElement>(MARKER_SELECTOR);
    if (!root) {
        if (visible) marker.__tzudongRetainedMarkerAriaHidden = false;
        return;
    }

    if (hidden) {
        // Do not claim or later remove an aria-hidden state owned elsewhere.
        if (root.getAttribute('aria-hidden') !== 'true') {
            root.setAttribute(OWNER_ATTRIBUTE, 'true');
            root.setAttribute('aria-hidden', 'true');
        }
    } else if (root.getAttribute(OWNER_ATTRIBUTE) === 'true') {
        root.removeAttribute(OWNER_ATTRIBUTE);
        root.removeAttribute('aria-hidden');
    }
    marker.__tzudongRetainedMarkerAriaHidden = hidden;
}
