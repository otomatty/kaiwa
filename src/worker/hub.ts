import { DurableObject } from "cloudflare:workers";

export class WorkspaceHub extends DurableObject<Env> {}
