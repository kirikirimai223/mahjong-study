# 画面の自動テスト（Playwright / Python）

`npx vite --port 5173` を起動してから、リポジトリのルートで実行する。

- `python3 e2e/replay.py sample kan rinshan chankan && python3 e2e/compare.py e2e/replay-result.json`
  … 開発用ページ（`dev/editor.html`）で、実牌譜4局を画面操作だけで入力し直し、元の牌譜と log が一致するかを見る
- `UNDO_CALLS=1 python3 e2e/replay.py sample kan rinshan chankan && python3 e2e/compare.py e2e/replay-result.json`
  … 鳴いて切るたびに「この副露を取り消す」で取り消し、鳴き直して最後まで入力しても元の牌譜と一致するか
- `python3 e2e/delete_called.py sample kan chankan` … 鳴いて切った直後に鳴かれた牌を河から消し、手牌が13枚に戻り矛盾が残らないか
- `python3 e2e/drawn_call.py` … 鳴く家が先にツモ牌を選んでいても、ツモ牌は鳴きに使えず、鳴いたら取り消される
- `python3 e2e/fill_unknown.py` … 手牌の「?」をタップして抜けたツモ牌を順に埋める／河の牌の「ツモを入れる」がツモだけを入れる
- `python3 e2e/minkan_tsumo.py` … 明槓の後の打牌（嶺上牌をツモって切った牌）にも鳴きの印／ツモ和了の和了牌を、和了した家の手牌のタップで選ぶ
- `python3 e2e/river_move.py` … 河の牌を別の巡目へ動かす／入れ替える（鳴かれた牌は副露の位置ごと、鳴いた直後の位置に来た牌はツモを外す）
- `python3 e2e/clear_haipai.py` … 開始時の手牌をすべて消すと副露（鳴かれた印）も消え、パレットの残り枚数が戻る
- `python3 e2e/haipai_redo.py` … 局の途中で開始時の手牌を入れ直すとき、副露に使った牌もパレットで選べる／注記で手牌の欄が伸びない
- `python3 e2e/drag_river.py` … 大きいパレットから卓へドラッグして河に置く（右半分＝ツモ切り、左半分＝手出し。開始時の手牌がある家にも対応）、手牌の欄に落として開始時の手牌に入れる、河の枚数の上限
- `python3 e2e/old_call.py` … 前の巡の牌にも鳴ける（鳴いた後の打牌になる牌を案内し、確定でその打牌のツモを外す）／ある家の開始時の手牌をまとめて消す
- `python3 e2e/ext_call.py` … 鳴かれて河から消えた牌を鳴く／鳴いた後に切った牌を自分の河から指定すると、鳴かれた牌を相手の河の合う位置へ動かす（入れ済みの鳴きの直しも）
- `python3 e2e/aftercall_ui.py` … 鳴いた直後の打牌の印、ツモが入っているエラーの直し方（この手番を消す／ツモだけ外す）、河の枚数の参考、ツモ切りボタン、局の開始時の手牌の表示
- `python3 e2e/stage4.py` … 振り返り（巡目スライダー・家ごとの絞り込み・局面リンク）、局面コメント・タグ・結論、局全体へのコメント
- `python3 e2e/stage3.py` … 勉強会の一覧（件数・絞り込み）、勉強会と半荘の編集、解析レポートURL、勉強会の削除
- `python3 e2e/pwa.py` … 本番ビルド（`npm run build && npx vite preview --port 4173`）で、ホーム画面に追加（マニフェスト・アイコン・サービスワーカー・オフラインで画面が開く）と、招待の案内文（登録リンクつき）
- `python3 e2e/app_mock.py`
  … Supabase の REST をブラウザ内で偽装して、勉強会の作成 → 半荘 → 局の入力・自動保存・次の局へ → まとめて出力 → 試作の記録の取り込み までを通す
