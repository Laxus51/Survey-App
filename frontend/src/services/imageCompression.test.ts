import { afterEach, describe, expect, it, vi } from "vitest";
import { compressImage } from "./imageCompression";

// jsdom has no canvas 2D implementation, so the browser pieces compressImage
// depends on (image decode + canvas encode) are stubbed. What's under test
// here is the encode-result handling, not canvas itself.
function stubImageDecode(width = 4000, height = 3000) {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  Object.defineProperty(globalThis.Image.prototype, "src", {
    configurable: true,
    set() {
      Object.defineProperty(this, "naturalWidth", { value: width, configurable: true });
      Object.defineProperty(this, "naturalHeight", { value: height, configurable: true });
      queueMicrotask(() => this.onload?.());
    },
  });
}

function stubCanvasToBlob(results: (Blob | null)[]) {
  let call = 0;
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    return {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (cb: BlobCallback) => {
        const next = results[Math.min(call, results.length - 1)];
        call += 1;
        queueMicrotask(() => cb(next));
      },
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compressImage", () => {
  it("never returns a zero-byte blob as a successful compression", async () => {
    // Reproduces the real mobile failure: canvas.toBlob resolves with an
    // empty Blob (not null) when encoding fails under memory pressure. An
    // empty Blob is truthy and 0 <= the 10MB cap, so this previously came
    // back as "success" and a 0-byte photo reached IndexedDB - the server
    // then rejected it forever with "The submitted file is empty."
    stubImageDecode();
    stubCanvasToBlob([new Blob([], { type: "image/jpeg" })]);

    await expect(compressImage(new Blob(["src"]))).rejects.toThrow(/no output/i);
  });

  it("treats a null encode result as a failure too", async () => {
    stubImageDecode();
    stubCanvasToBlob([null]);

    await expect(compressImage(new Blob(["src"]))).rejects.toThrow(/no output/i);
  });

  it("falls through an empty result to a later quality step that succeeds", async () => {
    stubImageDecode();
    const good = new Blob([new Uint8Array(1024)], { type: "image/jpeg" });
    stubCanvasToBlob([new Blob([], { type: "image/jpeg" }), good]);

    const result = await compressImage(new Blob(["src"]));

    expect(result.blob.size).toBe(1024);
  });

  it("returns a normal non-empty blob unchanged", async () => {
    stubImageDecode(1000, 800);
    const good = new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
    stubCanvasToBlob([good]);

    const result = await compressImage(new Blob(["src"]));

    expect(result.blob.size).toBe(2048);
    expect(result.width).toBe(1000);
    expect(result.height).toBe(800);
  });
});
