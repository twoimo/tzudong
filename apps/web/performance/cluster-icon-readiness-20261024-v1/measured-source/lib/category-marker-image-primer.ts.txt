import { getCategoryMarkerImages } from './cluster-marker';

/**
 * Start the finite category inventory while the map/restaurant data is loading.
 * A connected, hidden picture lets the browser choose the same WebP/PNG resource
 * as a visible marker. Keeping the pictures until unmount retains their decoded
 * images without adding another asynchronous writer to MarkerPool.
 * This is best effort: opening a cluster never waits for the primer.
 */
export function primeCategoryMarkerImages(doc: Document): () => void {
  const container = doc.createElement('div');
  container.hidden = true;
  container.setAttribute('aria-hidden', 'true');
  container.dataset.categoryMarkerPrimer = '';
  const images = getCategoryMarkerImages().map(asset => {
    const picture = doc.createElement('picture');
    const source = doc.createElement('source');
    source.type = 'image/webp';
    source.srcset = asset.webp;
    const image = doc.createElement('img');
    image.alt = '';
    image.width = image.height = 32;
    image.decoding = 'async';
    image.loading = 'eager';
    image.fetchPriority = 'low';
    image.src = asset.png;
    picture.append(source, image);
    container.append(picture);
    return image;
  });
  doc.body.append(container);
  for (const image of images) {
    // A failed resource remains the normal marker's responsibility. No retry,
    // timer, SDK mutation or callback can outlive this map instance.
    void image.decode().catch(() => {});
  }
  return () => container.remove();
}
