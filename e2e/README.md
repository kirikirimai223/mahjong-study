# 画面の自動テスト（Playwright / Python）

`npx vite --port 5173` を起動してから、リポジトリのルートで実行する。

- `python3 e2e/replay.py sample kan rinshan chankan && python3 e2e/compare.py e2e/replay-result.json`
  … 開発用ページ（`dev/editor.html`）で、実牌譜4局を画面操作だけで入力し直し、元の牌譜と log が一致するかを見る
- `python3 e2e/stage4.py` … 振り返り（巡目スライダー・家ごとの絞り込み・局面リンク）、局面コメント・タグ・結論、局全体へのコメント
- `python3 e2e/stage3.py` … 勉強会の一覧（件数・絞り込み）、勉強会と半荘の編集、解析レポートURL、勉強会の削除
- `python3 e2e/app_mock.py`
  … Supabase の REST をブラウザ内で偽装して、勉強会の作成 → 半荘 → 局の入力・自動保存・次の局へ → まとめて出力 → 試作の記録の取り込み までを通す
