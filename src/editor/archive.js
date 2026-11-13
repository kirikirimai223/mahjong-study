// 牌譜の保存先：使えるときはアカウントごとの保存領域（db）、使えないときはこのブラウザ（localStorage）
// 記録は2種類：
//   round … 1局分（エディタの入力内容と、組んだ天鳳JSON）。gameId が付いていれば半荘に属する
//   game  … 半荘（名前と作成日時。局の並びは各局の局・本場で決める）
const LOCAL_KEY = 'paifu-archive';
export const RECENT_LIMIT = 10; // 半荘に入っていない局は新しい順にこれだけ残す

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function localBackend() {
  const read = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]'); } catch { return []; } };
  const write = (recs) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(recs)); return true; } catch { return false; } };
  return {
    kind: 'local',
    async list() { return read(); },
    async put(rec) { const recs = read().filter((r) => r.id !== rec.id); recs.push(rec); if (!write(recs)) throw new Error('このブラウザに保存できませんでした（容量不足の可能性があります）'); },
    async del(id) { write(read().filter((r) => r.id !== id)); },
  };
}

function dbBackend(db, uid) {
  const col = db.collection(`data/users/${uid}`);
  const retry = async (fn) => {
    try { return await fn(); } catch (e) {
      if (e?.code !== 'unavailable') throw e;
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      return fn();
    }
  };
  return {
    kind: 'db',
    async list() { const snap = await retry(() => col.get()); return snap.docs.map((d) => d.data()).filter((r) => r && (r.type === 'round' || r.type === 'game')); },
    async put(rec) { await retry(() => col.doc(rec.id).set(JSON.parse(JSON.stringify(rec)))); },
    async del(id) { await retry(() => col.doc(id).delete()); },
  };
}

/** 保存先を決める。db が使えなければ localStorage（10秒で見切る） */
export async function openArchive() {
  const use = typeof window !== 'undefined' && window.claude?.use;
  if (!use) return localBackend();
  try {
    const timeout = new Promise((r) => setTimeout(() => r(null), 10000));
    const [db, user] = await Promise.race([Promise.all([window.claude.use('db'), window.claude.use('user')]), timeout.then(() => [null, null])]);
    const uid = db && user ? await user.id() : null;
    if (!db || !uid) return localBackend();
    const be = dbBackend(db, uid);
    // 以前このブラウザにだけ保存していた記録があれば移す
    const old = await localBackend().list();
    if (old.length) {
      for (const r of old) await be.put(r);
      try { localStorage.removeItem(LOCAL_KEY); } catch { /* 何もしない */ }
    }
    return be;
  } catch {
    return localBackend();
  }
}

/** 局の並び順（局→本場→保存した順） */
export const roundOrder = (a, b) => a.kyoku - b.kyoku || a.honba - b.honba || a.createdAt - b.createdAt;
