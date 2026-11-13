import { useEffect, useState, type FormEvent } from 'react';
import { errorText, supabase } from '../lib/supabase';
import { useConfirm } from '../lib/useConfirm';

type Review = { id: string; engine: 'naga' | 'mortal' | 'other'; report_url: string; note: string; created_at: string };
const ENGINE = { naga: 'NAGA', mortal: 'Mortal', other: 'その他' } as const;
const NAGA_SITE = 'https://naga.dmv.nico/naga_report/top/';
const MORTAL_SITE = 'https://mjai.ekyu.moe/ja.html';

/** 局ごとの解析レポート（URLを残しておき、再解析せずに振り返る） */
export function Reviews({ roundId, copyUrl }: { roundId: string; copyUrl: () => Promise<string | null> }) {
  const [rows, setRows] = useState<Review[]>([]);
  const [engine, setEngine] = useState<Review['engine']>('naga');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const { confirm, isArmed } = useConfirm();

  async function load() {
    const { data, error } = await supabase.from('study_ai_reviews').select('id, engine, report_url, note, created_at').eq('round_id', roundId).order('created_at');
    if (error) return setMsg(errorText(error));
    setRows(data as Review[]);
  }
  useEffect(() => { load(); }, [roundId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(e: FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return setMsg('レポートのURL（https://…）を貼ってください');
    const { error } = await supabase.from('study_ai_reviews').insert({ round_id: roundId, engine, report_url: u, note: note.trim() });
    if (error) return setMsg(errorText(error));
    setUrl(''); setNote(''); setMsg(''); load();
  }
  async function remove(id: string) {
    if (!confirm(id)) return;
    const { error } = await supabase.from('study_ai_reviews').delete().eq('id', id);
    if (error) return setMsg(errorText(error));
    load();
  }

  return (
    <div className="reviews card stack">
      <div className="steps">
        <span>① <button className="link" onClick={async () => setMsg((await copyUrl()) ?? 'URLをコピーしました。解析サイトに貼ってください')}>この局のURLをコピー</button></span>
        <span>② <a href={NAGA_SITE} target="_blank" rel="noopener">NAGA</a>／<a href={MORTAL_SITE} target="_blank" rel="noopener">Mortal</a>で解析</span>
        <span>③ レポートのURLを下に貼る</span>
      </div>
      {rows.length > 0 && (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.id} className="row between">
              <a href={r.report_url} target="_blank" rel="noopener"><b>{ENGINE[r.engine]}</b>{r.note ? `：${r.note}` : ''}</a>
              <button className="danger small-btn" onClick={() => remove(r.id)}>{isArmed(r.id) ? '本当に削除' : '削除'}</button>
            </li>
          ))}
        </ul>
      )}
      <form className="stack" onSubmit={add}>
        <div className="row">
          <select value={engine} onChange={(e) => setEngine(e.target.value as Review['engine'])} style={{ width: 'auto' }}>
            <option value="naga">NAGA</option><option value="mortal">Mortal</option><option value="other">その他</option>
          </select>
          <input className="grow" type="url" placeholder="レポートのURL" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="row">
          <input className="grow" placeholder="メモ（モデル名・誰の視点か など）" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary">追加</button>
        </div>
      </form>
      {msg && <p className="small">{msg}</p>}
    </div>
  );
}
