import { useEffect } from "react";
import { match, navigate, routes, usePath } from "../lib/router";
import { bootWorkspace, goToDefaultChannel } from "../store/actions";
import { connect, disconnect } from "../store/realtime";
import { useStore } from "../store/store";
import { ChannelView } from "./ChannelView";
import { ModalHost, useGlobalShortcuts } from "./Modals";
import { RightPanel } from "./Panels";
import { Sidebar, WorkspaceRail } from "./Sidebar";
import { TopBar } from "./TopBar";
import { Button, cx, Spinner } from "./ui";
import {
  ActivityView,
  DraftsView,
  EmptyDmView,
  FilesView,
  LaterView,
  PeopleView,
  SearchView,
  ThreadsView,
  UnreadsView,
} from "./Views";

function UnknownView() {
  const wid = useStore((s) => s.wid) as string;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="font-bold text-[18px]">ページが見つかりません</p>
      <p className="text-fg-muted">URL が間違っているか、このページは存在しません。</p>
      <Button onClick={() => navigate(`/w/${wid}`)}>ホームに戻る</Button>
    </div>
  );
}

export function WorkspaceShell({ wid }: { wid: string }) {
  const path = usePath();
  const loaded = useStore((s) => s.wid === wid && !!s.workspace);
  const bootError = useStore((s) => s.bootError);
  const panel = useStore((s) => s.panel);
  const mobileSidebar = useStore((s) => s.mobileSidebar);
  const channels = useStore((s) => s.channels);
  useGlobalShortcuts();

  useEffect(() => {
    void bootWorkspace(wid);
    connect(wid);
    try {
      localStorage.setItem("kaiwa:last-workspace", wid);
    } catch {
      // ignore
    }
    return () => disconnect();
  }, [wid]);

  const channelMatch = match("/w/:wid/c/:cid", path);
  const view = match("/w/:wid/:view", path)?.view;
  const cid = channelMatch?.cid;

  useEffect(() => {
    if (cid) {
      try {
        localStorage.setItem(`kaiwa:last-channel:${wid}`, cid);
      } catch {
        // ignore
      }
    }
  }, [cid, wid]);

  // /w/:wid → last visited or #general
  useEffect(() => {
    if (!loaded || cid || view) return;
    const last = localStorage.getItem(`kaiwa:last-channel:${wid}`);
    if (last && channels[last]) navigate(routes.channel(wid, last), { replace: true });
    else goToDefaultChannel();
  }, [loaded, cid, view, wid, channels]);

  // Unread count in the tab title: mentions, DMs and threads with new replies (as on the rail badges).
  const unreadThreads = useStore((s) => s.unreadThreads);
  useEffect(() => {
    const n =
      Object.values(channels).reduce(
        (acc, c) =>
          acc + (c.kind === "dm" || c.kind === "group" ? (c.muted ? 0 : c.unreadCount) : c.mentionCount),
        0,
      ) + unreadThreads;
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = n > 0 ? `(${n}) ${base}` : base;
  });

  if (bootError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-[18px]">{bootError}</p>
        <Button onClick={() => navigate("/")}>ホームに戻る</Button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar">
        <Spinner className="border-white/30 border-t-white" />
      </div>
    );
  }

  let main: React.ReactNode;
  if (cid) main = <ChannelView channelId={cid} />;
  else if (view === "threads") main = <ThreadsView />;
  else if (view === "unreads") main = <UnreadsView />;
  else if (view === "activity") main = <ActivityView />;
  else if (view === "drafts") main = <DraftsView />;
  else if (view === "files") main = <FilesView />;
  else if (view === "people") main = <PeopleView />;
  else if (view === "later") main = <LaterView />;
  else if (view === "search") main = <SearchView />;
  else if (view === "dms") main = <EmptyDmView />;
  else if (view) main = <UnknownView />;
  else main = null;

  return (
    <div className="flex h-full flex-col bg-rail">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <div className={cx("min-h-0 shrink-0", mobileSidebar ? "flex w-full md:w-auto" : "hidden md:flex")}>
          <WorkspaceRail />
          <div className="min-w-0 flex-1 md:flex-none">
            <Sidebar />
          </div>
        </div>
        <main
          className={cx(
            "min-h-0 min-w-0 flex-1 overflow-hidden bg-bg md:rounded-tl-lg",
            mobileSidebar ? "hidden md:flex" : "flex",
          )}
        >
          <div className={cx("min-w-0 flex-1 flex-col", panel ? "hidden md:flex" : "flex")}>{main}</div>
          {panel && <RightPanel />}
        </main>
      </div>
      <ModalHost />
    </div>
  );
}
