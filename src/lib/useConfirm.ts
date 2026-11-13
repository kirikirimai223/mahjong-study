import { useEffect, useState } from 'react';

/** 消す操作は2回押しで確定（4秒たつと元に戻る） */
export function useConfirm() {
  const [armed, setArmed] = useState<string | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return {
    isArmed: (key: string) => armed === key,
    /** 1回目は false（構える）、2回目で true */
    confirm(key: string) {
      if (armed === key) { setArmed(null); return true; }
      setArmed(key);
      return false;
    },
  };
}
