import { describe, expect, it } from "vitest";
import {
  activeToken,
  decodeMentions,
  encodeLinks,
  encodeMentions,
  parseSlash,
  prefixLines,
  wrapSelection,
} from "./compose";

const users = [
  { id: "U1", name: "Taro" },
  { id: "U2", name: "Taro Yamada" },
  { id: "U3", name: "花子" },
];
const channels = [{ id: "C1", name: "general" }];

describe("encodeMentions", () => {
  it("encodes users, longest match first", () => {
    expect(encodeMentions("@Taro Yamada hi @Taro", users, channels)).toBe("<@U2> hi <@U1>");
  });
  it("encodes Japanese names followed by honorifics", () => {
    expect(encodeMentions("@花子さん お願いします", users, channels)).toBe("<@U3>さん お願いします");
  });
  it("encodes specials and channels", () => {
    expect(encodeMentions("@here see #general.", users, channels)).toBe("<!here> see <#C1>.");
  });
  it("leaves emails, unknown names and code alone", () => {
    expect(encodeMentions("mail taro@Taro.com @nobody `@Taro`", users, channels)).toBe(
      "mail taro@Taro.com @nobody `@Taro`",
    );
  });
  it("round-trips through decodeMentions", () => {
    const stored = encodeMentions("@Taro Yamada in #general @channel", users, channels);
    const names = new Map([...users, ...channels].map((x) => [x.id, x.name]));
    expect(
      decodeMentions(
        stored,
        (id) => names.get(id),
        (id) => names.get(id),
      ),
    ).toBe("@Taro Yamada in #general @channel");
  });
});

describe("links", () => {
  it("converts markdown links", () => {
    expect(encodeLinks("see [docs](https://example.com/a)")).toBe("see <https://example.com/a|docs>");
  });
});

describe("activeToken", () => {
  it("detects mention, channel, emoji and slash tokens", () => {
    expect(activeToken("hi @ta", 6)).toEqual({ trigger: "@", query: "ta", start: 3, end: 6 });
    expect(activeToken("#gen", 4)).toEqual({ trigger: "#", query: "gen", start: 0, end: 4 });
    expect(activeToken("ok :sm", 6)).toEqual({ trigger: ":", query: "sm", start: 3, end: 6 });
    expect(activeToken("ok :s", 5)).toBeNull();
    expect(activeToken("/to", 3)).toEqual({ trigger: "/", query: "to", start: 0, end: 3 });
    expect(activeToken("a@b", 3)).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("wraps and unwraps the selection", () => {
    const r = wrapSelection("hello world", 6, 11, "*");
    expect(r.value).toBe("hello *world*");
    const back = wrapSelection(r.value, r.selectionStart, r.selectionEnd, "*");
    expect(back.value).toBe("hello world");
  });
  it("prefixes lines", () => {
    expect(prefixLines("a\nb", 0, 3, (i) => `${i + 1}. `).value).toBe("1. a\n2. b");
  });
  it("parses slash commands", () => {
    expect(parseSlash("/topic 新しい話題")).toEqual({ name: "topic", args: "新しい話題" });
    expect(parseSlash("/leave")).toEqual({ name: "leave", args: "" });
    expect(parseSlash("not a command")).toBeNull();
  });
});
