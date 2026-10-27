import { describe, expect, it } from "vitest";
import type { Bootstrap, CustomEmoji, FileInfo } from "../../src/shared/types";
import { signup, workspaceWith } from "./helpers";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

function png(name = "party.png", content: string | Uint8Array = PNG_BYTES) {
  const fd = new FormData();
  fd.append("file", new File([content], name, { type: "image/png" }));
  return fd;
}

describe("custom emoji", () => {
  it("rejects files that only claim to be images", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const up = await owner.req<{ file: FileInfo }>("POST", `/workspaces/${wid}/files`, png("fake.png", svg));
    const add = await owner.post(`/workspaces/${wid}/emoji`, { name: "fakepng", fileId: up.body.file.id });
    expect(add.status).toBe(400);
  });

  it("registers, serves and deletes workspace emoji", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const carol = await signup("carol");
    const wid = await workspaceWith(owner, bob, carol);
    const up = await bob.req<{ file: FileInfo }>("POST", `/workspaces/${wid}/files`, png());
    const add = await bob.post<{ emoji: CustomEmoji[] }>(`/workspaces/${wid}/emoji`, {
      name: "Party-Parrot",
      fileId: up.body.file.id,
    });
    expect(add.status).toBe(201);
    expect(add.body.emoji.map((e) => e.name)).toEqual(["party-parrot"]);

    // Everyone in the workspace sees it in bootstrap and can load the image.
    const boot = await owner.get<Bootstrap>(`/workspaces/${wid}/bootstrap`);
    expect(boot.body.customEmoji.map((e) => e.name)).toEqual(["party-parrot"]);
    expect((await owner.get(`/files/${up.body.file.id}`)).status).toBe(200);
    const stranger = await signup("stranger");
    expect((await stranger.get(`/files/${up.body.file.id}`)).status).toBe(404);

    // Usable as a reaction
    const general = await owner.channel(wid, "general");
    const msg = await owner.post<{ message: { id: string } }>(`/channels/${general.id}/messages`, {
      text: "hi",
    });
    const r = await owner.post<{ reactions: { emoji: string }[] }>(
      `/messages/${msg.body.message.id}/reactions`,
      {
        emoji: "party-parrot",
      },
    );
    expect(r.body.reactions[0]?.emoji).toBe("party-parrot");

    // Validation: standard names and duplicates are rejected
    const up2 = await bob.req<{ file: FileInfo }>("POST", `/workspaces/${wid}/files`, png("b.png"));
    expect(
      (await bob.post(`/workspaces/${wid}/emoji`, { name: "tada", fileId: up2.body.file.id })).status,
    ).toBe(409);
    expect(
      (await bob.post(`/workspaces/${wid}/emoji`, { name: "party-parrot", fileId: up2.body.file.id })).status,
    ).toBe(409);
    expect(
      (await bob.post(`/workspaces/${wid}/emoji`, { name: "日本語", fileId: up2.body.file.id })).status,
    ).toBe(422);

    // Only the creator or an admin can delete
    expect((await carol.del(`/workspaces/${wid}/emoji/party-parrot`)).status).toBe(403);
    expect((await owner.del(`/workspaces/${wid}/emoji/party-parrot`)).status).toBe(200);
    const after = await owner.get<{ emoji: CustomEmoji[] }>(`/workspaces/${wid}/emoji`);
    expect(after.body.emoji).toEqual([]);
  });
});
