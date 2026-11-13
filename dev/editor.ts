// 牌譜エディタを Supabase なしで動かす開発用ページ（自動テストもここで回す）
import { mountEditor, type EditorData } from '../src/editor/main';

const host = document.getElementById('host')!;
const w = window as unknown as Record<string, unknown>;
w.changes = 0;
w.outputs = 0;
w.mount = (initial?: EditorData) => {
  (w.api as { destroy(): void } | undefined)?.destroy();
  w.api = mountEditor(host, { initial, onChange: () => { (w.changes as number)++; }, onOutput: () => { (w.outputs as number)++; } });
};
w.mount();
