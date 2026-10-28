import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { InvitePage, LoginPage, NewWorkspacePage, NotFoundPage } from "./components/Auth";
import { WorkspaceShell } from "./components/Shell";
import { cx, Spinner } from "./components/ui";
import { match, navigate, usePath } from "./lib/router";
import { loadSession } from "./store/actions";
import { useStore } from "./store/store";
import { applyTheme, watchSystemTheme } from "./theme";
import "./styles.css";

applyTheme();
watchSystemTheme();

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cx(
            "pointer-events-auto rounded-lg px-4 py-2.5 text-[14px] shadow-pop",
            t.tone === "error" ? "bg-danger text-white" : "bg-fg text-bg",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

function App() {
  const path = usePath();
  const authReady = useStore((s) => s.authReady);
  const me = useStore((s) => s.me);
  const workspaces = useStore((s) => s.workspaces);

  useEffect(() => {
    void loadSession();
    const onUnauthorized = () => {
      if (!useStore.getState().me) return;
      useStore.setState({ me: null, workspaces: [] });
      const here = window.location.pathname + window.location.search;
      navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    };
    window.addEventListener("kaiwa:unauthorized", onUnauthorized);
    return () => window.removeEventListener("kaiwa:unauthorized", onUnauthorized);
  }, []);

  const invite = match("/invite/:code", path);
  const ws = path.startsWith("/w/") ? path.split("/")[2] : null;
  const isPublic = path === "/login" || !!invite;

  useEffect(() => {
    if (!authReady) return;
    if (!me && !isPublic) {
      const next = path === "/" ? "" : `?next=${encodeURIComponent(path + window.location.search)}`;
      navigate(`/login${next}`, { replace: true });
    } else if (me && path === "/login") {
      const nextParam = new URLSearchParams(window.location.search).get("next");
      navigate(nextParam?.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/", {
        replace: true,
      });
    } else if (me && path === "/") {
      const last = localStorage.getItem("kaiwa:last-workspace");
      const target = workspaces.find((w) => w.id === last) ?? workspaces[0];
      navigate(target ? `/w/${target.id}` : "/new", { replace: true });
    }
  }, [authReady, me, path, isPublic, workspaces]);

  if (!authReady) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar">
        <Spinner className="border-white/30 border-t-white" />
      </div>
    );
  }

  let page: React.ReactNode = null;
  if (invite?.code) page = <InvitePage code={invite.code} />;
  else if (path === "/login") page = <LoginPage />;
  else if (me && path === "/new") page = <NewWorkspacePage />;
  else if (me && ws) page = <WorkspaceShell key={ws} wid={ws} />;
  else if (me && path !== "/") page = <NotFoundPage />;

  return (
    <>
      {page}
      <Toasts />
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
