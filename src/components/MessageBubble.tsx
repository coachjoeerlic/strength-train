type Message = {
  id: string;
  content: string;
  user_id: string;
  created_at: string;
  status: 'sending' | 'sent' | 'failed';
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

  return (
    <div
      className={`max-w-[80%] p-3 rounded-lg ${bubbleClasses} ${statusClasses[message.status]}`}
    >
      <div className="flex items-center gap-2">
        <p>{message.content}</p>
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
      <div className="text-xs mt-1 opacity-75">
        {new Date(message.created_at).toLocaleTimeString()}
      </div>
    </div>
  );
} 