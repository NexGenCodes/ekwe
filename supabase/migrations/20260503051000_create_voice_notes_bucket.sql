insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice_notes',
  'voice_notes',
  false,
  26214400, -- 25MB
  array['audio/m4a', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/x-m4a']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = array['audio/m4a', 'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/x-m4a'];

-- RLS Policies for the bucket
create policy "Users can upload their own voice notes"
  on storage.objects for insert
  with check ( bucket_id = 'voice_notes' and auth.uid() = owner );

create policy "Users can read their own voice notes"
  on storage.objects for select
  using ( bucket_id = 'voice_notes' and auth.uid() = owner );

create policy "Users can delete their own voice notes"
  on storage.objects for delete
  using ( bucket_id = 'voice_notes' and auth.uid() = owner );
