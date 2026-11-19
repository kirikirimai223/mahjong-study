import { useEffect, useState } from 'react';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = 'study.installHint.dismissed';

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** ホーム画面に追加する案内。Android などは「追加する」ボタン、iPhone は共有メニューからの手順を出す */
export function InstallHint() {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => { try { return standalone() || localStorage.getItem(KEY) === '1'; } catch { return standalone(); } });
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); };
    const done = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', on);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done); };
  }, []);
  if (hidden || (!prompt && !isIOS())) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* 保存できなくても閉じるだけ */ } };
  return (
    <div className="card install">
      <div className="grow">
        <b>ホーム画面に追加</b>
        <p className="small quiet">{prompt ? 'アプリのように全画面で開けます。' : 'Safari の共有ボタン（□に↑）→「ホーム画面に追加」で、アプリのように全画面で開けます。'}</p>
      </div>
      {prompt && <button className="primary" onClick={async () => { await prompt.prompt(); const r = await prompt.userChoice; if (r.outcome === 'accepted') setHidden(true); setPrompt(null); }}>追加する</button>}
      <button className="link" onClick={dismiss}>閉じる</button>
    </div>
  );
}
