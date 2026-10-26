import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "src/components/studio-page.tsx"), "utf8");
const globalCss = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

describe("AI Studio professional dark workspace", () => {
  it("uses a dedicated cinematic workspace with control and preview regions", () => {
    expect(source).toContain("studio-pro-shell");
    expect(source).toContain("Control panel");
    expect(source).toContain("Generator workspace");
    expect(source).toContain("latestWithOutput");
    expect(source).toContain("lg:grid-cols-[360px_minmax(0,1fr)]");
  });

  it("keeps generation, upload, top-up, history and private output behavior", () => {
    expect(source).toContain('fetch("/api/studio/generations"');
    expect(source).toContain('fetch("/api/studio/reference"');
    expect(source).toContain('fetch("/api/studio/top-ups"');
    expect(source).toContain("generationFailureMessage(result)");
    expect(source).toContain("/api/studio/outputs/${output.id}");
    expect(source).toContain("Top Up 100 Credits");
  });

  it("clears unsupported reference files and uploads only for supported models", () => {
    expect(source).toContain("if (selected && !selected.supportsReferenceImage) setReference(null)");
    expect(source).toContain("if (reference && selected.supportsReferenceImage)");
  });

  it("previews every generated output with distinct accessible downloads", () => {
    expect(source).toContain("item.outputs.map((output, outputIndex)");
    expect(source).toContain("`Hasil AI Studio ${outputIndex + 1}`");
    expect(source).toContain("`Unduh output ${outputIndex + 1}`");
  });

  it("prevents conflicting top-up and generation requests", () => {
    expect(source).toContain("disabled={topUpBusy || busy || deletingId !== null}");
    expect(source).toContain("disabled={busy || topUpBusy || deletingId !== null || credits < cost}");
  });

  it("provides responsive and accessible feedback", () => {
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('aria-busy={busy}');
    expect(source).toContain("sm:grid-cols-2");
    expect(source).toContain("xl:grid-cols-3");
    expect(globalCss).toContain("prefers-reduced-motion");
    expect(globalCss).toContain(".studio-pro-download");
    expect(globalCss).toContain("min-height: 44px");
    expect(source).not.toContain('studio-pro-shell min-h-screen overflow-hidden');
  });

  it("preserves existing narrow mobile purchase and chat layouts", () => {
    expect(globalCss).toContain(".chat-composer { flex-wrap: wrap; }");
    expect(globalCss).toContain(".chat-composer textarea { flex-basis: 100%; }");
    expect(globalCss).toContain(".product-purchase-bar > div { flex: 1.4; min-width: 0; }");
    expect(globalCss).toContain(".product-purchase-bar > div > button");
  });
});
