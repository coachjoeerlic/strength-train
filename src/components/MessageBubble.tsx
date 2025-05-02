import { Message } from '@/types/message';

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  ownUsername: string;
  onRetry: () => void;
  onReply: (message: Message) => void;
  onScrollToMessage: (messageId: string) => void;
}

export default function MessageBubble({ 
  message, 
  isOwnMessage, 
  ownUsername,
  onRetry,
  onReply,
  onScrollToMessage 
}: MessageBubbleProps) {
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
        return (
          <img
            src={message.media_url}
            alt="Shared media"
            className="max-w-full rounded-lg mt-2"
            loading="lazy"
          />
        );
      case 'gif':
        return (
          <div className="relative">
            <img
              src={message.media_url}
              alt="GIF"
              className="max-w-full rounded-lg mt-2"
              loading="lazy"
            />
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              GIF
            </div>
          </div>
        );
      case 'video':
        return (
          <div className="relative">
            <video
              src={message.media_url}
              controls
              className="max-w-full rounded-lg mt-2"
              preload="metadata"
            >
              <source src={message.media_url} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
            <div className="absolute top-2 right-2 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
              Video
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderReplyPreview = () => {
    if (
      !message.reply_to ||
      typeof message.reply_to !== 'object' ||
      Object.keys(message.reply_to).length === 0 ||
      !message.reply_to.user_id ||
      (!message.reply_to.content && !message.reply_to.media_url)
    ) {
      return null;
    }

    const username = message.reply_to.profiles?.username || 'Unknown user';

    return (
      <div 
        className="text-sm opacity-75 border-l-2 pl-2 mb-2 cursor-pointer hover:opacity-100"
        onClick={() => onScrollToMessage(message.reply_to_message_id!)}
      >
        <div className="font-semibold">{username}</div>
        {message.reply_to.media_url ? (
          <div className="flex items-center gap-2">
            <div className="relative w-8 h-8">
              {(message.reply_to.media_type === 'image' || message.reply_to.media_type === 'gif') && (
                <img
                  src={message.reply_to.media_url}
                  alt="Reply preview"
                  className="w-8 h-8 object-cover rounded opacity-75"
                />
              )}
              {message.reply_to.media_type === 'video' && (
                <video
                  src={message.reply_to.media_url}
                  className="w-8 h-8 object-cover rounded opacity-75"
                >
                  <source src={message.reply_to.media_url} type="video/mp4" />
                </video>
              )}
              {message.reply_to.media_type === 'video' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded">
                  <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="truncate">
              {message.reply_to.content || 
                (message.reply_to.media_type === 'image' ? 'Image' :
                 message.reply_to.media_type === 'video' ? 'Video' :
                 message.reply_to.media_type === 'gif' ? 'GIF' : 'Media')}
            </div>
          </div>
        ) : (
          <div className="truncate">{message.reply_to.content}</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`max-w-[80%] p-3 rounded-lg ${bubbleClasses} ${statusClasses[message.status]}`}
      id={`message-${message.id}`}
    >
      <div className="flex flex-col gap-2">
        <div className={`text-sm font-semibold ${isOwnMessage ? 'text-white' : 'text-gray-700'}`}>
          {isOwnMessage ? ownUsername : (message.profiles?.username || 'Unknown user')}
        </div>
        {renderReplyPreview()}
        {message.content && (
          <p className="break-words whitespace-pre-wrap">{message.content}</p>
        )}
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
          <button
            onClick={() => onReply(message)}
            className="text-sm opacity-75 hover:opacity-100"
            title="Reply to message"
          >
            ↩
          </button>
        </div>
      </div>
      <div className="text-xs mt-1 opacity-75">
        {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  );
} 