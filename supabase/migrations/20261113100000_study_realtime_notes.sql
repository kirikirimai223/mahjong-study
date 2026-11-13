-- 振り返り画面で、他のメンバーのコメント・結論をその場で反映する（Realtime は RLS に従う）
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_comments') then
    alter publication supabase_realtime add table public.study_comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'study_positions') then
    alter publication supabase_realtime add table public.study_positions;
  end if;
end $$;
