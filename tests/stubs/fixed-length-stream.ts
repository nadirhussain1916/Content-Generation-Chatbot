// FixedLengthStream is a Cloudflare Workers runtime global used by videoStitch's
// read-back fallback (R2 requires a known-length body). Node/vitest doesn't provide
// it, so polyfill it with an identity TransformStream — length enforcement isn't
// needed for the mocked tests, only the { readable, writable } shape.
if (typeof (globalThis as unknown as { FixedLengthStream?: unknown }).FixedLengthStream === 'undefined') {
  (globalThis as unknown as { FixedLengthStream: unknown }).FixedLengthStream = class FixedLengthStream {
    readable: ReadableStream;
    writable: WritableStream;
    constructor(_length: number) {
      const ts = new TransformStream();
      this.readable = ts.readable;
      this.writable = ts.writable;
    }
  };
}
