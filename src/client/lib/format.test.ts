import { describe, expect, it } from "vitest";
import { formatBytes, formatDay, formatRelative, initials } from "./format";

describe("format", () => {
  it("formats days relative to today", () => {
    const now = new Date(2026, 9, 27, 15, 0).getTime();
    expect(formatDay(new Date(2026, 9, 27, 9, 0).getTime(), now)).toBe("今日");
    expect(formatDay(new Date(2026, 9, 26, 23, 59).getTime(), now)).toBe("昨日");
    expect(formatDay(new Date(2026, 8, 1).getTime(), now)).toContain("9月1日");
    expect(formatDay(new Date(2025, 0, 2).getTime(), now)).toContain("2025年");
  });

  it("formats relative times", () => {
    const now = new Date(2026, 9, 27, 15, 0).getTime();
    expect(formatRelative(now - 10_000, now)).toBe("たった今");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5分前");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("derives initials", () => {
    expect(initials("Taro Yamada")).toBe("TY");
    expect(initials("山田太郎")).toBe("山");
    expect(initials("")).toBe("?");
  });
});

describe("emoji search", () => {
  it("ranks exact names first and supports Japanese keywords", async () => {
    const { searchEmoji } = await import("./emoji");
    expect(searchEmoji("heart")[0]?.char).toBe("❤️");
    expect(searchEmoji("ハート").map((e) => e.char)).toContain("❤️");
    expect(searchEmoji("お祝い").map((e) => e.char)).toContain("🎉");
  });
});
