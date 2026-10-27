import type { UserRow } from "./rows";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: UserRow;
    sessionId: string;
  };
};
