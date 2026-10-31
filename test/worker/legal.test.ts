import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("public pages", () => {
  it("serves the pages linked from the Google consent screen", async () => {
    const about = await exports.default.fetch(new Request("http://kaiwa.test/about"));
    expect(about.status).toBe(200);
    expect(about.headers.get("Content-Type")).toContain("text/html");
    const aboutHtml = await about.text();
    expect(aboutHtml).toContain('href="/privacy"');
    expect(aboutHtml).toContain('href="/terms"');

    const privacy = await exports.default.fetch(new Request("http://kaiwa.test/privacy"));
    expect(await privacy.text()).toContain("akimasa.sugai@saedgewell.com");
  });
});
