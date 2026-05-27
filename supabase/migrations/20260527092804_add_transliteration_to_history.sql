-- Add transliteration_text column to history table
alter table public.history 
add column if not exists transliteration_text text;