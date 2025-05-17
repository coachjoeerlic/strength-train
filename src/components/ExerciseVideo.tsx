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
  const [uiLogs, setUiLogs] = useState<string[]>([]); // For on-screen debugging

  // Refs for video elements
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const reviewVideoRef = useRef<HTMLVideoElement>(null);

  const addUiLog = (message: string) => {
    console.log(message); // Keep console logs for desktop debugging
    setUiLogs(prevLogs => [message, ...prevLogs].slice(0, 10)); // Show last 10 logs
  };

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
      addUiLog('[Effect] Setting live stream to video element');
      liveVideoRef.current.srcObject = mediaStream;
    } else if (liveVideoRef.current) {
      addUiLog('[Effect] Clearing live stream from video element (mediaStream is null)');
      liveVideoRef.current.srcObject = null;
    }
    return () => { // Cleanup for THIS mediaStream instance when it changes or component unmounts
      if (mediaStream) {
        addUiLog('[Effect Cleanup] Stopping tracks for previous/current mediaStream');
        mediaStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaStream]);

  useEffect(() => {
    if (reviewVideoRef.current && videoBlobUrl) {
      addUiLog(`[Effect] Setting review video src: ${videoBlobUrl.substring(0, 50)}...`);
      reviewVideoRef.current.src = videoBlobUrl;
      reviewVideoRef.current.load();
      reviewVideoRef.current.onloadeddata = () => addUiLog('[ReviewVid] onloadeddata fired.');
      reviewVideoRef.current.onerror = (e) => addUiLog(`[ReviewVid] Error: ${JSON.stringify(e)}`);
    } else if (reviewVideoRef.current) {
      addUiLog('[Effect] Clearing review video src');
      reviewVideoRef.current.src = '';
    }
  }, [videoBlobUrl]);

  const cleanupCameraResources = (isFullCancel: boolean = true) => {
    addUiLog(`[Camera] cleanupCameraResources. Full cancel: ${isFullCancel}`);
    // Stream passed to mediaRecorder might be different or same as mediaStream state.
    // Stop tracks on both if they exist.
    if (mediaRecorder && mediaRecorder.stream && mediaRecorder.stream.active) {
        addUiLog('[Cleanup] Stopping tracks on mediaRecorder.stream');
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
    if (mediaStream && mediaStream.active) { // Check if stream is active before stopping
        addUiLog('[Cleanup] Stopping tracks on mediaStream state variable');
        mediaStream.getTracks().forEach(track => track.stop());
    }
    setMediaStream(null); // This will trigger the useEffect cleanup for the old stream if it was the one in state

    if (mediaRecorder?.state === 'recording') {
      try { addUiLog('[Cleanup] Attempting to stop active media recorder.'); mediaRecorder.stop(); }
      catch (e: any) { addUiLog(`[Cleanup] Error stopping media recorder: ${e.message}`);}
    }
    setMediaRecorder(null);
    setRecordedChunks([]);
    if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); setVideoBlobUrl(null); }
    setRecordedVideoBlob(null);

    if (isFullCancel) {
      addUiLog('[Cleanup] Setting cameraState to idle.');
      setCameraState('idle');
      setIsProcessingVideo(false);
    }
  };

  const handleOpenFormCamera = async () => {
    addUiLog('[Camera] handleOpenFormCamera: Initiated.');
    if (cameraState !== 'idle' || mediaStream || recordedVideoBlob || isProcessingVideo) {
        addUiLog(`[Camera] State not idle or resources exist (state: ${cameraState}, stream: ${!!mediaStream}, blob: ${!!recordedVideoBlob}, processing: ${isProcessingVideo}). Performing full cleanup.`);
        cleanupCameraResources(true); 
        await new Promise(resolve => setTimeout(resolve, 100)); 
    }
    if (!user) return addUiLog('[Camera] User not found, aborting open.');
    addUiLog('[Camera] Proceeding to get user media...');
    setIsProcessingVideo(true); 
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true });
      addUiLog('[Camera] New stream obtained.');
      setRecordedChunks([]); 
      setMediaStream(stream); 
      setCameraState('previewing');
    } catch (error: any) {
      addUiLog(`[Camera] Error accessing media: ${error.name} - ${error.message}`);
      cleanupCameraResources(true); 
    } finally {
      setIsProcessingVideo(false);
    }
  };

  const handleStartRecording = () => {
    setRecordedChunks([]); // Ensure chunks are reset before starting new recording
    if (mediaStream && liveVideoRef.current && liveVideoRef.current.srcObject === mediaStream && mediaStream.active) {
      addUiLog('[Rec] Stream is active and attached. Proceeding to record.');
      const options = { mimeType: 'video/webm; codecs=vp9' };
      let recorder: MediaRecorder | undefined;
      try { recorder = new MediaRecorder(mediaStream, options); addUiLog('[Rec] Using webm/vp9'); }
      catch (e) {
        try { recorder = new MediaRecorder(mediaStream, { mimeType: 'video/webm' }); addUiLog('[Rec] Using webm'); }
        catch (e2) { recorder = new MediaRecorder(mediaStream); addUiLog('[Rec] Using OS default codec');}
      }
      if (!recorder) { addUiLog('[Rec] Failed to initialize MediaRecorder.'); setCameraState('previewing'); return; }
      setMediaRecorder(recorder);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) { addUiLog(`[Rec] ondataavailable: chunk size ${event.data.size}`); setRecordedChunks((prev) => [...prev, event.data]); }
        else { addUiLog('[Rec] ondataavailable: chunk size 0'); }
      };
      recorder.onstop = () => {
        const currentChunks = recordedChunks;
        addUiLog(`[Rec] onstop. Chunks collected: ${currentChunks.length}`);
        
        // Stream associated with this specific recorder instance is stopped by the browser when recorder.stop() is effective
        // or when all tracks end. We have already nulled our main mediaStream state if we are here from a normal stop.
        // However, ensure our state `mediaStream` is nulled if it hasn't been already (e.g. if onstop is called by other means)
        if (mediaStream && mediaStream.active) {
            addUiLog('[Rec OnStop] Ensuring main mediaStream state tracks are stopped.');
            mediaStream.getTracks().forEach(track => track.stop());
            setMediaStream(null);
        }

        if (currentChunks.length > 0) {
          const blobMimeType = recorder?.mimeType || 'video/webm'; 
          const blob = new Blob(currentChunks, { type: blobMimeType });
          addUiLog(`[Rec] Blob created. Size: ${blob.size}, Type: ${blob.type}`);
          setRecordedVideoBlob(blob);
          const newUrl = URL.createObjectURL(blob);
          addUiLog(`[Rec] Blob URL: ${newUrl.substring(0,50)}...`);
          setVideoBlobUrl(newUrl);
          setCameraState('reviewing');
        } else {
          addUiLog('[Rec] No chunks recorded in onstop. Triggering retake.');
          handleRetakeVideo(); 
        }
        setRecordedChunks([]); 
      };
      try {
        recorder.start(250); 
        setCameraState('recording');
      } catch (e: any) {
        addUiLog(`[Rec] Error starting recorder: ${e.message}`);
        setCameraState('previewing');
      }
    } else {
      addUiLog('[Rec] Stream not ready/active or not attached for recording.');
      if (!mediaStream || !mediaStream.active) addUiLog(`[Rec] Abort cause: mediaStream is null or inactive. Active: ${mediaStream?.active}`);
      if (!liveVideoRef.current) addUiLog('[Rec] Abort cause: liveVideoRef.current is null');
      if (liveVideoRef.current && liveVideoRef.current.srcObject !== mediaStream) addUiLog('[Rec] Abort cause: srcObject mismatch');
      // If stream is bad, try a full restart of camera opening process
      handleRetakeVideo();
    }
  };

  const handleRetakeVideo = () => {
    addUiLog('[Camera] handleRetakeVideo called.');
    cleanupCameraResources(false); // Clean resources, but don't set to idle yet
    handleOpenFormCamera(); // Re-initiates camera opening which includes its own cleanup and state setting
  };

  const handleStopRecording = () => { 
    addUiLog('[Camera] handleStopRecording called.');
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    else addUiLog('[Camera] StopRec: No active/recording recorder.');
  };

  const handleCancelCamera = () => { addUiLog('[Camera] Full cancel initiated.'); cleanupCameraResources(true); };

  const handleSendVideo = async () => {
    if (!user || !recordedVideoBlob) {
      addUiLog('[Send] User or blob missing.');
      return;
    }
    addUiLog('[Send] Starting video send process...');
    setIsProcessingVideo(true);
    try {
      // Find the one-on-one chat with Coach Joe first to get targetChatId
      const COACH_USER_ID = '5db7397a-c516-4d39-ab84-a13bd337d2e6'; 
      let targetChatId: string | null = null;
      addUiLog('[Send] Finding DM chat with Coach Joe...');
      const { data: commonChats, error: commonChatsError } = await supabase.from('chat_participants').select('chat_id, user_id').in('user_id', [user.id, COACH_USER_ID]);
      
      if (commonChatsError) { addUiLog(`[Send] Error finding common chats: ${commonChatsError.message}`); throw commonChatsError; }
      
      if (commonChats) {
        const chatCounts = commonChats.reduce((acc, p) => { acc[p.chat_id] = (acc[p.chat_id] || 0) + 1; return acc; }, {} as Record<string,number>);
        for (const chatIdKey in chatCounts) {
          if (chatCounts[chatIdKey] === 2) {
            const { count: memberCount } = await supabase.from('chat_participants').select('user_id', {count: 'exact', head: true}).eq('chat_id', chatIdKey);
            if (memberCount === 2) { targetChatId = chatIdKey; break; }
          }
        }
      }

      if (!targetChatId) { addUiLog('[Send] Coach DM chat ID not found!'); throw new Error('Coach DM chat ID not found'); }
      addUiLog(`[Send] Target DM chat ID: ${targetChatId}`);

      const fileExt = recordedVideoBlob.type.split('/')[1]?.split(';')[0] || 'webm';
      // Standardized path: UPLOADER_USER_ID/TARGET_CHAT_ID/UNIQUE_FILENAME.ext
      const filePath = `${user.id}/${targetChatId}/${Date.now()}.${fileExt}`;
      addUiLog(`[Send] Uploading to path: ${filePath}`);
      
      const { error: uploadError } = await supabase.storage
        .from('chat_media') // Ensure this bucket name is correct
        .upload(filePath, recordedVideoBlob, { contentType: recordedVideoBlob.type, upsert: false });

      if (uploadError) { addUiLog(`[Send] Upload Error: ${uploadError.message}`); throw uploadError; }
      addUiLog('[Send] Upload successful.');

      const { data: { publicUrl } } = supabase.storage.from('chat_media').getPublicUrl(filePath);
      if (!publicUrl) { addUiLog('[Send] Failed to get public URL.'); throw new Error('Failed to get public URL'); }
      addUiLog(`[Send] Public URL: ${publicUrl.substring(0,50)}...`);
      
      await supabase.from('messages').insert({
        chat_id: targetChatId, 
        user_id: user.id,
        content: `Form check for ${exercise.name}`,
        media_url: publicUrl, 
        media_type: 'video'
      });
      addUiLog('[Send] Message sent to DB.');

      onChatClick(); 
      cleanupCameraResources(true);
    } catch (error: any) {
      addUiLog(`[Send] Error in send process: ${error.message}`);
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

  // --- UI LOGS DISPLAY ---
  const UiLogDisplay = () => (
    <div style={{position: 'fixed', bottom: '70px', left: '10px', right: '10px', maxHeight: '100px', overflowY: 'scroll', backgroundColor: 'rgba(0,0,0,0.7)', color: 'lightgreen', padding: '5px', zIndex: 100, fontSize: '10px', borderRadius: '5px'}}>
      {uiLogs.map((log, index) => <div key={index}>{log}</div>)}
    </div>
  );

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
        <UiLogDisplay />
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
        <UiLogDisplay />
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