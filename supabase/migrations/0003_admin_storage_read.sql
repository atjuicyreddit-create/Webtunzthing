-- Pathtoon — let admins list/remove their uploaded panel images.
-- Without a SELECT rule, Supabase Storage silently refuses to delete files
-- (it must be able to "see" an object to remove it), so deleted panels left
-- their image files behind.
-- Public image URLs keep working exactly as before (the bucket is public).
-- Safe to re-run.

drop policy if exists "panels bucket: admin read" on storage.objects;
create policy "panels bucket: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'panels' and public.is_admin());
