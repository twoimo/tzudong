import { afterAll, beforeEach, expect, test } from 'bun:test';
import { deferMarkerRenders } from '../lib/deferred-marker-renders';
const saved = { frame: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, channel: globalThis.MessageChannel };
let frames: FrameRequestCallback[] = [];
let tasks: Array<() => void> = [];
let closed = 0;
class FakeChannel {
  port1 = { onmessage: null as (() => void) | null, close: () => closed++ };
  port2 = { postMessage: () => tasks.push(() => this.port1.onmessage?.()), close: () => closed++ };
}
beforeEach(() => {
  frames=[];tasks=[];closed=0;
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => { frames.push(fn); return frames.length; };
  globalThis.cancelAnimationFrame = () => undefined;
  globalThis.MessageChannel = FakeChannel as unknown as typeof MessageChannel;
});
afterAll(() => { globalThis.requestAnimationFrame=saved.frame;globalThis.cancelAnimationFrame=saved.cancel;globalThis.MessageChannel=saved.channel; });
test('tail starts after paint opportunity and completes in bounded ordered tasks', () => {
  const seen:number[]=[];const finished:boolean[]=[];
  deferMarkerRenders(Array.from({length:70},(_,i)=>()=>seen.push(i)),v=>finished.push(v));
  expect(seen).toHaveLength(0);frames.shift()!(0);
  tasks.shift()!();expect(seen).toHaveLength(32);expect(finished).toHaveLength(0);
  while(tasks.length)tasks.shift()!();
  expect(seen).toEqual(Array.from({length:70},(_,i)=>i));expect(finished).toEqual([true]);expect(closed).toBe(2);
});
test('new data/unmount cancellation drops stale work and completion', () => {
  let rendered=0;let finished=0;
  const jobs=Array.from({length:70},()=>()=>rendered++);const cancel=deferMarkerRenders(jobs,()=>finished++);
  frames.shift()!(0);tasks.shift()!();cancel();
  while(tasks.length)tasks.shift()!();
  expect(rendered).toBe(32);expect(finished).toBe(0);expect(jobs).toHaveLength(0);expect(closed).toBe(2);
});
test('provider failure releases task references and requests bounded recovery', () => {
  const finished:boolean[]=[];let staleRan=false;
  const jobs=[()=>{throw Error('synthetic-provider');},()=>{staleRan=true;}];deferMarkerRenders(jobs,v=>finished.push(v));
  frames.shift()!(0);tasks.shift()!();expect(finished).toEqual([false]);expect(staleRan).toBe(false);expect(jobs).toHaveLength(0);expect(closed).toBe(2);
});
