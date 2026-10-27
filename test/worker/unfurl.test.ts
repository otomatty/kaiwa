import { describe, expect, it } from "vitest";
import { extractMeta, safeUrl } from "../../src/worker/routes/unfurl";
import { signup } from "./helpers";

describe("link previews", () => {
  it("extracts OpenGraph metadata with fallbacks", async () => {
    const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Kaiwa &amp; Friends">
      <meta name="description" content="チームの会話をひとつに">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Example">
    </head><body>hi</body></html>`;
    const meta = await extractMeta(
      new Response(html, { headers: { "Content-Type": "text/html" } }),
      new URL("https://example.com/post/1"),
    );
    expect(meta).toEqual({
      title: "Kaiwa & Friends",
      description: "チームの会話をひとつに",
      siteName: "Example",
      image: "https://example.com/img/cover.png",
    });

    const plain = await extractMeta(
      new Response("<html><head><title> Only title </title></head></html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new URL("https://news.example.org/"),
    );
    expect(plain).toMatchObject({ title: "Only title", siteName: "news.example.org", image: null });
  });

  it("refuses local and private targets", () => {
    expect(safeUrl("https://example.com/a")).not.toBeNull();
    for (const bad of [
      "http://localhost:8787/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/",
      "ftp://example.com/",
      "javascript:alert(1)",
      "https://user:pass@example.com/",
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });

  it("requires authentication and a valid URL", async () => {
    const c = await signup("u");
    expect((await c.get("/unfurl?url=http://127.0.0.1/")).status).toBe(400);
  });
});
