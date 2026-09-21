# プライバシーポリシー｜Totonoe（ととのえ）

最終更新日: 2026年9月22日

Chrome 拡張機能「Totonoe（ととのえ）｜日付入力サポート」（以下「本拡張機能」）は、
ページ上で選択した日付文字列を、利用者が設定した書式に変換する単一の目的で提供されています。

## 1. 収集するデータ

**本拡張機能は、利用者の個人情報およびユーザーデータを一切収集しません。**

- 外部サーバーへの通信は行いません（ネットワークリクエストを発行するコードは含まれていません）
- アクセス解析、広告、クラッシュレポートなどの第三者サービスは組み込んでいません
- 閲覧履歴、ページの内容、入力内容、選択したテキストを保存・送信することはありません
- アカウント登録やログインは不要で、氏名・メールアドレス等を求めることもありません

## 2. 端末内で扱うデータ

以下のデータは、機能の動作に必要な範囲で **利用者の端末内（および利用者の Chrome アカウントの同期領域）でのみ** 扱われます。

### 選択したテキスト

- 右クリックメニューやショートカットキーで変換を実行したとき、その時点で選択されている文字列を読み取り、日付部分を変換します
- 変換はすべて端末内で完結し、結果は入力欄の置き換えまたはクリップボードへのコピーに使用されます
- 選択テキストと変換結果は、処理後に保持されません
- 右クリックメニューに変換後のプレビューを表示するため、選択範囲の先頭行を一時的に拡張機能内部（バックグラウンド処理）へ渡しますが、これも端末内で完結し、保存されません

### 設定情報

- 利用者が設定画面で登録した出力書式と入力パターン（正規表現）を `chrome.storage.sync` に保存します
- これは Chrome の標準機能であり、Chrome にログインしている場合は Google アカウントを通じて利用者の他の端末と同期されます。同期の可否は Chrome の設定で利用者が管理できます
- 保存されるのは設定値のみで、個人を特定できる情報は含まれません
- 拡張機能をアンインストールすると削除されます

### クリップボード

- 入力欄以外（本文テキストや Google ドキュメントなど）で変換した場合、変換結果をクリップボードに書き込みます
- Google ドキュメントのように選択範囲がページ構造から取得できないエディタでは、利用者が変換を実行した瞬間に限り、選択テキストをクリップボード経由で読み取ります
- クリップボードの読み取りは利用者の明示的な操作（メニュー選択・ショートカット押下）時のみ行い、バックグラウンドで監視することはありません。読み取った内容は保存・送信しません

## 3. 使用する権限とその理由

| 権限 | 用途 |
|---|---|
| `contextMenus` | 右クリックメニューに書式の選択肢と変換プレビューを表示するため |
| `storage` | 利用者の書式・パターン設定を保存するため |
| `scripting` | 利用者の操作時に、現在のタブへ変換処理と選択メニューを実行するため |
| `activeTab` | 利用者が操作したタブでのみ選択テキストの取得と置き換えを行うため |
| `clipboardRead` | Google ドキュメントなどで選択テキストを取得するため（利用者の操作時のみ） |
| `clipboardWrite` | 直接置き換えできない場所で変換結果をコピーするため |
| ホスト権限（すべてのサイト） | 日付はあらゆるサイトで入力されるため。コンテンツスクリプトが行うのは、現在の選択テキストをメニューのプレビュー更新用に拡張機能内部へ渡すことだけで、ページ内容の収集や送信は行いません |

本拡張機能はリモートコードを使用しません。実行されるコードはすべて拡張機能パッケージに含まれています。

## 4. 第三者への提供

収集するデータがないため、第三者へ提供・販売・譲渡するデータもありません。

## 5. 子どものプライバシー

本拡張機能は特定の年齢層を対象としておらず、年齢を問わずデータを収集しません。

## 6. ポリシーの変更

本ポリシーを変更する場合は、このページを更新し、最終更新日を改めます。
権限の追加など重要な変更がある場合は、Chrome ウェブストアの更新時に利用者へ再承認が求められます。

## 7. お問い合わせ

本ポリシーに関するご質問は、GitHub リポジトリの Issues からお寄せください。

https://github.com/kuudaru/totonoe/issues

---

# Privacy Policy | Totonoe

Last updated: September 22, 2026

Totonoe is a Chrome extension with a single purpose: converting a selected date string on a web page into the format the user has configured.

## Data collection

**Totonoe does not collect any personal information or user data.**

- It makes no network requests. The extension contains no code that communicates with any server.
- It includes no analytics, advertising, or crash-reporting services.
- It never stores or transmits browsing history, page content, form input, or selected text.
- No account or sign-in is required.

## Data handled on your device only

- **Selected text**: When you run a conversion via the context menu or keyboard shortcut, the currently selected text is read and its date portion is converted. Processing happens entirely on your device; the result replaces the selection or is copied to the clipboard, and nothing is retained afterwards. To show a preview in the context menu, the first line of the selection is passed to the extension's background process, still on-device and never stored.
- **Settings**: Your output formats and input patterns are saved with `chrome.storage.sync`. If you are signed in to Chrome, Chrome may sync them across your devices through your Google account; you control this in Chrome's settings. Settings contain no personally identifiable information and are removed when the extension is uninstalled.
- **Clipboard**: The extension writes the converted result to the clipboard when the selection cannot be replaced directly (e.g. plain page text, Google Docs). In editors such as Google Docs, where the selection is not exposed to the page, it reads the selected text through the clipboard at the moment you trigger a conversion. Clipboard access happens only on your explicit action, is never monitored in the background, and its content is never stored or transmitted.

## Permissions

`contextMenus` (menu with format choices and previews), `storage` (save settings), `scripting` and `activeTab` (run the conversion in the tab you act on), `clipboardRead` / `clipboardWrite` (see above), and host permission for all sites (dates appear on any site; the content script only forwards the current selection for the menu preview and never collects or sends page content). No remote code is used.

## Third parties

No data is collected, so none is shared, sold, or transferred.

## Contact

Questions about this policy: https://github.com/kuudaru/totonoe/issues
