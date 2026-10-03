import assert from "node:assert/strict";
import test from "node:test";
import {
  readImageSize, sniffImageType, decodeImageFile, createImageLoader, checkImageFile,
  MAX_IMAGE_BYTES, WORK_SIDE
} from "../../customizer/framework/image-input.js";

const bytes = (...parts) => Uint8Array.from(parts.flatMap(p => (typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : p)));
const be16 = v => [(v >> 8) & 255, v & 255];
const be32 = v => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const le16 = v => [v & 255, (v >> 8) & 255];
const le24 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const zeros = n => new Array(n).fill(0);

const png = (w, h) => bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(w), be32(h), [8, 6, 0, 0, 0], zeros(4));
const gif = (w, h) => bytes("GIF89a", le16(w), le16(h), zeros(6));
const riff = (chunk, body) => bytes("RIFF", zeros(4), "WEBP", chunk, zeros(4), body);
const webpLossy = (w, h) => riff("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]);
const webpLossless = (w, h) => {
  const v = (w - 1) | ((h - 1) << 14);
  return riff("VP8L", [0x2f, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255, zeros(5)].flat());
};
const webpExtended = (w, h) => riff("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 0, 0]);
// SOI, APP0 (JFIF), DHT, then SOF0 — the parser must skip the first two segments by length.
const jpeg = (w, h, sof = 0xc0) => bytes([0xff, 0xd8], [0xff, 0xe0], be16(16), "JFIF", [0], zeros(9), [0xff, 0xc4], be16(4), [0, 0], [0xff, sof], be16(17), [8], be16(h), be16(w), [3], zeros(9));

test("each format's declared size is read from its header", () => {
  assert.deepEqual(readImageSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(readImageSize(gif(320, 200)), { width: 320, height: 200 });
  assert.deepEqual(readImageSize(webpLossy(1000, 750)), { width: 1000, height: 750 });
  assert.deepEqual(readImageSize(webpLossless(4096, 3)), { width: 4096, height: 3 });
  assert.deepEqual(readImageSize(webpExtended(1, 16000)), { width: 1, height: 16000 });
  assert.deepEqual(readImageSize(jpeg(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepEqual(readImageSize(jpeg(800, 600, 0xc2)), { width: 800, height: 600 }, "progressive SOF2");
});

test("huge declared sizes are reported as declared (the caller rejects them)", () => {
  assert.deepEqual(readImageSize(png(30000, 30000)), { width: 30000, height: 30000 });
  assert.deepEqual(readImageSize(jpeg(65535, 65535)), { width: 65535, height: 65535 });
  assert.deepEqual(readImageSize(gif(65535, 1)), { width: 65535, height: 1 });
});

test("truncated, zero-size, garbage and unsupported headers give null", () => {
  for (const b of [png(10, 10), gif(10, 10), webpLossy(10, 10), webpLossless(10, 10), webpExtended(10, 10), jpeg(10, 10)]) {
    assert.equal(readImageSize(b.slice(0, 9)), null, "truncated");
  }
  // One byte short of the size fields each format needs.
  assert.equal(readImageSize(png(10, 10).slice(0, 23)), null);
  assert.equal(readImageSize(gif(10, 10).slice(0, 9)), null);
  assert.equal(readImageSize(webpLossy(10, 10).slice(0, 29)), null);
  assert.equal(readImageSize(webpExtended(10, 10).slice(0, 29)), null);
  assert.equal(readImageSize(jpeg(10, 10).slice(0, 32)), null, "JPEG cut inside the frame header (SOF starts at 26)");
  assert.equal(readImageSize(png(0, 10)), null);
  assert.equal(readImageSize(gif(10, 0)), null);
  assert.equal(readImageSize(Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919) % 251)), null, "garbage");
  assert.equal(readImageSize(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")), null, "SVG stays out");
  assert.equal(readImageSize(new Uint8Array(0)), null);
  // JPEG: a zero segment length, a scan before any frame, and a frame marker never reached.
  assert.equal(readImageSize(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), null);
  assert.equal(readImageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0, 8, ...zeros(8)])), null);
  assert.equal(readImageSize(bytes([0xff, 0xd8], ...Array.from({ length: 20000 }, () => [0xff, 0xe1, 0, 2]))), null, "bounded walk");
  assert.equal(readImageSize(bytes([0xff, 0xd8, 0xff], zeros(100))), null, "not a marker");
  // WebP chunks with a bad signature.
  const bad = webpLossy(10, 10); bad[23] = 0; assert.equal(readImageSize(bad), null);
  const badL = webpLossless(10, 10); badL[20] = 0; assert.equal(readImageSize(badL), null);
});

test("the type is sniffed from the bytes, not the claimed MIME type", () => {
  assert.equal(sniffImageType(png(1, 1)), "image/png");
  assert.equal(sniffImageType(jpeg(1, 1)), "image/jpeg");
  assert.equal(sniffImageType(gif(1, 1)), "image/gif");
  assert.equal(sniffImageType(webpExtended(1, 1)), "image/webp");
  assert.equal(sniffImageType(bytes("<svg")), null);
  assert.deepEqual(readImageSize(png(5, 6), "image/jpeg"), { width: 5, height: 6 }, "a wrong hint is ignored");
});

// Fake decoder and canvas: the browser APIs the decode path uses.
function fakes(bitmapSize) {
  const calls = [];
  const decode = async (file, options) => { calls.push(options); return { ...(bitmapSize ?? {}), close() { calls.closed = true; } }; };
  const makeCanvas = (w, h) => ({ width: w, height: h, getContext: () => ({ drawImage() {}, getImageData: (x, y, cw, ch) => ({ data: new Uint8ClampedArray(cw * ch * 4) }) }) });
  return { calls, decode, makeCanvas };
}
const fileOf = (b, type = "") => new File([b], "picked", { type });

test("an oversized declared image is refused before anything is decoded", async () => {
  for (const b of [png(30000, 30000), png(4097, 10), jpeg(10, 5000), webpExtended(8000, 8000), gif(5000, 1)]) {
    const { calls, decode, makeCanvas } = fakes({ width: 10, height: 10 });
    await assert.rejects(() => decodeImageFile(fileOf(b, "image/png"), { decode, makeCanvas }), /too large/i);
    assert.equal(calls.length, 0, "the decoder was never called");
  }
});

test("files that aren't a sniffable image, or whose size can't be read, are refused without decoding", async () => {
  const { calls, decode, makeCanvas } = fakes({ width: 10, height: 10 });
  await assert.rejects(() => decodeImageFile(fileOf(bytes("<svg/>"), "image/svg+xml"), { decode, makeCanvas }), /isn't a PNG, JPEG, WebP or GIF/);
  await assert.rejects(() => decodeImageFile(fileOf(bytes("hello"), "image/png"), { decode, makeCanvas }), /isn't a PNG/);
  await assert.rejects(() => decodeImageFile(fileOf(png(10, 10).slice(0, 14), "image/png"), { decode, makeCanvas }), /size couldn't be read/);
  await assert.rejects(() => decodeImageFile(fileOf(new Uint8Array(0)), { decode, makeCanvas }), /empty/);
  assert.equal(calls.length, 0);
});

test("a size-OK image is decoded resized by the browser, long side at most 512, aspect kept", async () => {
  const wide = fakes({ width: 512, height: 384 });
  const out = await decodeImageFile(fileOf(png(4000, 3000)), wide);   // type "" (as Windows may report for .webp)
  assert.deepEqual(wide.calls[0], { resizeWidth: WORK_SIDE, resizeQuality: "low" });
  assert.equal(wide.calls.closed, true, "the bitmap is released");
  assert.deepEqual([out.width, out.height, out.sourceWidth, out.sourceHeight], [512, 384, 4000, 3000]);
  assert.equal(out.pixels.length, 512 * 384 * 4);
  const tall = fakes({ width: 100, height: 400 });
  await decodeImageFile(fileOf(webpLossless(100, 400), "image/webp"), tall);
  assert.deepEqual(tall.calls[0], { resizeHeight: 400, resizeQuality: "low" }, "small images keep their size");
  // A decoder that ignores the resize request still ends up drawn at most 512 px.
  const ignores = fakes({ width: 3000, height: 1000 });
  const big = await decodeImageFile(fileOf(jpeg(3000, 1000)), ignores);
  assert.deepEqual([big.width, big.height], [512, 171]);
});

test("a JPEG whose EXIF/ICC segments push the frame header past 64 KB is still sized from its header", async () => {
  // Camera and phone JPEGs carry large APP1 (EXIF, XMP) and APP2 (ICC) segments before the SOF.
  // Each segment is at most 65535 bytes, so two near-full ones put the frame header beyond 64 KB.
  const app = marker => [[0xff, marker], be16(65533), zeros(65531)];
  const big = bytes([0xff, 0xd8], ...app(0xe1), ...app(0xe2), [0xff, 0xc0], be16(17), [8], be16(900), be16(1200), [3], zeros(9));
  assert.deepEqual([big[131072], big[131073]], [0xff, 0xc0], "the SOF starts at 128 KB, beyond the first 64 KB");
  const { calls, decode, makeCanvas } = fakes({ width: 512, height: 384 });
  const out = await decodeImageFile(fileOf(big, "image/jpeg"), { decode, makeCanvas });
  assert.deepEqual([out.sourceWidth, out.sourceHeight], [1200, 900]);
  assert.deepEqual(calls[0], { resizeWidth: WORK_SIDE, resizeQuality: "low" });
});

test("a decoder failure is a readable error", async () => {
  await assert.rejects(() => decodeImageFile(fileOf(png(10, 10)), { decode: async () => { throw new DOMException("bad"); }, makeCanvas: fakes().makeCanvas }), /couldn't be read/);
});

test("file checks: empty and over-8 MB files are refused before reading", () => {
  assert.doesNotThrow(() => checkImageFile({ size: 1000 }));
  assert.throws(() => checkImageFile({ size: MAX_IMAGE_BYTES + 1 }), /8 MB/);
  assert.throws(() => checkImageFile({ size: 0 }), /empty/);
  assert.throws(() => checkImageFile(null), /no image/i);
});

test("latest pick wins: a slower earlier decode never overwrites a later pick", async () => {
  const resolvers = {};
  const load = createImageLoader(file => new Promise((resolve, reject) => { resolvers[file] = { resolve, reject }; }));
  const first = load("first"), second = load("second");
  resolvers.second.resolve("SECOND");
  resolvers.first.resolve("FIRST");   // finishes last
  assert.deepEqual(await second, { data: "SECOND" });
  assert.deepEqual(await first, { stale: true });
  const third = load("third"), fourth = load("fourth");
  resolvers.fourth.reject(new Error("broken"));
  resolvers.third.resolve("THIRD");
  assert.deepEqual(await fourth, { error: "broken" });
  assert.deepEqual(await third, { stale: true });
});
