// Public pages the Google OAuth consent screen links to. Served by the Worker so
// they are real HTML, not the signed-in app shell.

const CONTACT = "akimasa.sugai@saedgewell.com";

function page(title: string, body: string): Response {
  const html = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | Kaiwa</title>
<body style="margin:0;background:#172022;color:#e8e6e3;font:16px/1.7 system-ui,sans-serif">
<main style="max-width:40rem;margin:0 auto;padding:3rem 1.25rem">
<p style="margin:0 0 1.5rem"><a href="/about" style="color:#f2c14e;font-weight:700;text-decoration:none">Kaiwa</a></p>
<h1 style="font-size:1.75rem;line-height:1.3;margin:0 0 1rem">${title}</h1>
${body}
</main>
</body>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

const PAGES: Record<string, () => Response> = {
  "/about": () =>
    page(
      "Kaiwa",
      `<p>チームの会話を置くアプリです。ワークスペースの中にチャンネルがあり、メッセージ、スレッド、ファイルをそこに残します。</p>
<p>アカウントは Google で作ります。はじめてサインインしたときに Kaiwa のアカウントができます。</p>
<p><a href="/login" style="color:#f2c14e">サインイン</a></p>
<p><a href="/privacy" style="color:#f2c14e">プライバシーポリシー</a> · <a href="/terms" style="color:#f2c14e">利用規約</a></p>`,
    ),
  "/privacy": () =>
    page(
      "プライバシーポリシー",
      `<p>Kaiwa は Google アカウントでサインインします。そのとき受け取るのは、メールアドレス、名前、Google アカウントの識別子です。プロフィール写真は受け取りません。</p>
<p>メールアドレスと名前は、アカウントを作り、ワークスペースの中で誰の発言かを示すために使います。売ったり、広告の素材にしたりはしません。</p>
<p>アカウントの情報と、送ったメッセージやファイルは Cloudflare に保存します。</p>
<p>Google アカウントの設定で、Kaiwa に渡しているアクセスを外せます。外すと、次からのサインインは止まります。</p>
<p>問い合わせは <a href="mailto:${CONTACT}" style="color:#f2c14e">${CONTACT}</a> まで。</p>`,
    ),
  "/terms": () =>
    page(
      "利用規約",
      `<p>Kaiwa は、招待されたワークスペースのメンバー同士で使うためのものです。</p>
<p>自分の Google アカウントでサインインしてください。他人のアカウントになりすましたり、ワークスペースの外に会話を持ち出したりしないでください。</p>
<p>不具合の修正で、予告なくサービスを止めることがあります。</p>
<p>問い合わせは <a href="mailto:${CONTACT}" style="color:#f2c14e">${CONTACT}</a> まで。</p>`,
    ),
};

export function legalResponse(pathname: string): Response | null {
  return PAGES[pathname]?.() ?? null;
}
