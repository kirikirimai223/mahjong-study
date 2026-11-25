// 取り込める解析（NAGA・極雀・Miai）を、URLから見分けて読む
import { extractNaga, fetchNagaReport, nagaReportId, type NagaSummary } from './naga';
import { extractGokujan, fetchGokujan, gokujanId } from './gokujan';
import { extractMiai, fetchMiai, miaiId } from './miai';

export type Engine = 'naga' | 'mortal' | 'other';
export const ANALYSIS_HINT = 'NAGAのレポート・極雀・Miaiの解析結果のURL';

/** 取り込める解析のURLか。id（保存のときの reportId）と、保存する engine を返す */
export function analysisOf(url: string): { reportId: string; engine: Engine; site: 'NAGA' | '極雀' | 'Miai' } | null {
  const g = gokujanId(url);
  if (g) return { reportId: `gokujan:${g}`, engine: 'mortal', site: '極雀' };
  const m = miaiId(url);
  if (m) return { reportId: `miai:${m}`, engine: 'other', site: 'Miai' };
  const n = nagaReportId(url);
  if (n) return { reportId: n, engine: 'naga', site: 'NAGA' };
  return null;
}

/** 解析結果を読み、局ごとの判断にする */
export async function loadAnalysis(url: string): Promise<{ engine: Engine; summary: NagaSummary }> {
  const g = gokujanId(url);
  if (g) return { engine: 'mortal', summary: extractGokujan(await fetchGokujan(g), g) };
  const m = miaiId(url);
  if (m) return { engine: 'other', summary: extractMiai(await fetchMiai(m)) };
  const n = nagaReportId(url);
  if (n) return { engine: 'naga', summary: extractNaga(await fetchNagaReport(n), n) };
  throw new Error(`${ANALYSIS_HINT}を貼ってください`);
}
