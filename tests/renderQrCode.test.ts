import { describe, expect, it } from "vitest";
import { renderQrCode } from "../src/tools/renderQrCode.js";

describe("render_qr_code", () => {
  it("produces SVG and PNG outputs", async () => {
    const result = await renderQrCode({
      link: "shlink:/eyJ1cmwiOiJodHRwczovL21jcC50ZXN0In0",
      size: 256,
    });
    expect(result.svg).toContain("<svg");
    expect(result.pngBase64.length).toBeGreaterThan(100);
    expect(result.pngDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.link).toContain("shlink:/");
  });

  it("omits data URL when includeDataUrl=false", async () => {
    const result = await renderQrCode({
      link: "shlink:/abc",
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
      renderQrCode({ link: "shlink:/abc", size: 10 }),
    ).rejects.toThrow();
  });
});
