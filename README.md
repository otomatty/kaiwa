# Kaiwa

Slack と同等の操作感を目指したチームチャットです。Cloudflare Workers の上で、フロントエンドから API・リアルタイム配信・DB・ファイル保存までを完結させています（名称・ロゴ・配色はオリジナルです）。

## 機能

| 分類 | 内容 |
| --- | --- |
| ワークスペース | 作成・切り替え、招待リンク（30日有効・リセット可）、メンバーの権限（オーナー / 管理者 / メンバー）と削除、名前変更 |
| チャンネル | パブリック / プライベート、一覧と参加・退出、トピック・説明・名前変更、メンバー追加・削除、アーカイブ、削除（管理者）、スター、ミュート、ブックマーク、ピン留め、参加・退出などのシステムメッセージ |
| DM | 1対1・グループ（最大8人）・自分用、未読バッジ、最新メッセージのプレビュー、閉じる |
| メッセージ | 太字・斜体・取り消し線・コード・コードブロック・引用・リスト・リンク、`:絵文字:`、@メンション（@here / @channel）、#チャンネルリンク、編集（↑キー）・削除、転送、リアクション、絵文字ピッカー、カスタム絵文字（ワークスペースごとに画像を登録）、リンクのプレビュー（画像はサーバー経由で取得）、ファイル添付（ドラッグ＆ドロップ・貼り付け、最大25MB）、下書きの自動保存、送信日時の指定（予約送信・編集・今すぐ送信）、送信失敗時の再送 |
| スレッド | 返信、「チャンネルにも投稿」、フォロー / フォロー解除、スレッド一覧（未読数つき） |
| 未読管理 | チャンネル / DM の未読・メンション数、「新着」ライン、すべての未読ビュー、ここから未読にする（Alt+クリック）、すべて既読（Shift+Esc）、タブタイトルの未読数 |
| リアルタイム | 新着・編集・削除・リアクション・ピン・チャンネル変更の即時反映、入力中表示、在席状況（アクティブ / 離席中 / オフライン、10分無操作で自動離席）、切断時の自動再接続と差分取得 |
| 検索 | 全文検索（日本語対応の trigram）、`in:#チャンネル` `from:@名前`、絞り込み、並び替え、結果から該当メッセージへジャンプ |
| ビュー | アクティビティ（メンション・スレッド・リアクション）、後で（保存済みアイテム・リマインダー・完了管理）、下書き、ファイル、メンバー一覧、プロフィール |
| その他 | ステータス（絵文字・期限つき）、通知の一時停止、プロフィール写真、デスクトップ通知、ダークモード、クイックスイッチャー（Ctrl/⌘+K）などのキーボードショートカット、スラッシュコマンド（/me /shrug /topic /rename /invite /leave /away /active /status /clear /search /msg） |

対象外: ハドル（音声・ビデオ通話）、ワークフロー、外部アプリ連携、メール通知。

## 構成

```
ブラウザ (React 19 + Zustand + Tailwind CSS 4)
   │  HTTPS /api/*            WebSocket /api/workspaces/:id/ws
   ▼
Cloudflare Worker (Hono)  ──────────►  Durable Object: WorkspaceHub（ワークスペースごとに1つ）
   │                                     ・WebSocket Hibernation で接続を保持
   ├─ D1 (SQLite + FTS5)                 ・在席状況と入力中イベントの配信
   ├─ R2（添付ファイル・プロフィール写真）   ・API からの publish() をメンバーへ配信
   └─ Cron Trigger（毎分）: 予約送信メッセージとリマインダーの配信
```

- 静的ファイルは Workers Static Assets で配信し、`/api/*` だけ Worker が処理します（`wrangler.jsonc` の `run_worker_first`）。
- 認証は Google アカウントのみです（OpenID Connect の認可コードフロー。PKCE・state・nonce を検証）。初回のサインインでアカウントを作成し、以降は Google のアカウント ID で同じアカウントに紐づけます。サインイン後は HttpOnly Cookie のセッションで、変更系リクエストと WebSocket 接続は Origin を検証しています。
- 添付ファイルは権限チェック後に配信し、HTML/SVG などはダウンロード扱い（`nosniff` + CSP sandbox）にしています。

```
src/
  shared/   型定義・入力バリデーション・メッセージ記法パーサー（フロントとAPIで共用）
  worker/   API（routes/）、Durable Object（hub.ts）、DBアクセスと権限（lib/）
  client/   画面（components/）、状態管理とリアルタイム処理（store/）、ユーティリティ（lib/）
migrations/ D1 のスキーマ
test/worker Workers ランタイム（workerd）上で動く API・リアルタイムの統合テスト
e2e/        Playwright による2ユーザー同時操作の E2E テスト
```

## 開発

必要なもの: Node.js 22 以上、pnpm 10。

```bash
git clone https://github.com/otomatty/kaiwa.git && cd kaiwa
pnpm install
cp .dev.vars.example .dev.vars   # Google の OAuth クライアント ID とシークレットを書く（下記）
pnpm db:migrate:local      # ローカル D1 にスキーマを適用
pnpm dev                   # http://localhost:5173
```

