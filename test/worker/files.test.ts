import { describe, expect, it } from "vitest";
import type { FileInfo, Message } from "../../src/shared/types";
import { signup, workspaceWith } from "./helpers";

function form(name: string, type: string, content: string) {
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
      form("a.png", "image/png", "PNG"),
    );
    const r = await owner.patch<{ user: { avatarUrl: string } }>("/me", { avatarFileId: up.body.file.id });
    expect(r.body.user.avatarUrl).toBe(`/api/files/${up.body.file.id}`);
    const txt = await owner.req<{ file: FileInfo }>(
      "POST",
      `/workspaces/${wid}/files`,
      form("a.txt", "text/plain", "x"),
    );
    expect((await owner.patch("/me", { avatarFileId: txt.body.file.id })).status).toBe(400);
  });
});
