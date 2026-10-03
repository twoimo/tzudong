import { afterAll, beforeEach, expect, test } from 'bun:test';
import { syncRetainedMarkerAccessibility } from '../lib/retained-marker-accessibility';

class AppMarkerElement {
    attributes = new Map<string, string>();
    matches(selector: string) { return selector === '[data-testid="marker"]'; }
    querySelector() { return null; }
    closest() { return null; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
}
function fixture(root: AppMarkerElement | null) {
    return { getElement: () => root as unknown as HTMLElement | null, __tzudongRetainedMarkerAriaHidden: undefined as boolean | undefined };
}
const savedObserver = globalThis.MutationObserver;
class FakeObserver {
    static instances: FakeObserver[] = [];
    disconnected = false;
    constructor(private callback: MutationCallback) { FakeObserver.instances.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
    fire() { if (!this.disconnected) this.callback([], this as unknown as MutationObserver); }
}
beforeEach(() => {
    FakeObserver.instances = [];
    globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
});
afterAll(() => { globalThis.MutationObserver = savedObserver; });
test('outside-padded mask is owned, reversible and has no geometry or focus changes', () => {
    const root = new AppMarkerElement();root.setAttribute('role','button');root.setAttribute('style','width:28px');
    const marker = fixture(root);
    syncRetainedMarkerAccessibility(marker,false);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('data-tzudong-retained-marker-hidden')).toBe('true');
    expect(root.getAttribute('role')).toBe('button');expect(root.getAttribute('style')).toBe('width:28px');
    expect(root.getAttribute('tabindex')).toBeNull();
    syncRetainedMarkerAccessibility(marker,true);
    expect(root.getAttribute('aria-hidden')).toBeNull();expect(root.getAttribute('data-tzudong-retained-marker-hidden')).toBeNull();
    expect(marker.__tzudongRetainedMarkerAriaHidden).toBe(false);
});
test('does not remove a hidden state owned by another source', () => {
    const root = new AppMarkerElement();root.setAttribute('aria-hidden','true');const marker=fixture(root);
    syncRetainedMarkerAccessibility(marker,false);syncRetainedMarkerAccessibility(marker,true);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('data-tzudong-retained-marker-hidden')).toBeNull();
});
test('release/replacement cleanup allows the newly generated SDK root to be masked', () => {
    const before=new AppMarkerElement(),after=new AppMarkerElement();let current=before;
    const marker={getElement:()=>current as unknown as HTMLElement,__tzudongRetainedMarkerAriaHidden:undefined as boolean|undefined};
    syncRetainedMarkerAccessibility(marker,false);syncRetainedMarkerAccessibility(marker,true);current=after;
    syncRetainedMarkerAccessibility(marker,false);
    expect(before.getAttribute('aria-hidden')).toBeNull();expect(after.getAttribute('aria-hidden')).toBe('true');
});
test('SDK root not yet present stays retryable; removed root clears release ownership', () => {
    const root=new AppMarkerElement();let current:AppMarkerElement|null=null;
    const marker={getElement:()=>current as unknown as HTMLElement|null,__tzudongRetainedMarkerAriaHidden:undefined as boolean|undefined};
    syncRetainedMarkerAccessibility(marker,false);expect(marker.__tzudongRetainedMarkerAriaHidden).toBe(true);
    current=root;syncRetainedMarkerAccessibility(marker,false);expect(root.getAttribute('aria-hidden')).toBe('true');
    current=null;syncRetainedMarkerAccessibility(marker,true);expect(marker.__tzudongRetainedMarkerAriaHidden).toBe(false);
});
test('delayed SDK roots share one observer and are masked on insertion without another render', () => {
    const target={} as HTMLElement;let one:AppMarkerElement|null=null,two:AppMarkerElement|null=null;
    const a={getElement:()=>one as unknown as HTMLElement|null},b={getElement:()=>two as unknown as HTMLElement|null};
    syncRetainedMarkerAccessibility(a,false,target);syncRetainedMarkerAccessibility(b,false,target);
    expect(FakeObserver.instances).toHaveLength(1);const observer=FakeObserver.instances[0];
    one=new AppMarkerElement();observer.fire();expect(one.getAttribute('aria-hidden')).toBe('true');expect(observer.disconnected).toBe(false);
    two=new AppMarkerElement();observer.fire();expect(two.getAttribute('aria-hidden')).toBe('true');expect(observer.disconnected).toBe(true);
    syncRetainedMarkerAccessibility(a,true);syncRetainedMarkerAccessibility(b,true);
});
test('visible/released marker cancels a pending root and does not later hide a replacement', () => {
    const target={} as HTMLElement;let root:AppMarkerElement|null=null;const marker={getElement:()=>root as unknown as HTMLElement|null};
    syncRetainedMarkerAccessibility(marker,false,target);const observer=FakeObserver.instances[0];
    syncRetainedMarkerAccessibility(marker,true);expect(observer.disconnected).toBe(true);
    root=new AppMarkerElement();observer.fire();expect(root.getAttribute('aria-hidden')).toBeNull();
});
test('changing map target disconnects the old pending observer', () => {
    const first={} as HTMLElement,second={} as HTMLElement;let root:AppMarkerElement|null=null;const marker={getElement:()=>root as unknown as HTMLElement|null};
    syncRetainedMarkerAccessibility(marker,false,first);const old=FakeObserver.instances[0];
    syncRetainedMarkerAccessibility(marker,false,second);expect(old.disconnected).toBe(true);expect(FakeObserver.instances).toHaveLength(2);
    root=new AppMarkerElement();old.fire();expect(root.getAttribute('aria-hidden')).toBeNull();FakeObserver.instances[1].fire();expect(root.getAttribute('aria-hidden')).toBe('true');
    syncRetainedMarkerAccessibility(marker,true);
});
test('an SDK root replacement with the same desired state is masked again', () => {
    const before=new AppMarkerElement(),after=new AppMarkerElement();let current=before;
    const marker={getElement:()=>current as unknown as HTMLElement,__tzudongRetainedMarkerAriaHidden:undefined as boolean|undefined};
    syncRetainedMarkerAccessibility(marker,false);current=after;
    syncRetainedMarkerAccessibility(marker,false);
    expect(after.getAttribute('aria-hidden')).toBe('true');
    expect(after.getAttribute('data-tzudong-retained-marker-hidden')).toBe('true');
});
test('hides the app overlay anchor containing a sibling review button and restores it', () => {
    const anchor=new AppMarkerElement(),root=new AppMarkerElement();
    root.closest=()=>anchor as never;
    anchor.setAttribute('data-visible-marker-review-bubble-anchor','true');
    const marker=fixture(root);syncRetainedMarkerAccessibility(marker,false);
    expect(anchor.getAttribute('aria-hidden')).toBe('true');
    expect(anchor.getAttribute('data-tzudong-retained-marker-hidden')).toBe('true');
    expect(root.getAttribute('aria-hidden')).toBeNull();
    syncRetainedMarkerAccessibility(marker,true);
    expect(anchor.getAttribute('aria-hidden')).toBeNull();
    expect(anchor.getAttribute('data-visible-marker-review-bubble-anchor')).toBe('true');
});
