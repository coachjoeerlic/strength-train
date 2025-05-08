import { Message } from '@/types/message';
import { formatDistanceToNow, format } from 'date-fns';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

export interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  ownUsername: string;
  onRetry: () => void;
  onReply: (message: Message) => void;
  onScrollToMessage: (messageId: string) => void;
  onInitiateReplyJump?: (currentMessageId: string, originalTargetId: string) => void;
  isReplyJumpTarget?: boolean;
  onReturnFromReply?: () => void;
}

export default function MessageBubble({ 
  message, 
  isOwnMessage, 
  ownUsername,
  onRetry,
  onReply,
  onScrollToMessage,
  onInitiateReplyJump,
  isReplyJumpTarget = false,
  onReturnFromReply
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

  const handleReplyPreviewClick = () => {
    if (message.reply_to && message.reply_to_message_id) {
      if (onInitiateReplyJump) {
        onInitiateReplyJump(message.id, message.reply_to_message_id);
      } else {
        onScrollToMessage(message.reply_to_message_id);
      }
    }
  };

  return (
    <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
      <div className="text-xs text-gray-500 mb-1">
        {isOwnMessage ? ownUsername : message.profiles?.username || 'User'}
      </div>
      
      <div className="flex items-end gap-2">
        {!isOwnMessage && (
          <div className="flex-shrink-0 w-8 h-8">
            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
              <span className="text-gray-600 text-xs">{message.profiles?.username?.[0] || '?'}</span>
            </div>
          </div>
        )}
        
        <div className={`flex flex-col max-w-[85%] ${isOwnMessage ? 'items-end' : 'items-start'}`}>
          {message.reply_to && (
            <div 
              className="bg-gray-50 p-2 rounded-lg mb-1 text-sm text-gray-600 cursor-pointer flex items-center gap-2"
              onClick={handleReplyPreviewClick}
            >
              {message.reply_to.media_url && (
                <div className="relative w-8 h-8 flex-shrink-0">
                  {(message.reply_to.media_type === 'image' || message.reply_to.media_type === 'gif') && (
                    <Image 
                      src={message.reply_to.media_url} 
                      alt="Reply preview" 
                      width={32}
                      height={32}
                      className="object-cover rounded"
                    />
                  )}
                  {message.reply_to.media_type === 'video' && (
                    <div className="w-8 h-8 bg-black rounded flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    </div>
                  )}
                </div>
              )}
              <div className="truncate flex-1">
                <span className="font-medium">{message.reply_to.profiles ? message.reply_to.profiles.username : 'User'}: </span>
                {message.reply_to.content || (message.reply_to.media_url ? (
                  message.reply_to.media_type === 'image' ? 'Image' :
                  message.reply_to.media_type === 'video' ? 'Video' :
                  message.reply_to.media_type === 'gif' ? 'GIF' : 'Media'
                ) : '')}
              </div>
            </div>
          )}
          
          <div className={`p-3 rounded-lg ${isOwnMessage ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'} ${
            isReplyJumpTarget ? 'border-2 border-blue-400' : ''
          }`}>
            {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
            
            {message.media_url && (
              <div className={`mt-2 ${message.content ? 'pt-2 border-t border-gray-300' : ''}`}>
                {message.media_type === 'image' && (
                  <img 
                    src={message.media_url} 
                    alt="Shared image" 
                    className="max-w-full rounded"
                  />
                )}
                {message.media_type === 'video' && (
                  <video 
                    src={message.media_url} 
                    controls 
                    className="max-w-full rounded"
                    style={{ maxHeight: '50vh' }}
                  >
                    <source src={message.media_url} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                )}
                {message.media_type === 'gif' && (
                  <img 
                    src={message.media_url} 
                    alt="GIF" 
                    className="max-w-full rounded"
                  />
                )}
              </div>
            )}
            
            <div className={`text-xs mt-1 ${isOwnMessage ? 'text-blue-100' : 'text-gray-500'}`}>
              {format(new Date(message.created_at), 'h:mm a')}
            </div>
          </div>
        </div>
        
        {isReplyJumpTarget && onReturnFromReply && (
          <button
            onClick={onReturnFromReply}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 focus:outline-none animate-throb"
            aria-label="Return to reply"
            title="Return to previous message"
          >
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        
        <div className="flex-shrink-0 flex flex-col space-y-1">
          <button
            onClick={() => onReply(message)}
            className="text-gray-500 hover:text-gray-700 focus:outline-none"
            aria-label="Reply"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          
          {message.status === 'failed' && (
            <button
              onClick={onRetry}
              className="text-red-500 hover:text-red-700 focus:outline-none"
              aria-label="Retry sending"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 