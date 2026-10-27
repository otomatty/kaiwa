import { useEffect, useState } from "react";
import type { InviteInfo } from "../../shared/types";
import { ApiError, api } from "../lib/api";
import { navigate, routes } from "../lib/router";
import { set, useStore } from "../store/store";
import { Button, Spinner, TextField } from "./ui";

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/favicon.svg" alt="" width={size} height={size} className="rounded-[22%]" />;
}

function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} | Kaiwa`;
  }, [title]);
  return (
    <div className="flex min-h-full flex-col items-center overflow-y-auto bg-bg-soft px-4 py-12">
      <div className="mb-8 flex items-center gap-2.5">
        <Logo size={36} />
        <span className="font-bold text-[26px] tracking-tight">Kaiwa</span>
      </div>
      <h1 className="text-center font-bold text-[34px] leading-tight sm:text-[40px]">{title}</h1>
      {subtitle && <p className="mt-3 max-w-[460px] text-center text-[17px] text-fg-muted">{subtitle}</p>}
      <div className="mt-8 w-full max-w-[400px]">{children}</div>
    </div>
  );
}

function redirectAfterAuth(next: string | null) {
  const s = useStore.getState();
  if (next) return navigate(next, { replace: true });
  const last = localStorage.getItem("kaiwa:last-workspace");
  const target = s.workspaces.find((w) => w.id === last) ?? s.workspaces[0];
  navigate(target ? `/w/${target.id}` : "/new", { replace: true });
}

function nextParam(): string | null {
  const n = new URLSearchParams(window.location.search).get("next");
  return n?.startsWith("/") && !n.startsWith("//") ? n : null;
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = nextParam();
  return (
    <AuthLayout title="サインイン" subtitle="メールアドレスとパスワードを入力してください。">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api.login({ email, password });
            set({ me: r.user, workspaces: r.workspaces });
            redirectAfterAuth(next);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "サインインできませんでした");
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label="メールアドレス"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@work-email.com"
        />
        <TextField
          label="パスワード"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-[14px] text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="h-11 w-full text-[16px]" disabled={busy}>
          サインインする
        </Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-fg-muted">
        はじめてですか？{" "}
        <a
          href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`);
          }}
          className="font-bold text-link hover:underline"
        >
          アカウントを作成する
        </a>
      </p>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = nextParam();
  return (
    <AuthLayout title="アカウントを作成" subtitle="仕事用のメールアドレスで始めましょう。">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api.signup({ email, password, displayName });
            set({ me: r.user, workspaces: r.workspaces });
            redirectAfterAuth(next);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "登録できませんでした");
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label="表示名"
          autoFocus
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
          placeholder="例: 山田 太郎"
          autoComplete="nickname"
        />
        <TextField
          label="メールアドレス"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@work-email.com"
          autoComplete="email"
        />
        <TextField
          label="パスワード"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="8文字以上"
          autoComplete="new-password"
        />
        {error && (
          <p className="rounded-md bg-danger/10 px-3 py-2 text-[14px] text-danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" className="h-11 w-full text-[16px]" disabled={busy}>
          アカウントを作成する
        </Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-fg-muted">
        すでにアカウントをお持ちですか？{" "}
        <a
          href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
          }}
          className="font-bold text-link hover:underline"
        >
          サインインする
        </a>
      </p>
    </AuthLayout>
  );
}

export function NewWorkspacePage() {
  const me = useStore((s) => s.me);
  const workspaces = useStore((s) => s.workspaces);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthLayout
      title="ワークスペースを作成"
      subtitle={<>{me?.displayName} さん、ようこそ。チームの名前を入力してワークスペースを作りましょう。</>}
    >
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api.createWorkspace(name.trim());
            set((s) => ({ workspaces: [...s.workspaces, r.summary] }));
            navigate(routes.channel(r.workspace.id, r.defaultChannelId), { replace: true });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "作成できませんでした");
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label="ワークスペース名"
          autoFocus
          required
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 株式会社サンプル"
          error={error}
        />
        <Button
          type="submit"
          variant="primary"
          className="h-11 w-full text-[16px]"
          disabled={busy || !name.trim()}
        >
          作成する
        </Button>
      </form>
      <p className="mt-6 text-center text-[14px] text-fg-muted">
        招待リンクを受け取った場合は、そのリンクを開くと参加できます。
      </p>
      {workspaces.length > 0 && (
        <div className="mt-6 rounded-lg border border-line bg-bg p-4">
          <p className="mb-2 font-bold text-[14px]">参加中のワークスペース</p>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => navigate(`/w/${w.id}`)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-muted"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded font-bold text-white"
                style={{ background: w.iconColor }}
              >
                {[...w.name][0]}
              </span>
              {w.name}
            </button>
          ))}
        </div>
      )}
    </AuthLayout>
  );
}

export function InvitePage({ code }: { code: string }) {
  const me = useStore((s) => s.me);
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .inviteInfo(code)
      .then(setInfo, (err) => setError(err instanceof ApiError ? err.message : "招待を読み込めませんでした"));
  }, [code]);
  if (error) {
    return (
      <AuthLayout title="招待リンクが無効です" subtitle={error}>
        <Button className="w-full" onClick={() => navigate("/")}>
          ホームへ
        </Button>
      </AuthLayout>
    );
  }
  if (!info) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const here = `/invite/${code}`;
  return (
    <AuthLayout
      title={`${info.workspace.name} に参加`}
      subtitle={
        <>
          {info.inviter ? `${info.inviter.displayName} さんから招待されています。` : ""}
          {info.workspace.memberCount}人のメンバーが参加しています。
        </>
      }
    >
      {me ? (
        info.alreadyMember ? (
          <Button
            variant="primary"
            className="h-11 w-full"
            onClick={() => navigate(`/w/${info.workspace.id}`)}
          >
            ワークスペースを開く
          </Button>
        ) : (
          <>
            <p className="mb-3 text-center text-[14px] text-fg-muted">{me.email} として参加します</p>
            <Button
              variant="primary"
              className="h-11 w-full text-[16px]"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.acceptInvite(code);
                  set((s) => ({
                    workspaces: [...s.workspaces.filter((w) => w.id !== r.workspace.id), r.workspace],
                  }));
                  navigate(`/w/${r.workspace.id}`, { replace: true });
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "参加できませんでした");
                } finally {
                  setBusy(false);
                }
              }}
            >
              参加する
            </Button>
          </>
        )
      ) : (
        <div className="space-y-3">
          <Button
            variant="primary"
            className="h-11 w-full text-[16px]"
            onClick={() => navigate(`/signup?next=${encodeURIComponent(here)}`)}
          >
            アカウントを作成して参加
          </Button>
          <Button
            className="h-11 w-full text-[16px]"
            onClick={() => navigate(`/login?next=${encodeURIComponent(here)}`)}
          >
            既存のアカウントでサインイン
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
