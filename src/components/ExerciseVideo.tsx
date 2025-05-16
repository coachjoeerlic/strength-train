import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, MessageCircle, Video, ChevronRight, XCircle, Circle, Square, Send, RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import type { Exercise } from '@/types/workouts';

interface ExerciseVideoProps {
  exercise: Exercise;
  onBack: () => void;
  onChatClick: () => void;
  onComplete?: () => void;
  showButtons?: boolean;
  isPerformanceVideo?: boolean;
  hasNextVideo?: boolean;
  onNextVideo?: () => void;
  isFinalVideo?: boolean;
  onProceedToWorkouts?: () => void;
}

export function ExerciseVideo({ 
  exercise, 
  onBack, 
  onChatClick,
  onComplete, 
  showButtons = true,
  isPerformanceVideo = false,
  hasNextVideo = false,
  onNextVideo,
  isFinalVideo = false,
  onProceedToWorkouts
}: ExerciseVideoProps) {
  const { user } = useAuth();
  const exerciseVideoRef = useRef<HTMLVideoElement>(null);
  const [videoCompleted, setVideoCompleted] = useState(false);

  // New state variables for custom camera logic
  const [cameraState, setCameraState] = useState<'idle' | 'previewing' | 'recording' | 'reviewing'>('idle');
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [recordedVideoBlob, setRecordedVideoBlob] = useState<Blob | null>(null); // Store the actual blob for upload
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [isProcessingVideo, setIsProcessingVideo] = useState(false); // For loading states

  // Refs for video elements
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);

  // Reset videoCompleted state when exercise changes
  useEffect(() => {
    setVideoCompleted(false);
  }, [exercise.id]);

  useEffect(() => {
    if (exerciseVideoRef.current) {
      const handleVideoEnd = () => {
        setVideoCompleted(true);
        onComplete?.();
      };
      
      exerciseVideoRef.current.addEventListener('ended', handleVideoEnd);
      
      return () => {
        exerciseVideoRef.current?.removeEventListener('ended', handleVideoEnd);
      };
    }
  }, [onComplete]);

  // Effect to handle setting the live video stream to the video element
  useEffect(() => {
    if (liveVideoRef.current && mediaStream) {
      liveVideoRef.current.srcObject = mediaStream;
    } else if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null; // Clear if stream is null
    }
    // Modified cleanup: only stop tracks if camera state is idle or if stream is being replaced
    // Actual stopping of tracks on cancel/finish is handled by specific functions.
    return () => {
      if (cameraState === 'idle' && mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaStream, cameraState]);

  useEffect(() => {
    if (reviewVideoRef.current && videoBlobUrl) {
      reviewVideoRef.current.src = videoBlobUrl;
      reviewVideoRef.current.load(); // Ensure video loads with new src
    }
  }, [videoBlobUrl]);

  const handleOpenFormCamera = async () => {
    if (!user) return;
    console.log('[Camera] Attempting to open form camera');
    setIsProcessingVideo(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' }, 
        audio: true 
      });
      setMediaStream(stream);
      setCameraState('previewing');
      console.log('[Camera] Stream obtained, state set to previewing');
    } catch (error) {
      console.error('Error accessing camera/microphone:', error);
      // TODO: Add user-facing toast notification for permissions error
      setCameraState('idle');
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const handleStartRecording = () => {
    if (mediaStream) {
      console.log('[Camera] Starting recording');
      setRecordedChunks([]);
      // Determine a preferred MIME type if possible, falling back to default
      const options = { mimeType: 'video/webm; codecs=vp9' }; // VP9 is widely supported
      let recorder;
      try {
        recorder = new MediaRecorder(mediaStream, options);
      } catch (e) {
        console.warn('[Camera] WebM with VP9 not supported, trying default:', e);
        try {
            recorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' });
        } catch (e2) {
            console.warn('[Camera] WebM (default) not supported, trying OS default:', e2);
            recorder = new MediaRecorder(mediaStream); // Let the browser pick
        }
      }
      console.log('[Camera] Using mimeType:', recorder.mimeType);
      setMediaRecorder(recorder);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          setRecordedChunks((prev) => [...prev, event.data]);
        }
      };

      recorder.onstop = () => {
        console.log('[Camera] Recording stopped. Chunks collected:', recordedChunks.length);
        if (recordedChunks.length > 0) { // Ensure chunks were actually collected
          // Use the mimeType from the recorder instance if available, otherwise default
          const blobMimeType = mediaRecorder?.mimeType || 'video/webm';
          const blob = new Blob(recordedChunks, { type: blobMimeType });
          setRecordedVideoBlob(blob); // Store the blob
          console.log('[Camera] Video blob created:', blob, 'URL:', URL.createObjectURL(blob));
          setVideoBlobUrl(URL.createObjectURL(blob));
          setCameraState('reviewing');
        } else {
            console.warn('[Camera] No data chunks recorded, returning to previewing state.');
            setCameraState('previewing'); // Or idle, depending on desired UX
        }
        // Stop media stream tracks after recording is done and blob is created.
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            setMediaStream(null);
        }
        setRecordedChunks([]); // Clear chunks after processing
      };

      recorder.start();
      setCameraState('recording');
    } else {
      console.error('[Camera] MediaStream not available to start recording');
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      console.log('[Camera] Stopping recording via button');
      mediaRecorder.stop();
      // onstop handler will manage state transition and stream cleanup
    } else {
      console.warn('[Camera] Stop recording called but no active recorder or not recording.');
    }
  };

  const handleCancelCamera = () => {
    console.log('[Camera] Cancelling camera operation');
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      setMediaStream(null);
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop(); // Stop recording if active
    }
    setMediaRecorder(null);
    setRecordedChunks([]);
    if (videoBlobUrl) {
      URL.revokeObjectURL(videoBlobUrl);
      setVideoBlobUrl(null);
    }
    setRecordedVideoBlob(null);
    setCameraState('idle');
    setIsProcessingVideo(false);
  };

  const handleRetakeVideo = () => {
    handleCancelCamera();
    handleOpenFormCamera(); 
  };

  const handleSendVideo = async () => {
    if (!user || !recordedVideoBlob) return;
    setIsProcessingVideo(true);
    try {
      const fileExt = recordedVideoBlob.type.split('/')[1] || 'webm';
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('chat_media')
        .upload(fileName, recordedVideoBlob, { contentType: recordedVideoBlob.type });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('chat_media')
        .getPublicUrl(fileName);

      if (!publicUrl) throw new Error('Failed to get public URL for video.');

      // Find the one-on-one chat with Coach Joe
      // This logic is similar to handleCoachChatClick in Workouts.tsx
      // For simplicity, assuming COACH_USER_ID is defined or accessible here
      // Or, better, this component should already know the target chat ID if it's specific.
      // For now, let's use the hardcoded COACH_USER_ID for direct DM.
      const COACH_USER_ID = '5db7397a-c516-4d39-ab84-a13bd337d2e6'; // Ensure this is correct
      let targetChatId: string | null = null;

      // Simplified DM finding logic (could be refactored into a shared utility)
      const { data: commonChats, error: commonChatsError } = await supabase
        .from('chat_participants')
        .select('chat_id, user_id')
        .in('user_id', [user.id, COACH_USER_ID]);

      if (commonChatsError) throw commonChatsError;

      if (commonChats) {
        const chatCounts = commonChats.reduce((acc, p) => { acc[p.chat_id] = (acc[p.chat_id] || 0) + 1; return acc; }, {} as Record<string,number>);
        for (const chatIdKey in chatCounts) {
          if (chatCounts[chatIdKey] === 2) {
            const { count: memberCount } = await supabase.from('chat_participants').select('user_id', {count: 'exact', head: true}).eq('chat_id', chatIdKey);
            if (memberCount === 2) { targetChatId = chatIdKey; break; }
          }
        }
      }
      
      if (!targetChatId) {
        // This case should ideally not happen if the chat is auto-created on sign-up
        // or handleCoachChatClick in Workouts already established it.
        // For robustness, could create it here too, but that might duplicate logic.
        console.error('Coach Joe DM chat not found. Video not sent to specific DM.');
        // Fallback: Maybe send to a general admin chat or error out?
        // For now, let's assume onChatClick() navigates somewhere generic if chat not found.
        throw new Error('Target DM chat with Coach Joe not found.');
      }

      await supabase.from('messages').insert({
        chat_id: targetChatId, 
        user_id: user.id,
        content: `Form check for ${exercise.name}`,
        media_url: publicUrl,
        media_type: 'video'
      });

      onChatClick(); // Navigate to chat (as passed by parent)
      handleCancelCamera(); // Reset everything
    } catch (error) {
      console.error('Error sending video:', error);
      // TODO: Show toast to user
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const handleFormSubmit_OLD = async () => {
    if (!user) return;
    // ... existing logic from original handleFormSubmit ...
    // This will be integrated into handleSendVideo() later.
  };

  const handleNextVideo = () => {
    if (videoCompleted && hasNextVideo && onNextVideo) {
      onNextVideo();
    }
  };

  const handleProceedToWorkouts = () => {
    if (videoCompleted && isFinalVideo && onProceedToWorkouts) {
      onProceedToWorkouts();
    }
  };

  // CONDITIONAL UI FOR CAMERA STATES
  if (cameraState === 'previewing' || cameraState === 'recording') {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4">
        <video 
          ref={liveVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className="w-full h-auto max-h-[70vh] rounded-lg mb-4 bg-gray-800"
          style={{ transform: 'scaleX(-1)' }} // Mirror front camera for selfie view
        />
        <div className="flex space-x-6 items-center">
          {/* Placeholder for potential flip camera button or timer */}
          <div className="w-12 h-12"></div> 

          {cameraState === 'previewing' && (
            <button 
              onClick={handleStartRecording}
              className="p-4 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 focus:outline-none ring-2 ring-offset-2 ring-offset-black ring-white transition-all duration-150 ease-in-out active:bg-red-700"
              aria-label="Start Recording"
            >
              <Circle size={32} strokeWidth={2} fill="white"/>
            </button>
          )}
          {cameraState === 'recording' && (
            <button 
              onClick={handleStopRecording}
              className="p-4 bg-white text-red-500 rounded-full shadow-lg hover:bg-gray-200 focus:outline-none ring-2 ring-offset-2 ring-offset-black ring-red-500 transition-all duration-150 ease-in-out active:bg-gray-300"
              aria-label="Stop Recording"
            >
              <Square size={30} strokeWidth={2.5} fill="currentColor" />
            </button>
          )}

          <button 
            onClick={handleCancelCamera}
            className="p-3 bg-gray-700 text-white rounded-full shadow-lg hover:bg-gray-600 focus:outline-none transition-colors"
            aria-label="Cancel"
          >
            <XCircle size={28} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  if (cameraState === 'reviewing') {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4">
        <h3 className="text-xl font-semibold text-white mb-4">Review Your Video</h3>
        <video 
          ref={reviewVideoRef} 
          controls 
          playsInline 
          src={videoBlobUrl || ''} 
          className="w-full h-auto max-h-[60vh] rounded-lg mb-6 bg-gray-800"
        />
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 w-full max-w-xs">
          <button 
            onClick={handleSendVideo}
            disabled={isProcessingVideo}
            className="flex-1 p-3 bg-green-500 text-white rounded-lg shadow-lg hover:bg-green-600 disabled:bg-green-300 transition-colors flex items-center justify-center"
          >
            {isProcessingVideo ? 'Sending...' : <><Send size={20} className="mr-2"/> Send Video</>}
          </button>
          <button 
            onClick={handleRetakeVideo}
            disabled={isProcessingVideo}
            className="flex-1 p-3 bg-yellow-500 text-white rounded-lg shadow-lg hover:bg-yellow-600 disabled:opacity-50 transition-colors flex items-center justify-center"
          >
            <RotateCcw size={20} className="mr-2"/> Retake
          </button>
        </div>
        <button 
            onClick={handleCancelCamera}
            disabled={isProcessingVideo}
            className="mt-6 p-2 text-gray-300 hover:text-white transition-colors"
            aria-label="Cancel Review"
          >
            Cancel
        </button>
      </div>
    );
  }

  // Default UI (Exercise details, original video player, action buttons)
  return (
    <div className="bg-[#5D90DE] shadow rounded-lg border border-[#4A7BC7]">
      {/* Back Button */}
      <div className="p-4 border-b border-[#4A7BC7] bg-black">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="text-white hover:text-gray-300 font-medium flex items-center"
            >
              <ChevronLeft className="h-5 w-5" />
              Back
            </button>
            <h2 className="text-2xl font-bold text-white text-center">{exercise.name}</h2>
          </div>
        </div>
      </div>

      {/* Video Section */}
      <div className="aspect-w-16 aspect-h-9">
        <video
          ref={exerciseVideoRef}
          src={exercise.videoUrl}
          controls
          className="w-full h-full object-cover"
          poster="https://images.unsplash.com/photo-1594737625785-a6cbdabd333c?auto=format&fit=crop&q=80&w=2000"
        >
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Exercise Details */}
      <div className="p-6 border-b border-[#4A7BC7]">
        <p className="text-white">
          {exercise.description || 'Perfect your form with this exercise demonstration.'}
        </p>
      </div>

      {/* Next Video Button for Performance Videos */}
      {isPerformanceVideo && hasNextVideo && (
        <div className="p-4 border-b border-[#4A7BC7] flex justify-center">
          <button
            onClick={handleNextVideo}
            disabled={!videoCompleted}
            className={`
              flex items-center justify-center px-6 py-3 rounded-lg 
              transition-all duration-300 border font-semibold
              ${videoCompleted 
                ? 'bg-gradient-to-r from-[#4A7BC7] to-[#5D90DE] text-white border-white shadow-[0_0_12px_rgba(74,123,199,0.9)] animate-pulse hover:shadow-[0_0_20px_rgba(74,123,199,1)]' 
                : 'bg-gray-600 text-gray-300 border-gray-500 cursor-not-allowed opacity-60'
              }
            `}
          >
            <span className="mr-2">Next Video</span>
            <ChevronRight className={`h-5 w-5 ${videoCompleted ? 'text-white drop-shadow-[0_0_8px_#ffffff]' : 'text-gray-300'}`} />
          </button>
        </div>
      )}

      {/* Proceed to Workouts Button for Final Performance Video */}
      {isPerformanceVideo && isFinalVideo && (
        <div className="p-4 border-b border-[#4A7BC7] flex justify-center">
          <button
            onClick={handleProceedToWorkouts}
            disabled={!videoCompleted}
            className={`
              flex items-center justify-center px-6 py-3 rounded-lg 
              transition-all duration-300 border font-semibold w-3/4
              ${videoCompleted 
                ? 'bg-gradient-to-r from-[#4A7BC7] to-[#5D90DE] text-white border-white shadow-[0_0_15px_rgba(74,123,199,0.9)] animate-pulse hover:shadow-[0_0_25px_rgba(74,123,199,1)]' 
                : 'bg-gray-600 text-gray-300 border-gray-500 cursor-not-allowed opacity-60'
              }
            `}
          >
            <span className="mr-2">Proceed to Workouts</span>
            <ChevronRight className={`h-5 w-5 ${videoCompleted ? 'text-white drop-shadow-[0_0_8px_#ffffff]' : 'text-gray-300'}`} />
          </button>
        </div>
      )}

      {/* Action Buttons */}
      {showButtons && (
        <div className="p-6 grid grid-cols-2 gap-4">
          <button
            onClick={onChatClick}
            className="flex items-center justify-center px-4 py-3 bg-gradient-to-r from-[#4A7BC7] to-[#5D90DE] text-white rounded-lg hover:from-[#5D90DE] hover:to-[#4A7BC7] transition-all duration-300 border border-white shadow-[0_0_6px_rgba(74,123,199,0.6)]"
          >
            <MessageCircle className="h-5 w-5 mr-2 text-white drop-shadow-[0_0_8px_#ffffff] filter-none" />
            <span className="font-semibold">Coach Chat</span>
          </button>
          <button
            onClick={handleOpenFormCamera}
            disabled={isProcessingVideo || cameraState !== 'idle'}
            className="flex items-center justify-center px-4 py-3 bg-gradient-to-r from-[#4A7BC7] to-[#5D90DE] text-white rounded-lg hover:from-[#5D90DE] hover:to-[#4A7BC7] transition-all duration-300 border border-white shadow-[0_0_6px_rgba(74,123,199,0.6)]"
          >
            {isProcessingVideo ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Opening...
              </>
            ) : (
              <>
                <Video className="h-5 w-5 mr-2 text-white drop-shadow-[0_0_8px_#ffffff] filter-none" />
                <span className="font-semibold">Send In Form</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
} 