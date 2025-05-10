import React, { useEffect, useRef, useState } from 'react';
import { Message } from '@/types/message';
import { Pin, PinOff, MessageSquareReply, Copy, X, Flag } from 'lucide-react';

interface ReactingUserProfile {
  id: string;
  username?: string;
  avatar_url?: string;
  emoji: string; // The emoji this user reacted with
}

interface SuperemojiMenuProps {
  message: Message | null;
  isVisible: boolean;
  position: { x: number; y: number } | null;
  reactingUsersProfiles: ReactingUserProfile[];
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  isCurrentUserAdmin?: boolean;
  onPinMessage?: (messageId: string) => void;
  onUnpinMessage?: (messageId: string) => void;
  onFlagMessage?: (messageId: string) => void;
}

const PREDEFINED_EMOJIS = ['👍', '❤️', '😂', '🎉', '🤔', '😢']; // Example emojis

const SuperemojiMenu: React.FC<SuperemojiMenuProps> = ({
  message,
  isVisible,
  position,
  reactingUsersProfiles,
  onClose,
  onSelectEmoji,
  onReply,
  onCopy,
  isCurrentUserAdmin,
  onPinMessage,
  onUnpinMessage,
  onFlagMessage,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [calculatedStyle, setCalculatedStyle] = useState<React.CSSProperties>({ opacity: 0 }); // Initially hidden
  const [emojiSearch, setEmojiSearch] = useState('');

  useEffect(() => {
    if (isVisible && position && menuRef.current) {
      const menuNode = menuRef.current;
      const menuWidth = menuNode.offsetWidth;
      const menuHeight = menuNode.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const buffer = 10; // Buffer from viewport edges
      const touchOffsetY = 25; // Try to place it a bit above the finger/cursor initially

      let idealX = position.x - menuWidth / 2; // Centered horizontally
      let idealY = position.y - menuHeight - touchOffsetY; // Above the touch point

      // Adjust horizontal position
      if (idealX < buffer) {
        idealX = buffer;
      } else if (idealX + menuWidth > viewportWidth - buffer) {
        idealX = viewportWidth - menuWidth - buffer;
      }

      // Adjust vertical position
      if (idealY < buffer) { // If it overflows top, try to place it below
        idealY = position.y + buffer + (touchOffsetY / 2); // Place below touch point
        // Re-check if placing below overflows bottom
        if (idealY + menuHeight > viewportHeight - buffer) {
            idealY = viewportHeight - menuHeight - buffer; // Clamp to bottom
        }
      } else if (idealY + menuHeight > viewportHeight - buffer) { // If it overflows bottom (when initially placed above)
         idealY = viewportHeight - menuHeight - buffer; // Clamp to bottom
      }
      
      // Ensure Y is not negative if all else fails (e.g. very small screen)
      if (idealY < buffer) idealY = buffer;

      setCalculatedStyle({
        top: `${idealY}px`,
        left: `${idealX}px`,
        opacity: 1, // Make it visible after calculation
      });
    } else if (!isVisible) {
      setCalculatedStyle({ opacity: 0 }); // Hide when not visible
    }
  }, [isVisible, position, message]); // Rerun when visibility, position, or message changes (message change might alter content thus size)

  const handleEmojiSelect = (emoji: string) => {
    onSelectEmoji(emoji);
    onClose();
  };

  const handleReply = () => {
    onReply();
    onClose();
  };

  const handleCopy = () => {
    onCopy();
    onClose();
  };

  // Click outside handler
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible, onClose]);

  if (!isVisible || !position || !message) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      id="superemoji-menu"
      className="absolute z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-2 flex flex-col gap-1 min-w-[200px] max-w-xs transition-opacity duration-100"
      style={calculatedStyle}
      onClick={(e) => e.stopPropagation()} // Prevent click propagation to MessageBubble for example
    >
      {/* Horizontal Emoji Bar */}
      <div className="flex justify-around items-center border-b border-gray-200 dark:border-gray-700 pb-2 mb-1">
        {PREDEFINED_EMOJIS.map((menuEmoji) => {
          // Check if the current user has reacted with this specific menuEmoji on the current message
          const currentUserReactionSummary = message?.reactions?.find(
            (reaction) => reaction.emoji === menuEmoji && reaction.reactedByCurrentUser
          );
          const isReactedByCurrentUser = !!currentUserReactionSummary;

          return (
            <button
              key={menuEmoji}
              onClick={() => handleEmojiSelect(menuEmoji)}
              className={`p-1.5 text-xl rounded-full transition-colors w-9 h-9 flex items-center justify-center 
                          ${isReactedByCurrentUser 
                            ? 'bg-blue-100 dark:bg-blue-800 ring-2 ring-blue-500' // Highlight style
                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'}` // Default hover
                         }
              title={`${isReactedByCurrentUser ? 'Remove' : 'React with'} ${menuEmoji}`}
            >
              {menuEmoji}
            </button>
          );
        })}
      </div>

      {/* Vertical Action Menu */}
      <div className="flex flex-col gap-0.5">
        <button
          onClick={handleReply}
          className="text-left w-full px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
        >
          Reply
        </button>
        <button
          onClick={handleCopy}
          className="text-left w-full px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
        >
          Copy Text
        </button>

        {/* Flag Message Button - visible to all users who can open the menu */}
        {message && onFlagMessage && (
          <button
            onClick={() => {
              onFlagMessage(message.id);
              onClose(); // Close menu after action
            }}
            className="text-left w-full px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center"
          >
            <Flag className="w-4 h-4 mr-2 flex-shrink-0" /> Flag Message
          </button>
        )}
      </div>

      {/* Admin actions: Pin/Unpin */}
      {isCurrentUserAdmin && message && onPinMessage && onUnpinMessage && (
        <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-0.5">
          {message.is_pinned ? (
            <button
              onClick={() => {
                onUnpinMessage(message.id);
                onClose(); // Close menu after action
              }}
              className="text-left w-full px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center"
            >
              <PinOff className="w-4 h-4 mr-2 flex-shrink-0" /> Unpin Message
            </button>
          ) : (
            <button
              onClick={() => {
                onPinMessage(message.id);
                onClose(); // Close menu after action
              }}
              className="text-left w-full px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors flex items-center"
            >
              <Pin className="w-4 h-4 mr-2 flex-shrink-0" /> Pin Message
            </button>
          )}
        </div>
      )}

      {/* User Reactions List */}
      {reactingUsersProfiles && reactingUsersProfiles.length > 0 && (
        <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-700 max-h-32 overflow-y-auto flex flex-col gap-0.5 text-sm">
          {reactingUsersProfiles.map((profile) => (
            <div key={`${profile.id}-${profile.emoji}`} className="flex items-center gap-2 p-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.username || 'User'} className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs text-gray-600 dark:text-gray-300">
                  {(profile.username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-gray-700 dark:text-gray-200 truncate">{profile.username || 'User'}</span>
              <span className="ml-auto text-lg">{profile.emoji}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SuperemojiMenu; 