import { describe, expect, test } from 'bun:test';

import {
  PROCESSING_INVENTORY,
  PROCESSING_INVENTORY_BY_CLASS,
} from '../lib/privacy/processing-inventory';

const EXPECTED_CLASSES = [
  'auth_identity',
  'profile',
  'user_content',
  'browser_drafts',
  'ocr_receipt_data',
  'device_location',
  'business_location',
  'consent_age_marketing',
  'notifications',
  'service_runtime_metadata',
  'privacy_requests_incidents',
] as const;

describe('privacy processing inventory', () => {
  test('covers each current processing class exactly once', () => {
    const classes = PROCESSING_INVENTORY.map((item) => item.dataClass);

    expect(classes).toEqual(EXPECTED_CLASSES);
    expect(new Set(classes).size).toBe(classes.length);
  });

  test('indexes every processing class back to the same inventory item', () => {
    for (const item of PROCESSING_INVENTORY) {
      expect(PROCESSING_INVENTORY_BY_CLASS[item.dataClass]).toBe(item);
    }

    expect(Object.keys(PROCESSING_INVENTORY_BY_CLASS)).toEqual([...EXPECTED_CLASSES]);
    expect(PROCESSING_INVENTORY_BY_CLASS['not-a-real-class']).toBeUndefined();
  });

  test('keeps all required descriptive fields and collections non-empty', () => {
    for (const item of PROCESSING_INVENTORY) {
      expect(item.dataClass.trim().length).toBeGreaterThan(0);
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.purpose.trim().length).toBeGreaterThan(0);
      expect(item.source.trim().length).toBeGreaterThan(0);
      expect(item.providerBoundary.trim().length).toBeGreaterThan(0);
      expect(item.retention.trim().length).toBeGreaterThan(0);
      expect(item.deletion.trim().length).toBeGreaterThan(0);
      expect(item.fields.length).toBeGreaterThan(0);
      expect(item.sink.length).toBeGreaterThan(0);
      expect(item.fields.every((field) => field.trim().length > 0)).toBe(true);
      expect(item.sink.every((sink) => sink.trim().length > 0)).toBe(true);
    }
  });

  test('keeps every current item behind operator approval or deployed readback', () => {
    const states = PROCESSING_INVENTORY.map((item) => item.operatorState);

    expect(states.every((state) => (
      state === 'pending_operator_approval'
      || state === 'blocked_until_deployed_readback'
    ))).toBe(true);
    expect(states).not.toContain('observed_candidate_boundary');
  });

  test('keeps precise device location gated by its external prerequisite', () => {
    const deviceLocation = PROCESSING_INVENTORY_BY_CLASS.device_location;

    expect(deviceLocation.fields).toContain('위도·경도');
    expect(deviceLocation.sink).toEqual(['현재 지도 React 메모리 상태']);
    expect(deviceLocation.operatorState).toBe('blocked_until_deployed_readback');
    expect(deviceLocation.externalPrerequisite).toContain('단말 외 처리');
    expect(deviceLocation.externalPrerequisite).toContain('활성화하지 않습니다');
  });

  test('does not attach an external prerequisite to unrelated processing classes', () => {
    for (const item of PROCESSING_INVENTORY) {
      if (item.dataClass === 'device_location') continue;
      expect(item.externalPrerequisite).toBeUndefined();
    }
  });
});
