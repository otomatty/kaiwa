# Kaiwa

Slack と同等の操作感を目指したチームチャットです。Cloudflare Workers の上で、フロントエンドから API・リアルタイム配信・DB・ファイル保存までを完結させています（名称・ロゴ・配色はオリジナルです）。

## 機能

| 分類 | 内容 |
| --- | --- |
| ワークスペース | 作成・切り替え、招待リンク（30日有効・リセット可）、メンバーの権限（オーナー / 管理者 / メンバー）と削除、名前変更 |
| チャンネル | パブリック / プライベート、一覧と参加・退出、トピック・説明・名前変更、メンバー追加・削除、アーカイブ、削除（管理者）、スター、ミュート、ブックマーク、ピン留め、参加・退出などのシステムメッセージ |
| DM | 1対1・グループ（最大8人）・自分用、未読バッジ、最新メッセージのプレビュー、閉じる |
| メッセージ | 太字・斜体・取り消し線・コード・コードブロック・引用・リスト・リンク、`:絵文字:`、@メンション（@here / @channel）、#チャンネルリンク、編集（↑キー）・削除、転送、リアクション、絵文字ピッカー、カスタム絵文字（ワークスペースごとに画像を登録）、リンクのプレビュー（画像はサーバー経由で取得）、ファイル添付（ドラッグ＆ドロップ・貼り付け、最大25MB）、下書きの自動保存、送信失敗時の再送 |
| スレッド | 返信、「チャンネルにも投稿」、フォロー / フォロー解除、スレッド一覧（未読数つき） |
| 未読管理 | チャンネル / DM の未読・メンション数、「新着」ライン、すべての未読ビュー、ここから未読にする（Alt+クリック）、すべて既読（Shift+Esc）、タブタイトルの未読数 |
| リアルタイム | 新着・編集・削除・リアクション・ピン・チャンネル変更の即時反映、入力中表示、在席状況（アクティブ / 離席中 / オフライン、10分無操作で自動離席）、切断時の自動再接続と差分取得 |
| 検索 | 全文検索（日本語対応の trigram）、`in:#チャンネル` `from:@名前`、絞り込み、並び替え、結果から該当メッセージへジャンプ |
| ビュー | アクティビティ（メンション・スレッド・リアクション）、後で（保存済みアイテムと完了管理）、下書き、ファイル、メンバー一覧、プロフィール |
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
   └─ R2（添付ファイル・プロフィール写真）   ・API からの publish() をメンバーへ配信
```

- 静的ファイルは Workers Static Assets で配信し、`/api/*` だけ Worker が処理します（`wrangler.jsonc` の `run_worker_first`）。
- 認証はメールアドレスとパスワード（PBKDF2-SHA256）、HttpOnly Cookie のセッション。変更系リクエストと WebSocket 接続は Origin を検証し、サインイン・登録は Workers Rate Limiting で試行回数を制限しています。
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
pnpm install
pnpm db:migrate:local      # ローカル D1 にスキーマを適用
pnpm dev                   # http://localhost:5173
```

ローカルでは D1・R2・Durable Objects がすべて Miniflare で動くため、Cloudflare アカウントなしで開発できます。

### 検証コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm lint` | Biome による Lint とフォーマットチェック（`pnpm lint:fix` で自動修正） |
| `pnpm typecheck` | TypeScript の型チェック（クライアント / Worker / 設定ファイル） |
| `pnpm test` | 単体テスト（記法パーサーなど）と Worker 統合テスト（workerd 上） |
| `pnpm test:e2e` | 本番ビルドを起動して Playwright で E2E テスト |
| `pnpm verify` | lint → typecheck → test → build をまとめて実行 |

E2E を初めて動かすときは `pnpm exec playwright install chromium` を実行してください。

## CI/CD（GitHub Actions）

`.github/workflows/ci.yml` が次を行います。

1. **verify**: Lint、生成済み Worker 型の差分チェック、型チェック、単体・統合テスト、ビルド
2. **e2e**: Playwright で E2E テスト（失敗時はレポートとトレースを保存）
3. **preview**（Pull Request）: `wrangler versions upload --preview-alias pr-<番号>` でプレビュー版を作り、URL を PR にコメント
4. **deploy**（main への push）: D1 マイグレーションを本番に適用してから `wrangler deploy`。リポジトリ変数 `PRODUCTION_URL` があればヘルスチェック

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

任意でリポジトリ変数 `PRODUCTION_URL`（例: `https://kaiwa.<subdomain>.workers.dev`）を設定するとデプロイ後にヘルスチェックします。GitHub の Environments に `production` / `preview` を作ると承認フローも付けられます。

### 3. デプロイ

main ブランチに push すると CI が通った後に自動でデプロイされます。手元から直接デプロイする場合は次のとおりです。

```bash
pnpm run deploy    # build → D1 マイグレーション（remote）→ wrangler deploy
```

### スキーマを変更するとき

```bash
pnpm exec wrangler d1 migrations create DB <変更内容>
# migrations/ に追加された SQL を編集 → pnpm db:migrate:local で確認
```

CI のデプロイ時に本番へ自動適用されます。
