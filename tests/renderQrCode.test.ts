import { describe, expect, it } from "vitest";
import { renderQrCode } from "../src/tools/renderQrCode.js";

const SAMPLE_SHLINK = "shlink:/eyJ1cmwiOiJodHRwczovL21jcC50ZXN0In0";

describe("render_qr_code", () => {
  it("produces SVG and PNG outputs (universal style by default)", async () => {
    const result = await renderQrCode({ link: SAMPLE_SHLINK, size: 256 });
    expect(result.svg).toContain("<svg");
    expect(result.pngBase64.length).toBeGreaterThan(100);
    expect(result.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.style).toBe("universal");
    // Universal QR encodes the viewer URL with the shlink in the fragment.
    expect(result.encoded).toContain("viewer.commonhealth.org");
    expect(result.encoded).toContain("shlink:/");
  });

  it("style=raw encodes only the shlink:/ URI", async () => {
    const result = await renderQrCode({ link: SAMPLE_SHLINK, style: "raw" });
    expect(result.encoded.startsWith("shlink:/")).toBe(true);
    expect(result.encoded).not.toContain("viewer");
  });

  it("style=viewer_wrapped + custom viewer URL", async () => {
    const result = await renderQrCode({
      link: SAMPLE_SHLINK,
      style: "viewer_wrapped",
      viewer: "https://demo.vaxx.link/viewer",
    });
    expect(result.encoded).toContain("demo.vaxx.link/viewer");
    expect(result.encoded).toContain("#shlink:/");
  });

  it("extracts shlink from a viewer-wrapped input URL", async () => {
    const wrapped = `https://viewer.commonhealth.org/#${SAMPLE_SHLINK}`;
    const result = await renderQrCode({ link: wrapped, style: "raw" });
    expect(result.encoded).toBe(SAMPLE_SHLINK);
  });

  it("omits data URL when includeDataUrl=false", async () => {
    const result = await renderQrCode({
      link: SAMPLE_SHLINK,
      size: 128,
      includeDataUrl: false,
    });
    expect(result.pngDataUrl).toBeUndefined();
    expect(result.pngBase64.length).toBeGreaterThan(0);
  });

  it("rejects empty input", async () => {
    await expect(renderQrCode({ link: "" })).rejects.toThrow();
  });

  it("rejects out-of-range size", async () => {
    await expect(
      renderQrCode({ link: SAMPLE_SHLINK, size: 10 }),
    ).rejects.toThrow();
  });
});
