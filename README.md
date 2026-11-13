# 麻雀勉強会支援ツール

勉強会ごとに半荘・局を記録し、局面にコメントと結論を残すアプリ（Phase 1）。
要件定義と設計は Claude Docs の「麻雀勉強会支援ツール 要件定義書」を参照。

## 構成

- `src/core/` … 天鳳形式の変換、配牌・ツモの補完（`reconstruct`）、入力チェック（`diagnose`）、次局の計算（`nextRound`）。画面に依存しない純粋関数
- `src/editor/` … Phase 0 で作った牌譜エディタ（素の JS）。`mountEditor()` で React の画面の中（Shadow DOM）に載せる。`dev/editor.html` で単体でも動く
- `src/pages/` … React の画面
- `e2e/` … 画面の自動テスト（`e2e/README.md`）
- `test/` … Vitest（実際の天鳳牌譜4局を正解データにしている）
- DB は Supabase（「麻雀統計分析ツール」プロジェクトに同居）。テーブルは `study_` 接頭辞で分け、RLS で招待メンバーだけに制限

## 開発

```sh
cp .env.example .env.local
npm install
npm run dev
npm test
```

## メンバーの追加

管理者が「メンバー」画面でメールアドレスを招待 → 招待された人がそのアドレスで登録する。
