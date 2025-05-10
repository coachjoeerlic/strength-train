import { Message, ReactionSummary } from '@/types/message';
import { formatDistanceToNow, format } from 'date-fns';
import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { useAuth } from '@/lib/AuthContext';
import { addReaction, removeReaction } from '@/lib/reactionService';
import { Pin as PinIcon } from 'lucide-react';

// Define color generation functions here or import if moved to utils
const ACCENT_COLORS = [
  'text-red-500', 'text-orange-500', 'text-amber-500', 
  'text-lime-500', 'text-green-500', 'text-emerald-500', 
  'text-teal-500', 'text-cyan-500', 'text-sky-500', 
  'text-blue-500', 'text-indigo-500', 'text-violet-500',
  'text-purple-500', 'text-fuchsia-500', 'text-pink-500', 'text-rose-500'
];

const simpleHashCode = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
};

const getUserColor = (userId: string): string => {
  if (!userId) return 'text-gray-500'; // Default fallback
  const hash = simpleHashCode(userId);
  const index = Math.abs(hash) % ACCENT_COLORS.length;
  return ACCENT_COLORS[index];
};

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
  onOpenSuperemojiMenu: (message: Message, position: { x: number; y: number }) => void;
  onOptimisticallyToggleReaction: (messageId: string, emoji: string, currentReactionState: ReactionSummary | undefined) => void;
  onAvatarClick?: (userId: string) => void;
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
  onReturnFromReply,
  onOpenSuperemojiMenu,
  onOptimisticallyToggleReaction,
  onAvatarClick,
}: MessageBubbleProps) {
  const { user } = useAuth();
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pressStartCoordinatesRef = useRef<{ x: number; y: number } | null>(null);
  
  const swipeDetectRef = useRef<{
    startX: number | null;
    startY: number | null;
    isSwiping: boolean;
    swipedLeft: boolean;
  }>({ startX: null, startY: null, isSwiping: false, swipedLeft: false });

  // Refs and consts for double tap
  const DOUBLE_TAP_EMOJI = '❤️';
  const DOUBLE_TAP_TIMEOUT = 300; // ms
  const lastTapInfoRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const doubleTapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const SWIPE_THRESHOLD = 50;
  const MAX_VERTICAL_SWIPE_DEVIATION = 30;
  const POINTER_MOVEMENT_THRESHOLD = 10; // Combined threshold for long press and double tap spatial check

  const IS_SHORT_MESSAGE_THRESHOLD = 22;
  const isShortTextMessage =
    message.content &&
    message.content.length <= IS_SHORT_MESSAGE_THRESHOLD &&
    !message.media_url;

  if (isOwnMessage && isShortTextMessage) {
    console.log('[MessageBubble DEBUG SENDER SHORT]', {
      messageId: message.id,
      content: message.content,
      contentLength: message.content?.length,
      isShortTextMessage,
      isOwnMessage,
      timestampString: format(new Date(message.created_at), 'h:mm a'),
      newTimeStampFontSize: 'text-[11px]',
      newTimeStampColorClasses: isOwnMessage ? 'text-blue-200 opacity-90' : 'text-gray-400 opacity-90'
    });
  }

  const timeStampString = format(new Date(message.created_at), 'h:mm a');
  // Define new styles for timestamp
  const newTimeStampFontSize = 'text-[11px]'; // Slightly smaller font
  const newTimeStampColorClasses = isOwnMessage 
    ? 'text-blue-200 opacity-90' // Less highlighted for own messages
    : 'text-gray-400 opacity-90'; // Less highlighted for other's messages

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
            <div className="break-words">
              {message.reply_to.content || 
                (message.reply_to.media_type === 'image' ? 'Image' :
                 message.reply_to.media_type === 'video' ? 'Video' :
                 message.reply_to.media_type === 'gif' ? 'GIF' : 'Media')}
            </div>
          </div>
        ) : (
          <div className="break-words">{message.reply_to.content}</div>
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

  const handleToggleReaction = async (emoji: string) => {
    if (!user || !message) {
      console.error("User or message not found, cannot react");
      return;
    }

    const currentReactionSummary = message.reactions?.find(r => r.emoji === emoji);
    const isCurrentlyReactedByMe = currentReactionSummary?.reactedByCurrentUser || false;

    // Call parent for optimistic update BEFORE the async DB call
    onOptimisticallyToggleReaction(message.id, emoji, currentReactionSummary);

    try {
      if (isCurrentlyReactedByMe) { // User is removing this reaction
        await removeReaction(message.id, user.id, emoji);
      } else { // User is adding this reaction
        await addReaction(message.id, user.id, emoji);
      }
      // Actual state update will flow down from parent via props after real-time or if parent handles optimistic state based on the call above.
    } catch (error) {
      console.error("Failed to toggle reaction for emoji:", emoji, error);
      // TODO: Consider informing parent about the failure to revert optimistic update if needed.
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const clearDoubleTapTimer = () => {
    if (doubleTapTimerRef.current) {
      clearTimeout(doubleTapTimerRef.current);
      doubleTapTimerRef.current = null;
    }
  };

  const resetGestureState = () => {
    clearLongPressTimer();
    clearDoubleTapTimer();
    pressStartCoordinatesRef.current = null;
    swipeDetectRef.current = { startX: null, startY: null, isSwiping: false, swipedLeft: false };
    // lastTapInfoRef.current = null; // Do not clear lastTapInfo here, handle it in pointerDown/timer
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const currentTime = Date.now();
    const currentX = e.clientX;
    const currentY = e.clientY;

    // Check for Double Tap first
    if (lastTapInfoRef.current && 
        (currentTime - lastTapInfoRef.current.time < DOUBLE_TAP_TIMEOUT) &&
        (Math.abs(currentX - lastTapInfoRef.current.x) < POINTER_MOVEMENT_THRESHOLD) && 
        (Math.abs(currentY - lastTapInfoRef.current.y) < POINTER_MOVEMENT_THRESHOLD) ) {
      
      console.log('[DBL_TAP] Double tap detected!');
      const tapInfoForReset = lastTapInfoRef.current; // Store before reset
      resetGestureState(); // Clear other gesture states (long press, swipe)
      lastTapInfoRef.current = null; // Specifically nullify lastTapInfo to prevent triple-tap issues & reset sequence
      if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current); // Clear pending timer for this tap sequence

      const heartReactionSummary = message.reactions?.find(r => r.emoji === DOUBLE_TAP_EMOJI);
      onOptimisticallyToggleReaction(message.id, DOUBLE_TAP_EMOJI, heartReactionSummary);
      
      (async () => {
        try {
          if (heartReactionSummary?.reactedByCurrentUser) {
            await removeReaction(message.id, user!.id, DOUBLE_TAP_EMOJI);
          } else {
            await addReaction(message.id, user!.id, DOUBLE_TAP_EMOJI);
          }
        } catch (dbError) {
          console.error('[DBL_TAP] DB Error toggling heart reaction:', dbError);
        }
      })();
      return; // Double tap action performed
    }

    // Not a double tap (or first tap in a sequence) - Reset other gestures and prepare for this new press
    resetGestureState(); // Clears long press, swipe states.
    
    pressStartCoordinatesRef.current = { x: currentX, y: currentY };
    swipeDetectRef.current.startX = currentX;
    swipeDetectRef.current.startY = currentY;

    // Set this tap as the new potential start of a double tap sequence
    lastTapInfoRef.current = { time: currentTime, x: currentX, y: currentY };
    // Clear any old double tap timer and start a new one
    if (doubleTapTimerRef.current) clearTimeout(doubleTapTimerRef.current);
    doubleTapTimerRef.current = setTimeout(() => {
        lastTapInfoRef.current = null; // This tap didn't lead to a double tap
    }, DOUBLE_TAP_TIMEOUT);

    // Long Press Logic (will only run if this pointerdown doesn't become a swipe/doubletap)
    longPressTimerRef.current = setTimeout(() => {
      if (pressStartCoordinatesRef.current && !swipeDetectRef.current.isSwiping && !swipeDetectRef.current.swipedLeft) {
        onOpenSuperemojiMenu(message, pressStartCoordinatesRef.current);
      }
      longPressTimerRef.current = null; 
    }, 700);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressStartCoordinatesRef.current) return; // No active press initiated
    
    // If a swipe left action has already been completed for this gesture, do nothing further.
    if (swipeDetectRef.current.swipedLeft) return; 

    const currentX = e.clientX;
    const currentY = e.clientY;

    // Check for movement beyond threshold to cancel long press or invalidate taps
    const deltaXFromPressStart = Math.abs(currentX - pressStartCoordinatesRef.current.x);
    const deltaYFromPressStart = Math.abs(currentY - pressStartCoordinatesRef.current.y);

    if (deltaXFromPressStart > POINTER_MOVEMENT_THRESHOLD || deltaYFromPressStart > POINTER_MOVEMENT_THRESHOLD) {
      clearLongPressTimer();
      if (lastTapInfoRef.current && 
          (Math.abs(currentX - lastTapInfoRef.current.x) > POINTER_MOVEMENT_THRESHOLD || 
           Math.abs(currentY - lastTapInfoRef.current.y) > POINTER_MOVEMENT_THRESHOLD)) {
        clearDoubleTapTimer();
        lastTapInfoRef.current = null;
      }
      swipeDetectRef.current.isSwiping = true;
    }

    // Swipe detection logic - only if isSwiping is true and startX/startY are valid
    if (swipeDetectRef.current.isSwiping && 
        typeof swipeDetectRef.current.startX === 'number' && 
        typeof swipeDetectRef.current.startY === 'number') {
          
      const deltaXFromSwipeStart = currentX - swipeDetectRef.current.startX;
      const deltaYFromSwipeStart = Math.abs(currentY - swipeDetectRef.current.startY);

      if (deltaXFromSwipeStart < -SWIPE_THRESHOLD && deltaYFromSwipeStart < MAX_VERTICAL_SWIPE_DEVIATION) {
        console.log('[SWIPE_REPLY] Left swipe detected for reply');
        onReply(message);
        swipeDetectRef.current.swipedLeft = true; 
        resetGestureState(); 
      }
    }
  };

  const handlePointerUp = () => {
    // The doubleTapTimer for lastTapInfoRef handles its own cleanup for single taps that don't complete a double tap.
    // If a double tap, long press, or swipe occurred, their specific logic should call resetGestureState or clear timers.
    // Calling resetGestureState here ensures cleanup if the pointer is released without any specific gesture firing.
    resetGestureState(); 
  };
  
  useEffect(() => {
    return () => {
      resetGestureState(); // this is fine
      if(lastTapInfoRef.current) lastTapInfoRef.current = null; // Ensure clearance on unmount
    };
  }, []);

  return (
    <div className={`flex flex-col ${isOwnMessage ? 'items-end' : 'items-start'}`}>
      {/* Username display: REMOVE block for ownUsername */}
      
      {/* For other users, if their profile hasn't loaded yet to show username inside bubble, show a placeholder above */}
      {!isOwnMessage && !message.profiles?.username && (
      <div className="text-xs text-gray-500 mb-1">
          User
      </div>
      )}
      
      <div className="flex items-end gap-2">
        {!isOwnMessage && (
          <div 
            className={`flex-shrink-0 w-8 h-8 ${onAvatarClick ? 'cursor-pointer' : ''} relative translate-y-1`}
            onClick={() => onAvatarClick && message.user_id && onAvatarClick(message.user_id)}
          >
            {message.profiles?.avatar_url ? (
              <img
                src={message.profiles.avatar_url}
                alt={message.profiles.username || 'User avatar'}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
            <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                <span className="text-gray-600 text-xs">
                  {message.profiles?.username?.[0]?.toUpperCase() || '?'}
                </span>
            </div>
            )}
          </div>
        )}
        
        {isOwnMessage && isReplyJumpTarget && onReturnFromReply && (
          <button
            onClick={onReturnFromReply}
            className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 focus:outline-none animate-throb mr-1"
            aria-label="Return to reply"
            title="Return to previous message"
          >
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        
        <div className={`flex flex-col max-w-[85%] ${isOwnMessage ? 'items-end ml-auto' : 'items-start'}`}>
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
              <div className="break-words">
                <span className="font-medium">{message.reply_to.profiles ? message.reply_to.profiles.username : 'User'}: </span>
                {message.reply_to.content || (message.reply_to.media_url ? (
                  message.reply_to.media_type === 'image' ? 'Image' :
                  message.reply_to.media_type === 'video' ? 'Video' :
                  message.reply_to.media_type === 'gif' ? 'GIF' : 'Media'
                ) : '')}
              </div>
            </div>
          )}
          
          <div 
            className={`rounded-lg ${isOwnMessage ? 'bg-blue-500 text-white rounded-br-none' : 'bg-gray-200 text-gray-800 rounded-bl-none'} ${
              isReplyJumpTarget ? 'border-2 border-blue-400' : ''
            } relative group cursor-pointer ${isOwnMessage ? 'p-3' : 'pt-1.5 pb-3 px-3'}`}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onPointerMove={handlePointerMove}
            onContextMenu={(e) => {
              if (longPressTimerRef.current || swipeDetectRef.current.isSwiping || pressStartCoordinatesRef.current) { 
                 e.preventDefault();
              }
            }}
            style={{ touchAction: 'pan-y' }}
          >
            {/* New Username display INSIDE the bubble for other users */}
            {!isOwnMessage && message.profiles?.username && (
              <button
                type="button"
                onClick={() => onAvatarClick && onAvatarClick(message.user_id)}
                className={`appearance-none text-left mb-1 text-sm font-semibold cursor-pointer focus:outline-none hover:underline ${getUserColor(message.user_id)}`}
              >
                {message.profiles.username}
              </button>
            )}

            {isShortTextMessage ? (
              <div> 
                {message.content && (
                  <p 
                    className="whitespace-pre-wrap break-all mr-2 min-w-0 inline"
                    ref={(el) => {
                      if (isOwnMessage && el && message.content === 'dope') { 
                        console.log('[MessageBubble DEBUG SENDER SHORT <p> (inline)]', {
                          offsetWidth: el.offsetWidth,
                          scrollWidth: el.scrollWidth,
                          innerText: el.innerText,
                          className: el.className,
                        });
                      }
                    }}
                  >
                    {message.content}
                  </p>
                )}
                {/* Wrapper for pin icon and timestamp for short messages */}
                <div className={`inline-flex items-center relative translate-y-1 whitespace-nowrap ${newTimeStampFontSize} ${newTimeStampColorClasses}`}>
                  {message.is_pinned && <PinIcon className="h-3.5 w-3.5 mr-1 text-yellow-500 flex-shrink-0" />}
                  <span>{timeStampString}</span>
                </div>
              </div>
            ) : (
              <>
                {message.content && <p className="whitespace-pre-wrap break-all">{message.content}</p>}
                {message.media_url && renderMedia()}
                {/* Timestamp and optional pin icon for long messages */}
                <div className={`${newTimeStampFontSize} ${newTimeStampColorClasses} mt-1 text-right flex items-center justify-end`}>
                  {message.is_pinned && <PinIcon className="h-3.5 w-3.5 mr-1 text-yellow-500 flex-shrink-0" />}
                  <span>{timeStampString}</span>
                </div>
              </>
            )}

            {message.reactions && message.reactions.length > 0 && (
              <div className={`flex gap-1 mt-1 flex-wrap ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                {message.reactions.map((reaction: ReactionSummary) => (
                  <button 
                    key={reaction.emoji}
                    onClick={() => handleToggleReaction(reaction.emoji)}
                    className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors
                                ${reaction.reactedByCurrentUser 
                                  ? 'bg-blue-500 text-white hover:bg-blue-600' 
                                  : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                    title={`${reaction.reactedByCurrentUser ? 'Remove' : 'Add'} ${reaction.emoji} reaction`}
                  >
                    <span>{reaction.emoji}</span>
                    <span className={`${reaction.reactedByCurrentUser ? 'text-blue-100' : 'text-gray-700 dark:text-gray-300'}`}>
                      {reaction.count}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tail for own messages (bottom-right) */}
          {isOwnMessage && (
            <div className="absolute right-[-7px] bottom-[-1px] w-[16px] h-[16px] z-0">
              <svg viewBox="0 0 100 100" className="fill-blue-500 w-full h-full">
                <polygon points="100,100 0,100 100,25" /> 
              </svg>
            </div>
          )}

          {/* Tail for other users' messages (bottom-left) */}
          {!isOwnMessage && (
            <div className="absolute left-[-7px] bottom-[-1px] w-[16px] h-[16px] z-0">
              <svg viewBox="0 0 100 100" className="fill-gray-200 w-full h-full">
                <polygon points="0,100 100,100 0,25" /> 
              </svg>
            </div>
          )}
        </div>
        
        {!isOwnMessage && isReplyJumpTarget && onReturnFromReply && (
          <button
            onClick={onReturnFromReply}
            className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 focus:outline-none animate-throb ml-1"
            aria-label="Return to reply"
            title="Return to previous message"
          >
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
        
        <div className="flex-shrink-0 flex flex-col space-y-1 items-center">
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