ローカルでは D1・R2・Durable Objects がすべて Miniflare で動くため、Cloudflare アカウントなしで開発できます。サインインには Google の OAuth クライアントが必要です。

### Google 認証の設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを選び、「API とサービス」→「OAuth 同意画面」を設定します（スコープは `openid` `email` `profile` のみ）。
2. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」で、種類「ウェブ アプリケーション」のクライアントを作成します。
3. 「承認済みのリダイレクト URI」に、サインインに使う URL ごとに `<URL>/api/auth/google/callback` を登録します。
   - ローカル開発: `http://localhost:5173/api/auth/google/callback`
   - 本番: `https://kaiwa.<subdomain>.workers.dev/api/auth/google/callback`（独自ドメインならそのドメイン）
   - PR のプレビュー版でもサインインしたい場合は、その URL も登録してください（ワイルドカードは使えません）。
4. 表示されたクライアント ID とシークレットを、ローカルでは `.dev.vars` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` に、本番では GitHub の Secrets（下記）に設定します。

以前のメールアドレス・パスワード認証で作成したアカウントは、同じメールアドレスの Google アカウントでサインインすると引き継がれます（引き継ぎ時に以前のセッションはすべて無効になります）。ただし引き継げるのは Gmail と Google Workspace のアドレスだけです。それ以外のアドレスは Google での確認後に所有者が変わっている可能性があるため、自動では引き継ぎません。

ローカルでは Cron Trigger が自動では動かないため、予約送信とリマインダーを確かめるときは `http://localhost:5173/cdn-cgi/local/scheduled` を開いて手動で実行してください（`?time=<ミリ秒>` で実行時刻を先に進められます）。

### 検証コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm lint` | Biome による Lint とフォーマットチェック（`pnpm lint:fix` で自動修正） |
| `pnpm typecheck` | TypeScript の型チェック（クライアント / Worker / 設定ファイル） |
| `pnpm test` | 単体テスト（記法パーサーなど）と Worker 統合テスト（workerd 上） |
| `pnpm test:e2e` | 本番ビルドを起動して Playwright で E2E テスト |
| `pnpm verify` | lint → typecheck → test → build をまとめて実行 |

E2E を初めて動かすときは `pnpm exec playwright install chromium` を実行してください。E2E では Google の代わりにローカルのモック（`e2e/google-oauth-mock.mjs`）でサインインするため、Google アカウントや `.dev.vars` は不要です。

## CI/CD（GitHub Actions）

`.github/workflows/ci.yml` が次を行います。

1. **verify**: Lint、生成済み Worker 型の差分チェック、型チェック、単体・統合テスト、ビルド
2. **e2e**: Playwright で E2E テスト（失敗時はレポートとトレースを保存）
3. **preview**（Pull Request）: `wrangler versions upload --preview-alias pr-<番号>` でプレビュー版を作り、URL を PR にコメント
4. **deploy**（main への push）: D1 マイグレーションを本番に適用してから `wrangler deploy`（Google のクライアント ID・シークレットもここで Worker のシークレットとして登録）。リポジトリ変数 `PRODUCTION_URL` があればヘルスチェック

Cloudflare の設定（下記の 1・2）がまだ何もされていない間は、preview と deploy は警告を出してスキップします（CI は失敗しません）。設定が一部だけの場合は、足りない項目を表示して失敗します。

## Cloudflare へのデプロイ

### 1. リソースを作成（初回のみ）

```bash
pnpm exec wrangler login
./scripts/setup-cloudflare.sh
```

D1 データベース `kaiwa-db` と R2 バケット `kaiwa-files` を作成し、D1 の ID を `wrangler.jsonc` に書き込み、本番 DB にマイグレーションを適用します。終わったら `wrangler.jsonc` をコミットしてください。

### 2. GitHub に Secrets を登録

| 名前 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API トークン。テンプレート「Edit Cloudflare Workers」に **D1 の編集権限** を追加したもの |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |
| `GOOGLE_CLIENT_ID` | Google の OAuth クライアント ID（上記「Google 認証の設定」） |
| `GOOGLE_CLIENT_SECRET` | Google の OAuth クライアント シークレット |

任意でリポジトリ変数 `PRODUCTION_URL`（例: `https://kaiwa.<subdomain>.workers.dev`）を設定するとデプロイ後にヘルスチェックします。GitHub の Environments に `production` / `preview` を作ると承認フローも付けられます。

### 3. デプロイ

main ブランチに push すると CI が通った後に自動でデプロイされます。手元から直接デプロイする場合は次のとおりです。

```bash
pnpm run deploy    # build → D1 マイグレーション（remote）→ wrangler deploy
```

Worker に Google のシークレットがまだ登録されていない場合（初回など）は、`GOOGLE_CLIENT_ID=...` と `GOOGLE_CLIENT_SECRET=...` を書いたファイルを渡してください: `pnpm run deploy --secrets-file <ファイル>`。登録済みのシークレットは `pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET` などで更新できます。

### スキーマを変更するとき

```bash
pnpm exec wrangler d1 migrations create DB <変更内容>
# migrations/ に追加された SQL を編集 → pnpm db:migrate:local で確認
```

CI のデプロイ時に本番へ自動適用されます。
