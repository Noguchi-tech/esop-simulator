# スマホ用URL公開手順

スマホ・PCどちらでも、ログイン不要で開けるURLを用意する手順です。

## A. すぐ使える（設定不要）— htmlpreview

GitHub Pages を有効化しなくても、次のURLでそのまま開けます（`main` ブランチの `index.html` を表示）。

```
https://htmlpreview.github.io/?https://raw.githubusercontent.com/Noguchi-tech/esop-simulator/main/index.html
```

- メリット：設定不要。リンクを配るだけ。
- 注意：`index.html` を `main` に置いている必要があります（feature ブランチ作業中は、そのブランチ名に
  読み替えるか、`main` にマージしてから配布してください）。

## B. 正式URL — GitHub Pages（推奨）

1. GitHub のリポジトリ `Noguchi-tech/esop-simulator` を開く
2. **Settings → Pages**
3. **Build and deployment → Source** を「Deploy from a branch」にする
4. **Branch** を `main`、フォルダを `/(root)` にして **Save**
5. 1〜2分待つと、次のURLで公開されます：

```
https://noguchi-tech.github.io/esop-simulator/
```

- メリット：URLが短く正式。`data/quote.json` も同一オリジンで読めるため、市場データの反映が安定。
- スマホでこのURLを開き、「ホーム画面に追加」するとアプリのように使えます。

## C. 配布のコツ

- 朝礼・面談では、URLをQRコードにして配ると開いてもらいやすいです
  （無料のQR生成ツールに上記URLを貼り付け）。
- 入力値はブラウザに保存されません。誰が開いても初期状態（保有額0）から始まります。

## 補足：市場データ（株価・配当）について

- 株価・配当の初期値は `data/quote.json` を自動で読み込みます。
- このファイルは GitHub Actions が定期更新します（`docs/データ自動更新の仕組み.md` 参照）。
- 取得に失敗してもツールは動作します（HTML内のフォールバック値を使用）。
