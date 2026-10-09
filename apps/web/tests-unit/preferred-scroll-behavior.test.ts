import { afterEach, describe, expect, test } from 'bun:test';
import { preferredScrollBehavior } from '../lib/motion/scroll-behavior';
const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('programmatic scroll motion preference', () => {
  test('remains immediate outside the browser', () => {
    Reflect.deleteProperty(globalThis, 'window');
    expect(preferredScrollBehavior()).toBe('auto');
  });
  test('reduces motion and responds to preference changes between actions', () => {
    let reduce = true;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      matchMedia: (query: string) => {
        expect(query).toBe('(prefers-reduced-motion: reduce)');
        return { matches: reduce };
      },
    } });
    expect(preferredScrollBehavior()).toBe('auto');
    reduce = false;
    expect(preferredScrollBehavior()).toBe('smooth');
    reduce = true;
    expect(preferredScrollBehavior()).toBe('auto');
  });
});
