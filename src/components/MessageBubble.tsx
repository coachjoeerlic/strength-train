type Message = {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  status: 'sending' | 'sent' | 'failed';
  media_url?: string;
  media_type?: 'image' | 'video' | 'gif';
};

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  onRetry: () => void;
}

export default function MessageBubble({ message, isOwnMessage, onRetry }: MessageBubbleProps) {
  const bubbleClasses = isOwnMessage
    ? 'bg-blue-500 text-white ml-auto'
    : 'bg-gray-200 text-gray-800';

  const statusClasses = {
    sending: 'opacity-50',
    sent: '',
    failed: 'opacity-75',
  };

  const renderMedia = () => {
    if (!message.media_url) return null;

    switch (message.media_type) {
      case 'image':
      case 'gif':
        return (
          <img
            src={message.media_url}
            alt="Shared media"
            className="max-w-full rounded-lg mt-2"
            loading="lazy"
          />
        );
      case 'video':
        return (
          <video
            src={message.media_url}
            controls
            className="max-w-full rounded-lg mt-2"
            preload="metadata"
          >
            Your browser does not support the video tag.
          </video>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={`max-w-[80%] p-3 rounded-lg ${bubbleClasses} ${statusClasses[message.status]}`}
    >
      <div className="flex flex-col gap-2">
        {message.content && <p>{message.content}</p>}
        {renderMedia()}
        <div className="flex items-center gap-2">
          {message.status === 'failed' && (
            <button
              onClick={onRetry}
              className="text-red-500 hover:text-red-600 text-sm"
              title="Retry sending message"
            >
              ↻
            </button>
          )}
        </div>
      </div>
      <div className="text-xs mt-1 opacity-75">
        {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  );
} 