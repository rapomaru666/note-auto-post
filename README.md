# note-auto-post

ChatGPTで作成したnote記事を、GitHub Actions + Playwrightでnoteの下書きへ自動投入するためのRAPOMAN用リポジトリ。

## 初期目標
1. `post.json` にタイトルと本文を保存
2. GitHub Actionsを手動実行
3. Playwrightでnoteへログイン済みセッションを復元
4. 新規記事へタイトル・本文を入力
5. 公開せず下書き保存

※ noteの画面仕様変更によりセレクタ調整が必要になる場合があります。

## RAPOMARU戦記の自動投稿

`senki/post.json` を更新すると、GitHub Actionsの「Senki Publish」がはてなブログAtomPub APIを使ってRAPOMARU戦記へ投稿します。手動実行にも対応しています。

### 初回設定

GitHubのSettings → Secrets and variables → Actionsへ、次のRepository secretsを登録します。

- `HATENA_ID`: はてなID
- `HATENA_API_KEY`: はてなブログの詳細設定に表示されるAPIキー

APIキーはパスワードと同じように扱い、原稿やリポジトリへ直接書かないでください。投稿先ブログIDはWorkflow内で `rapomaru.hatenablog.com` に固定しています。

### 重複投稿防止

`senki/published.json` に投稿済みの `postKey` と公開URLを記録します。同じ原稿でWorkflowを再実行しても再投稿しません。記録前に処理が止まった場合も、同じカスタムURLの記事を最新記事から検出して重複を防ぎます。
