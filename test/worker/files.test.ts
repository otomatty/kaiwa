import { describe, expect, it } from "vitest";
import type { FileInfo, Message, MessagePage } from "../../src/shared/types";
import { signup, workspaceWith } from "./helpers";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

function form(name: string, type: string, content: string | Uint8Array) {
  const fd = new FormData();
  fd.append("file", new File([content], name, { type }));
  return fd;
}

describe("files", () => {
  it("uploads to R2, attaches to a message and enforces access", async () => {
    const owner = await signup("owner");
    const bob = await signup("bob");
    const wid = await workspaceWith(owner, bob);
    const general = await owner.channel(wid, "general");

    const up = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("メモ.txt", "text/plain", "hello"),
    );
    expect(up.status).toBe(201);
    const file = up.body.file;
    expect(file.name).toBe("メモ.txt");

    // Before attaching, only the uploader can read it
    expect((await bob.get(`/files/${file.id}`)).status).toBe(404);

    const msg = await owner.post<{ message: Message }>(`/channels/${general.id}/messages`, {
      text: "",
      fileIds: [file.id],
    });
    expect(msg.status).toBe(201);
    expect(msg.body.message.files.map((f) => f.id)).toEqual([file.id]);

    const dl = await bob.get(`/files/${file.id}`);
    expect(dl.status).toBe(200);
    expect(dl.body).toBe("hello");
    expect(dl.headers.get("Content-Disposition")).toContain("inline");
    expect(dl.headers.get("X-Content-Type-Options")).toBe("nosniff");

    // A file cannot be attached twice
    const again = await owner.post(`/channels/${general.id}/messages`, { text: "x", fileIds: [file.id] });
    expect(again.status).toBe(400);

    const stranger = await signup("stranger");
    expect((await stranger.get(`/files/${file.id}`)).status).toBe(404);

    const list = await bob.get<{ files: FileInfo[] }>(`/workspaces/${wid}/files`);
    expect(list.body.files.map((f) => f.id)).toEqual([file.id]);

    // Deleting the message removes the file
    await owner.del(`/messages/${msg.body.message.id}`);
    expect((await bob.get(`/files/${file.id}`)).status).toBe(404);
  });

  it("serves active content (HTML/SVG) as downloads", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const general = await owner.channel(wid, "general");
    const up = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("x.html", "text/html", "<script>alert(1)</script>"),
    );
    await owner.post(`/channels/${general.id}/messages`, { text: "", fileIds: [up.body.file.id] });
    const dl = await owner.get(`/files/${up.body.file.id}`);
    expect(dl.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(dl.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("accepts an uploaded image as the profile picture", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const up = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("a.png", "image/png", PNG_BYTES),
    );
    const r = await owner.patch<{ user: { avatarUrl: string } }>("/me", { avatarFileId: up.body.file.id });
    expect(r.body.user.avatarUrl).toBe(`/api/files/${up.body.file.id}`);
    const txt = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("a.txt", "text/plain", "x"),
    );
    expect((await owner.patch("/me", { avatarFileId: txt.body.file.id })).status).toBe(400);
    // The claimed type alone is not enough
    const fake = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("b.png", "image/png", "not really a png"),
    );
    expect((await owner.patch("/me", { avatarFileId: fake.body.file.id })).status).toBe(400);
  });
});

describe("forwarded files", () => {
  it("lets people read files through a forward they can see, and placeholders deleted originals", async () => {
    const owner = await signup("owner");
    const carol = await signup("carol");
    const wid = await workspaceWith(owner, carol);
    const general = await owner.channel(wid, "general");
    const secret = await owner.post<{ channel: { id: string } }>(`/workspaces/${wid}/channels`, {
      name: "himitsu",
      kind: "private",
    });
    const up = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("plan.txt", "text/plain", "secret plan"),
    );
    const orig = await owner.post<{ message: Message }>(`/channels/${secret.body.channel.id}/messages`, {
      text: "計画です",
      fileIds: [up.body.file.id],
    });
    // Carol is not in #himitsu
    expect((await carol.get(`/files/${up.body.file.id}`)).status).toBe(404);

    const fwd = await owner.post<{ message: Message }>(`/channels/${general.id}/messages`, {
      text: "",
      sharedMessageId: orig.body.message.id,
    });
    expect(fwd.body.message.shared?.files.map((f) => f.id)).toEqual([up.body.file.id]);
    const dl = await carol.get(`/files/${up.body.file.id}`);
    expect(dl.status).toBe(200);
    expect(dl.body).toBe("secret plan");

    // Editing the original updates the snapshot
    await owner.patch(`/messages/${orig.body.message.id}`, { text: "計画（改訂版）です" });
    let page = await carol.get<MessagePage>(`/channels/${general.id}/messages`);
    expect(page.body.messages.at(-1)?.shared?.text).toBe("計画（改訂版）です");

    // Deleting the original leaves a placeholder, and the file is gone
    await owner.del(`/messages/${orig.body.message.id}`);
    page = await carol.get<MessagePage>(`/channels/${general.id}/messages`);
    const shared = page.body.messages.at(-1)?.shared;
    expect(shared?.deleted).toBe(true);
    expect(shared?.text).toBe("");
    expect((await carol.get(`/files/${up.body.file.id}`)).status).toBe(404);
  });
});
