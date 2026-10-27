import { describe, expect, it } from "vitest";
import { extractMentions, isJumboEmoji, parse, parseInline, toPlainText } from "./mrkdwn";

describe("parseInline", () => {
  it("parses bold, italic, strike and code", () => {
    expect(parseInline("*b* _i_ ~s~ `c`")).toEqual([
      { t: "bold", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "i" }] },
      { t: "text", v: " " },
      { t: "strike", c: [{ t: "text", v: "s" }] },
      { t: "text", v: " " },
      { t: "code", v: "c" },
    ]);
  });

  it("supports markdown-style double markers", () => {
    expect(parseInline("**bold** and ~~gone~~")).toEqual([
      { t: "bold", c: [{ t: "text", v: "bold" }] },
      { t: "text", v: " and " },
      { t: "strike", c: [{ t: "text", v: "gone" }] },
    ]);
  });

  it("formats inside Japanese text without spaces", () => {
    expect(parseInline("これは*太字*です")).toEqual([
      { t: "text", v: "これは" },
      { t: "bold", c: [{ t: "text", v: "太字" }] },
      { t: "text", v: "です" },
    ]);
  });

  it("leaves snake_case and arithmetic alone", () => {
    expect(parseInline("my_var_name")).toEqual([{ t: "text", v: "my_var_name" }]);
    expect(parseInline("2*3*4")).toEqual([{ t: "text", v: "2*3*4" }]);
    expect(parseInline("* not bold *")).toEqual([{ t: "text", v: "* not bold *" }]);
  });

  it("nests formatting", () => {
    expect(parseInline("*bold _and italic_*")).toEqual([
      {
        t: "bold",
        c: [
          { t: "text", v: "bold " },
          { t: "italic", c: [{ t: "text", v: "and italic" }] },
        ],
      },
    ]);
  });

  it("does not format inside code", () => {
    expect(parseInline("`*x*`")).toEqual([{ t: "code", v: "*x*" }]);
  });

  it("parses mentions, channels and specials", () => {
    expect(parseInline("hi <@U123> see <#C9> <!here>")).toEqual([
      { t: "text", v: "hi " },
      { t: "user", id: "U123" },
      { t: "text", v: " see " },
      { t: "channel", id: "C9" },
      { t: "text", v: " " },
      { t: "special", v: "here" },
    ]);
  });

  it("auto-links URLs and trims trailing punctuation", () => {
    expect(parseInline("見て https://example.com/a?b=1。")).toEqual([
      { t: "text", v: "見て " },
      { t: "link", url: "https://example.com/a?b=1", c: [{ t: "text", v: "https://example.com/a?b=1" }] },
      { t: "text", v: "。" },
    ]);
  });

  it("parses labelled links", () => {
    expect(parseInline("<https://example.com|*Example*>")).toEqual([
      { t: "link", url: "https://example.com", c: [{ t: "bold", c: [{ t: "text", v: "Example" }] }] },
    ]);
  });

  it("supports backslash escapes", () => {
    expect(parseInline("\\*not bold\\* and ¯\\\\\\_(ツ)\\_/¯")).toEqual([
      { t: "text", v: "*not bold* and ¯\\_(ツ)_/¯" },
    ]);
  });

  it("parses emoji shortcodes", () => {
    expect(parseInline("ok :thumbsup: :+1:")).toEqual([
      { t: "text", v: "ok " },
      { t: "emoji", name: "thumbsup" },
      { t: "text", v: " " },
      { t: "emoji", name: "+1" },
    ]);
  });

  it("does not treat a time like 10:30:00 as emoji", () => {
    expect(parseInline("at 10:30:00")).toEqual([{ t: "text", v: "at 10:30:00" }]);
  });
});

describe("parse (blocks)", () => {
  it("parses fenced code blocks", () => {
    expect(parse("before\n```\nconst a = *1*;\n```\nafter")).toEqual([
      { t: "p", c: [{ t: "text", v: "before" }] },
      { t: "pre", v: "const a = *1*;" },
      { t: "p", c: [{ t: "text", v: "after" }] },
    ]);
  });

  it("parses single-line fences", () => {
    expect(parse("```x = 1```")).toEqual([{ t: "pre", v: "x = 1" }]);
  });

  it("parses quotes", () => {
    expect(parse("> quoted\n> more\nnormal")).toEqual([
      { t: "quote", c: [{ t: "p", c: [{ t: "text", v: "quoted" }, { t: "br" }, { t: "text", v: "more" }] }] },
      { t: "p", c: [{ t: "text", v: "normal" }] },
    ]);
  });

  it("parses bullet and ordered lists", () => {
    expect(parse("- a\n- *b*\n1. one\n2. two")).toEqual([
      { t: "ul", items: [[{ t: "text", v: "a" }], [{ t: "bold", c: [{ t: "text", v: "b" }] }]] },
      { t: "ol", start: 1, items: [[{ t: "text", v: "one" }], [{ t: "text", v: "two" }]] },
    ]);
  });

  it("keeps line breaks within a paragraph", () => {
    expect(parse("a\nb")).toEqual([
      { t: "p", c: [{ t: "text", v: "a" }, { t: "br" }, { t: "text", v: "b" }] },
    ]);
  });
});

describe("helpers", () => {
  it("detects jumbo emoji messages", () => {
    expect(isJumboEmoji(parse(":tada: :tada:"))).toBe(true);
    expect(isJumboEmoji(parse("🎉"))).toBe(true);
    expect(isJumboEmoji(parse(":tada: yay"))).toBe(false);
    expect(isJumboEmoji(parse(":a: :b: :c: :d:"))).toBe(false);
  });

  it("renders plain text with resolved names", () => {
    expect(toPlainText("*hi* <@U1> in <#C1>\n> q", { user: () => "taro", channel: () => "general" })).toBe(
      "hi @taro in #general q",
    );
  });

  it("extracts mentions", () => {
    const m = extractMentions("<@U1> and *<@U2>* <!channel>\n> <@U3>");
    expect(m.userIds.sort()).toEqual(["U1", "U2", "U3"]);
    expect([...m.specials]).toEqual(["channel"]);
  });
});
