import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// ホーム画面に追加して使えるように（開発中は古い画面が残って紛らわしいので、本番だけ）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
