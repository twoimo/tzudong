type VisualViewportOffsetInput = {
    layoutViewportHeight: number;
    visualViewportHeight: number;
    visualViewportOffsetTop?: number;
};

export function calculateVisualViewportBottomOffset({
    layoutViewportHeight,
    visualViewportHeight,
    visualViewportOffsetTop = 0,
}: VisualViewportOffsetInput) {
    return Math.max(0, layoutViewportHeight - visualViewportHeight - visualViewportOffsetTop);
}
