import tilesCss from '../editor/tiles.css?inline';
import { tileName } from '../core/types';

// 牌の画像（エディタと同じ CC0 の牌画像）をアプリ全体でも使えるようにする
let injected = false;
export function useTileCss() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const st = document.createElement('style');
  st.textContent = tilesCss.replace(/:host/g, ':root');
  document.head.appendChild(st);
}

export function Tile({ t, cls = '', title }: { t: number; cls?: string; title?: string }) {
  return <span className={`tile t${t} ${cls}`} title={title ?? tileName(t)}><span className="face" /></span>;
}
