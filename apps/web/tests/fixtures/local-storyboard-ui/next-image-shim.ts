// Use the real Next image component through its named export: the CJS default
// entry relies on Next's bundler interop, which this isolated Bun harness lacks.
export { Image as default } from "next/dist/client/image-component.js";
