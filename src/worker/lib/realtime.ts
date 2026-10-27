import type { Context } from "hono";
import type { ServerEvent } from "../../shared/types";
import type { AppEnv } from "./context";

export function hub(env: Env, workspaceId: string) {
  return env.WORKSPACE_HUB.get(env.WORKSPACE_HUB.idFromName(workspaceId));
}

/**
 * Fan an event out to connected clients of a workspace.
 * `audience` limits delivery to the given user ids; "all" sends to everyone connected.
 * Delivery happens after the response is sent (waitUntil) so API latency is unaffected.
 */
export function publish(
  c: Context<AppEnv> | Runtime,
  workspaceId: string,
  events: ServerEvent | ServerEvent[],
  audience: string[] | "all",
): void {
  const rt = runtime(c);
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0 || (audience !== "all" && audience.length === 0)) return;
  const task = hub(rt.env, workspaceId)
    .publish(list, audience === "all" ? null : audience)
    .catch((err: unknown) => console.error("publish failed", err));
  rt.waitUntil(task);
}

/** What background work needs from a request (or a cron invocation). */
export interface Runtime {
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export function runtime(c: Context<AppEnv> | Runtime): Runtime {
  if (!("req" in c)) return c;
  return {
    env: c.env,
    waitUntil: (p) => {
      try {
        c.executionCtx.waitUntil(p);
      } catch {
        // No execution context (some test harnesses): fire and forget.
      }
    },
  };
}
