import { expect, test } from 'bun:test';
import { syncRetainedMarkerAccessibility } from '../lib/retained-marker-accessibility';

class AppMarkerElement {
    attributes = new Map<string, string>();
    matches(selector: string) { return selector === '[data-testid="marker"]'; }
    querySelector() { return null; }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
}
function fixture(root: AppMarkerElement | null) {
    return { getElement: () => root as unknown as HTMLElement | null, __tzudongRetainedMarkerAriaHidden: undefined as boolean | undefined };
}
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
    syncRetainedMarkerAccessibility(marker,false);expect(marker.__tzudongRetainedMarkerAriaHidden).toBeUndefined();
    current=root;syncRetainedMarkerAccessibility(marker,false);expect(root.getAttribute('aria-hidden')).toBe('true');
    current=null;syncRetainedMarkerAccessibility(marker,true);expect(marker.__tzudongRetainedMarkerAriaHidden).toBe(false);
});
test('an SDK root replacement with the same desired state is masked again', () => {
    const before=new AppMarkerElement(),after=new AppMarkerElement();let current=before;
    const marker={getElement:()=>current as unknown as HTMLElement,__tzudongRetainedMarkerAriaHidden:undefined as boolean|undefined};
    syncRetainedMarkerAccessibility(marker,false);current=after;
    syncRetainedMarkerAccessibility(marker,false);
    expect(after.getAttribute('aria-hidden')).toBe('true');
    expect(after.getAttribute('data-tzudong-retained-marker-hidden')).toBe('true');
});
