import { describe, expect, test } from 'bun:test';

import {
  DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP,
  getDesktopReviewMapPanelKeyboardDelta,
} from '../components/reviews/ReviewModal';

describe('review modal desktop map-panel helpers', () => {
  test('maps arrow keys to predictable one-step panel movement', () => {
    expect(getDesktopReviewMapPanelKeyboardDelta('ArrowLeft')).toEqual({
      x: -DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP,
      y: 0,
    });
    expect(getDesktopReviewMapPanelKeyboardDelta('ArrowRight')).toEqual({
      x: DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP,
      y: 0,
    });
    expect(getDesktopReviewMapPanelKeyboardDelta('ArrowUp')).toEqual({
      x: 0,
      y: -DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP,
    });
    expect(getDesktopReviewMapPanelKeyboardDelta('ArrowDown')).toEqual({
      x: 0,
      y: DESKTOP_REVIEW_MAP_PANEL_KEYBOARD_STEP,
    });
  });

  test('ignores non-movement keys and supports custom step sizes', () => {
    expect(getDesktopReviewMapPanelKeyboardDelta('Escape')).toBeNull();
    expect(getDesktopReviewMapPanelKeyboardDelta('ArrowRight', 8)).toEqual({
      x: 8,
      y: 0,
    });
  });
});
