-- Create a new storage bucket for chat media
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', true);

-- Set up storage policies
CREATE POLICY "Allow authenticated users to upload media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
);

CREATE POLICY "Allow authenticated users to read media"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'chat-media');

-- Add media columns to messages table
ALTER TABLE messages
ADD COLUMN media_url TEXT,
ADD COLUMN media_type TEXT CHECK (media_type IN ('image', 'video', 'gif')); 