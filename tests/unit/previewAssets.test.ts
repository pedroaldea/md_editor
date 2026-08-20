import { describe, expect, it, vi } from "vitest";
import {
  getLocalPreviewAsset,
  resolveLocalAssetPath,
  resolvePreviewImageSource,
  rewritePreviewImageSources
} from "../../src/lib/previewAssets";

describe("preview image assets", () => {
  it("resolves relative paths against the open Markdown document", () => {
    expect(resolveLocalAssetPath("/workspace/notes/brief.md", "../images/diagram.png")).toBe(
      "/workspace/images/diagram.png"
    );
  });

  it("converts encoded local paths and preserves their suffix", () => {
    const convert = vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`);
    const result = resolvePreviewImageSource(
      "assets/process%20map.svg#overview",
      "/workspace/brief.md",
      convert
    );

    expect(convert).toHaveBeenCalledWith("/workspace/assets/process map.svg");
    expect(result).toBe("asset://localhost/%2Fworkspace%2Fassets%2Fprocess%20map.svg#overview");
  });

  it.each([
    "https://example.com/diagram.png",
    "data:image/png;base64,AAAA",
    "blob:https://example.com/id",
    "asset://localhost/image.png",
    "//cdn.example.com/image.png"
  ])("does not rewrite non-local source %s", (source) => {
    const convert = vi.fn((path: string) => path);
    expect(resolvePreviewImageSource(source, "/workspace/brief.md", convert)).toBe(source);
    expect(convert).not.toHaveBeenCalled();
  });

  it("resolves an absolute local image before the Markdown file is saved", () => {
    expect(resolvePreviewImageSource("/tmp/diagram.png", null, (path) => `asset://${path}`)).toBe(
      "asset:///tmp/diagram.png"
    );
  });

  it("keeps only the fragment when a local image needs an embedded fallback", () => {
    expect(getLocalPreviewAsset("assets/map.png?cache=1#step", "/workspace/brief.md")).toEqual({
      absolutePath: "/workspace/assets/map.png",
      suffix: "?cache=1#step",
      fragment: "#step"
    });
  });

  it("rewrites every preview image before rendering and enables lazy decoding", () => {
    const html = rewritePreviewImageSources(
      '<p><img src="assets/one.png" alt="One"><img src="https://example.com/two.png" alt="Two"></p>',
      (source) => source.startsWith("assets/") ? `asset://localhost/${source}` : source
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const images = host.querySelectorAll("img");

    expect(images[0].getAttribute("src")).toBe("asset://localhost/assets/one.png");
    expect(images[0].dataset.previewSource).toBe("assets/one.png");
    expect(images[0].getAttribute("loading")).toBe("lazy");
    expect(images[0].getAttribute("decoding")).toBe("async");
    expect(images[1].getAttribute("src")).toBe("https://example.com/two.png");
  });
});
