interface RetainedMarkerAccessibility {
    getElement: () => HTMLElement | null;
    __tzudongRetainedMarkerAriaHidden?: boolean;
}

const OWNER_ATTRIBUTE = 'data-tzudong-retained-marker-hidden';
const MARKER_SELECTOR = '[data-testid="marker"]';
const OVERLAY_SELECTOR = '[data-visible-marker-review-bubble-anchor="true"]';

interface PendingRootRegistry {
    target: HTMLElement;
    markers: Set<RetainedMarkerAccessibility>;
    observer: MutationObserver;
}

const rootTargets = new WeakMap<RetainedMarkerAccessibility, HTMLElement>();
const pendingRoots = new WeakMap<RetainedMarkerAccessibility, PendingRootRegistry>();
const rootRegistries = new WeakMap<HTMLElement, PendingRootRegistry>();

function cancelPendingRoot(marker: RetainedMarkerAccessibility): void {
    const registry = pendingRoots.get(marker);
    if (!registry) return;
    pendingRoots.delete(marker);
    registry.markers.delete(marker);
    if (registry.markers.size === 0) {
        registry.observer.disconnect();
        rootRegistries.delete(registry.target);
    }
}

function watchPendingRoot(marker: RetainedMarkerAccessibility, target: HTMLElement): void {
    const previous = pendingRoots.get(marker);
    if (previous?.target === target) return;
    cancelPendingRoot(marker);
    let registry = rootRegistries.get(target);
    if (!registry) {
        const markers = new Set<RetainedMarkerAccessibility>();
        const observer = new MutationObserver(() => {
            // One observer per map, with no timer/poll loop. SDK insertion runs
            // this before paint; release/visibility/unmount cancel ownership.
            for (const pending of markers) syncRetainedMarkerAccessibility(pending, false, target);
        });
        registry = { target, markers, observer };
        rootRegistries.set(target, registry);
        observer.observe(target, { childList: true, subtree: true });
    }
    registry.markers.add(marker);
    pendingRoots.set(marker, registry);
}

/** Keep retained SDK objects out of the mobile AX tree beyond the padded view. */
export function syncRetainedMarkerAccessibility(
    marker: RetainedMarkerAccessibility,
    visible: boolean,
    rootReadyTarget?: HTMLElement | null,
): void {
    const hidden = !visible;
    if (visible) {
        cancelPendingRoot(marker);
        rootTargets.delete(marker);
    } else if (rootReadyTarget) {
        rootTargets.set(marker, rootReadyTarget);
    }
    if (!hidden && !marker.__tzudongRetainedMarkerAriaHidden) return;

    const element = marker.getElement();
    const markerRoot = element?.matches?.(MARKER_SELECTOR)
        ? element
        : element?.querySelector<HTMLElement>(MARKER_SELECTOR);
    // The review bubble is a sibling of the marker inside this app-owned
    // anchor, so hide the complete overlay rather than only its image node.
    const root = markerRoot?.closest<HTMLElement>(OVERLAY_SELECTOR) ?? markerRoot;
    if (!root) {
        marker.__tzudongRetainedMarkerAriaHidden = hidden;
        const target = rootTargets.get(marker);
        if (hidden && target) watchPendingRoot(marker, target);
        return;
    }

    cancelPendingRoot(marker);

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
