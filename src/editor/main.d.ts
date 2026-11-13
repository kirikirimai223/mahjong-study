export type EditorData = {
  me: number;
  names: string[];
  rule: { disp: string; aka: number };
  setup: { kyoku: number; honba: number; kyotaku: number; scores: number[]; doraIndicators: number[]; uraIndicators: number[] };
  seats: unknown[];
  result: { kind: 'none' | 'agari' | 'ryukyoku'; [k: string]: unknown };
};
export type EditorApi = {
  getData(): EditorData;
  setData(d: EditorData): void;
  summary(): { label: string; summary: string; kyoku: number; honba: number };
  outputJson(): { json: unknown; randomizedSeats: number[] } | null;
  buildJson(): { json: unknown; randomizedSeats: number[]; error?: undefined } | { error: string; json?: undefined; randomizedSeats?: undefined };
  nextData(): { data: EditorData; finished: boolean; ambiguous: boolean; label: string; error?: undefined } | { error: string; data?: undefined };
  flash(msg: string): void;
  destroy(): void;
};
export function mountEditor(host: HTMLElement, opts?: { initial?: EditorData | null; onChange?: (d: EditorData) => void; onOutput?: () => void }): EditorApi;
