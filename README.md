# ローカル麻雀の開発環境

Docker EngineとDocker Compose v2.22以降で開発環境を起動する。初回はコンテナイメージとnpm依存関係の取得にネット接続が必要。

## 開発環境の起動

### VS Code の Dev Containers

1. VS Code でこのリポジトリのルートを開き、**Dev Containers: Reopen in Container** を実行する。すでにこのプロジェクトのコンテナを開いている場合は **Dev Containers: Rebuild Container** を実行する。
2. コンテナの起動時に Vite が自動で起動する。ブラウザで `http://localhost:4173/` を開く。別の端末から VS Code で接続している場合は「ポート」タブの転送先を使う。

VS Code がソースをコンテナにマウントし、npm 依存関係は Docker のボリュームに保存する。Codex 拡張機能はコンテナ側に自動でインストールされる。Dev Containers でのブラウザ接続には VS Code のポート転送を使う。

### ターミナルから Docker Compose を使う場合

```sh
docker compose up --build --watch
```

ブラウザで `http://localhost:4173/` を開く。ソースの変更はコンテナへ同期され、Viteが画面に反映する。依存関係の設定やロックファイルを更新すると、開発イメージが再ビルドされる。

設定を変える場合は `.env.example` を `.env` にコピーして編集する。アクセス先は `MJ_HOST` と `MJ_PORT`、Dockerがホスト側で待ち受けるIPは `MJ_PUBLISH_IP` で指定する。サブパスを使う場合は `MJ_BASE_PATH` を設定し、そのパスまで含めてブラウザで開く。ローカルの既定設定では、コンテナのポートをPCのループバックに公開する。

## PCから直接起動

Node.js 22.12以降の環境で、初回のみ `npm ci` で依存関係をインストールする。`npm start` でアプリをビルドし、ローカル配信を開始してブラウザを開く。接続先は `MJ_HOST` と `MJ_PORT`、配信パスは `MJ_BASE_PATH` で設定する。配信中はインターネット接続なしで対局できる。

## 型チェックと配布用ビルド

`npm test` で対局進行、和了点、保存から復元した局面の回帰テストを実行する。

```sh
docker compose run --rm --build web npm run typecheck
sh scripts/build-static.sh
```

ビルドで型チェックを行い、配布用のファイルを `dist/` に出力する。Webサーバーでこのディレクトリの内容を静的配信できる。たとえば `/mahjong/` に配置するビルドは、配信パスを環境変数で指定する。

```sh
MJ_BASE_PATH=/mahjong/ sh scripts/build-static.sh
```

対局の実装方針は [要件定義](プロジェクト管理/要件定義.md)、[基本設計](プロジェクト管理/基本設計.md)、[詳細設計](プロジェクト管理/詳細設計.md) に記載している。
