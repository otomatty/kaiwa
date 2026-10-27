import { describe, expect, it } from "vitest";
import { parseSearchQuery, searchTerms } from "./search";

const members = [
  { id: "U1", name: "鈴木 ボブ" },
  { id: "U2", name: "鈴木" },
  { id: "U3", name: "Alice" },
];
const channels = [
  { id: "C1", name: "random" },
  { id: "C2", name: "design-review" },
];

describe("parseSearchQuery", () => {
  it("matches names that contain spaces, preferring the longest", () => {
    expect(parseSearchQuery("from:@鈴木 ボブ 予算", members, channels)).toEqual({ text: "予算", user: "U1" });
    expect(parseSearchQuery("予算 from:@鈴木", members, channels)).toEqual({ text: "予算", user: "U2" });
  });
  it("accepts quoted names and channels", () => {
    expect(parseSearchQuery('from:@"鈴木 ボブ" in:#random 会議', members, channels)).toEqual({
      text: "会議",
      user: "U1",
      channel: "C1",
    });
  });
  it("is case-insensitive for latin names and reports unknown names", () => {
    expect(parseSearchQuery("from:@alice", members, channels)).toEqual({ text: "", user: "U3" });
    expect(parseSearchQuery("in:#nope hello", members, channels)).toEqual({
      text: "hello",
      unknown: { kind: "in", name: "nope" },
    });
  });
});

describe("searchTerms", () => {
  it("keeps quoted phrases together", () => {
    expect(searchTerms('"編集 後" テスト')).toEqual(["編集 後", "テスト"]);
  });
});
