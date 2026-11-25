-- NAGAの解析結果（打牌ごとの推奨と評価）をレポートから取り込んで持っておく。生のレポートは大きいので、振り返りに使う部分だけ
alter table public.study_ai_reviews add column naga jsonb;
