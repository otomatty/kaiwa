import { describe, expect, it } from "vitest";
import type { InviteInfo } from "../../src/shared/types";
import { Client, signup, workspaceWith } from "./helpers";

describe("workspaces & invites", () => {
  it("creates a workspace with #general and #random", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const b = await owner.bootstrap(wid);
    expect(b.role).toBe("owner");
    expect(b.channels.map((c) => c.name).sort()).toEqual(["general", "random"]);
    expect(b.members).toHaveLength(1);
  });

  it("joins through an invite link and auto-joins default channels", async () => {
    const owner = await signup("owner");
    const r = await owner.post<{ workspace: { id: string } }>("/workspaces", { name: "Team" });
    const wid = r.body.workspace.id;
    const inv = await owner.post<{ code: string; url: string }>(`/workspaces/${wid}/invites`);
    expect(inv.body.url).toContain(`/invite/${inv.body.code}`);
    // Same link is returned while it is valid
    const again = await owner.post<{ code: string }>(`/workspaces/${wid}/invites`);
    expect(again.body.code).toBe(inv.body.code);

    const guest = await signup("guest");
    const info = await guest.get<InviteInfo>(`/invites/${inv.body.code}`);
    expect(info.body.workspace.name).toBe("Team");
    expect(info.body.alreadyMember).toBe(false);
    const anon = await new Client().get<InviteInfo>(`/invites/${inv.body.code}`);
    expect(anon.status).toBe(200);

    expect((await guest.post(`/invites/${inv.body.code}/accept`)).status).toBe(200);
    const b = await guest.bootstrap(wid);
    expect(b.role).toBe("member");
    expect(b.members.map((m) => m.displayName).sort()).toEqual(["guest", "owner"]);
    expect(b.channels.map((c) => c.name).sort()).toEqual(["general", "random"]);

    // Accepting twice is harmless
    expect((await guest.post(`/invites/${inv.body.code}/accept`)).status).toBe(200);

    // Reset revokes links
    await owner.post(`/workspaces/${wid}/invites/reset`);
    expect((await guest.get(`/invites/${inv.body.code}`)).status).toBe(404);
  });

  it("hides workspaces from non-members", async () => {
    const owner = await signup("owner");
    const wid = await workspaceWith(owner);
    const stranger = await signup("stranger");
    expect((await stranger.get(`/workspaces/${wid}/bootstrap`)).status).toBe(404);
  });

  it("lets admins change roles and remove members", async () => {
    const owner = await signup("owner");
    const a = await signup("alice");
    const b = await signup("bob");
    const wid = await workspaceWith(owner, a, b);
    // members cannot promote
    expect((await a.patch(`/workspaces/${wid}/members/${b.user.id}`, { role: "admin" })).status).toBe(403);
    expect((await owner.patch(`/workspaces/${wid}/members/${a.user.id}`, { role: "admin" })).status).toBe(
      200,
    );
    // admin can remove a member; cannot remove the owner
    expect((await a.del(`/workspaces/${wid}/members/${owner.user.id}`)).status).toBe(403);
    expect((await a.del(`/workspaces/${wid}/members/${b.user.id}`)).status).toBe(200);
    expect((await b.get(`/workspaces/${wid}/bootstrap`)).status).toBe(404);
    // rename workspace
    const rn = await a.patch<{ workspace: { name: string } }>(`/workspaces/${wid}`, { name: "Renamed" });
    expect(rn.body.workspace.name).toBe("Renamed");
  });
});
