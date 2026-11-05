import { expect, test } from 'bun:test';
import { clearNaverDeviceLocationMarker, createNaverCancellableCallback, createNaverOneShotCallback, removeNaverMapListener } from '../lib/naver-map-event-cleanup';

test('listener removal preserves the provider receiver and handle', () => {
    const handle = { id: 'listener' };
    const events = {
        removed: null as object | null,
        removeListener(listener: object) { this.removed = listener; },
    };
    expect(removeNaverMapListener(events, handle)).toBe(true);
    expect(events.removed).toBe(handle);
});

test('absent provider or listener is safe during partial initialization', () => {
    let calls = 0;
    const events = { removeListener: () => { calls += 1; } };
    expect(removeNaverMapListener(undefined, {})).toBe(false);
    expect(removeNaverMapListener(events, null)).toBe(false);
    expect(removeNaverMapListener(events, undefined)).toBe(false);
    expect(calls).toBe(0);
});

test('one failed provider removal does not prevent the next teardown', () => {
    const attempts: number[] = [];
    const events = { removeListener: (id: number) => {
        attempts.push(id);
        if (id === 1) throw new TypeError('PROVIDER_LISTENER_CLEANUP_FAILED');
    } };
    expect(removeNaverMapListener(events, 1)).toBe(false);
    expect(removeNaverMapListener(events, 2)).toBe(true);
    expect(attempts).toEqual([1, 2]);
});

test('a retained idle handler becomes inert before callback and cannot repeat a stale correction', () => {
    let corrections = 0;
    const events = { removeListener: () => { throw new Error('PROVIDER_LISTENER_CLEANUP_FAILED'); } };
    const oneShot = createNaverOneShotCallback(() => {
        removeNaverMapListener(events, oneShot.handle);
        corrections += 1;
        oneShot.handle(); // A provider's reentrant delivery must also be inert.
    });
    oneShot.handle();
    oneShot.handle();
    expect(corrections).toBe(1);
});

test('cleanup cancels a still-pending idle correction even if the provider retains its handler', () => {
    let corrections = 0;
    const oneShot = createNaverOneShotCallback(() => { corrections += 1; });
    oneShot.cancel();
    oneShot.handle();
    expect(corrections).toBe(0);
});

test('canceled provider callbacks cannot dispatch stale props after failed listener removal', () => {
    const calls: string[] = [];
    const old = createNaverCancellableCallback(() => { calls.push('old'); });
    const current = createNaverCancellableCallback(() => { calls.push('current'); });
    const events = { removeListener: () => { throw new Error('NAVER_LISTENER_CLEANUP_FAILED'); } };
    old.cancel();
    removeNaverMapListener(events, old.handle);
    old.handle(); current.handle();
    expect(calls).toEqual(['current']);
});

test('clearing location removes its visual and retains a failed SDK handle until retry succeeds', () => {
    let attempts = 0;
    let visible = true;
    const marker = { setMap: () => {
        if (++attempts === 1) throw new Error('NAVER_MARKER_DETACH_FAILED');
    } };
    const removeVisual = () => { visible = false; };
    const pending = clearNaverDeviceLocationMarker(marker, removeVisual);
    expect(pending).toBe(marker);
    expect(visible).toBe(false);
    expect(clearNaverDeviceLocationMarker(pending, removeVisual)).toBe(null);
    expect(attempts).toBe(2);
    expect(visible).toBe(false);
});
