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

function nextParam(): string | null {
  const n = new URLSearchParams(window.location.search).get("next");
  return n?.startsWith("/") && !n.startsWith("//") ? n : null;
}

// Error codes the API puts in /login?error=… after a failed Google sign-in.
const SIGN_IN_ERRORS: Record<string, string> = {
  access_denied: "Google でのサインインがキャンセルされました。",
  invalid_state: "サインインの有効期限が切れました。もう一度お試しください。",
  email_unverified: "メールアドレスが確認済みの Google アカウントでサインインしてください。",
  account_conflict: "このメールアドレスは別の Google アカウントで登録されています。",
  link_unavailable:
    "このメールアドレスの既存アカウントは、Gmail・Google Workspace 以外のため自動で引き継げません。管理者に連絡してください。",
  not_configured: "Google 認証が設定されていません。管理者に連絡してください。",
  google_failed: "Google での認証に失敗しました。もう一度お試しください。",
};

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** Starts Google sign-in (a full-page navigation); `next` is where to land afterwards. */
function GoogleSignInButton({
  next,
  label = "Google でサインイン",
}: {
  next: string | null;
  label?: string;
}) {
  return (
    <a
      href={`/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-md border border-line-strong bg-bg font-bold text-[16px] text-fg transition-colors hover:bg-bg-soft"
    >
      <GoogleLogo />
      {label}
    </a>
  );
}

export function LoginPage() {
  const next = nextParam();
  const errorCode = new URLSearchParams(window.location.search).get("error");
  const error = errorCode
    ? (SIGN_IN_ERRORS[errorCode] ?? "サインインできませんでした。もう一度お試しください。")
    : null;
  return (
    <AuthLayout title="サインイン" subtitle="Google アカウントでサインインしてください。">
      {error && (
        <p className="mb-4 rounded-md bg-danger/10 px-3 py-2 text-[14px] text-danger" role="alert">
          {error}
        </p>
      )}
      <GoogleSignInButton next={next} />
      <p className="mt-6 text-center text-[14px] text-fg-muted">
        はじめての場合は、サインインするとアカウントが作成されます。
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
        <GoogleSignInButton next={here} label="Google でサインインして参加" />
      )}
    </AuthLayout>
  );
}

export function NotFoundPage() {
  return (
    <AuthLayout
      title="ページが見つかりません"
      subtitle="URL が間違っているか、ページが移動した可能性があります。"
    >
      <Button variant="primary" className="h-11 w-full" onClick={() => navigate("/")}>
        ホームに戻る
      </Button>
    </AuthLayout>
  );
}
