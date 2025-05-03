export type Message = {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  status: 'sending' | 'sent' | 'failed';
  media_url?: string;
  media_type?: 'image' | 'video' | 'gif';
  reply_to_message_id?: string;
  reply_to?: {
    content: string;
    user_id: string;
    media_url?: string;
    media_type?: 'image' | 'video' | 'gif';
    profiles?: {
      username: string;
    };
    is_read: boolean;
  };
  profiles?: {
    username: string;
  };
  is_read: boolean;
}; 