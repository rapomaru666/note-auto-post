# note-auto-post

ChatGPTで作成したnote記事を、GitHub Actions + Playwrightでnoteの下書きへ自動投入するためのRAPOMAN用リポジトリ。

## 初期目標
1. `post.json` にタイトルと本文を保存
2. GitHub Actionsを手動実行
3. Playwrightでnoteへログイン済みセッションを復元
4. 新規記事へタイトル・本文を入力
5. 公開せず下書き保存

※ noteの画面仕様変更によりセレクタ調整が必要になる場合があります。
