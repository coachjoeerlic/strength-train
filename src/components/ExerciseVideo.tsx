import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { ChevronLeft, MessageCircle, Video, ChevronRight } from 'lucide-react';
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoCompleted, setVideoCompleted] = useState(false);

  // Reset videoCompleted state when exercise changes
  useEffect(() => {
    setVideoCompleted(false);
  }, [exercise.id]);

  useEffect(() => {
    if (videoRef.current) {
      const handleVideoEnd = () => {
        setVideoCompleted(true);
        onComplete?.();
      };
      
      videoRef.current.addEventListener('ended', handleVideoEnd);
      
      return () => {
        videoRef.current?.removeEventListener('ended', handleVideoEnd);
      };
    }
  }, [onComplete]);

  const handleFormSubmit = async () => {
    if (!user) return;
    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      
      // Create a video element to show the camera feed
      const videoElement = document.createElement('video');
      videoElement.srcObject = stream;
      videoElement.play();

      // Create a MediaRecorder instance
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Create a blob from the recorded chunks
        const blob = new Blob(chunks, { type: 'video/webm' });
        
        // Upload the video to Supabase storage
        const fileName = `${user.id}/${Date.now()}.webm`;
        const { error: uploadError } = await supabase.storage
          .from('chat_media')
          .upload(fileName, blob);

        if (uploadError) throw uploadError;

        // Get the public URL of the uploaded video
        const { data: { publicUrl } } = supabase.storage
          .from('chat_media')
          .getPublicUrl(fileName);

        // Find the admin chat group for the user
        const { data: groups } = await supabase
          .from('chat_groups')
          .select('id')
          .like('name', 'Admin Chat%')
          .single();

        if (!groups?.id) throw new Error('Admin chat not found');

        // Send the video in the chat
        await supabase.from('chat_messages').insert({
          group_id: groups.id,
          user_id: user.id,
          content: `Form check for ${exercise.name}`,
          media_url: publicUrl,
          media_type: 'video'
        });

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());

        // Navigate to chat
        onChatClick();
      };

      // Start recording
      mediaRecorder.start();

      // Stop recording after 30 seconds
      setTimeout(() => {
        mediaRecorder.stop();
      }, 30000);

    } catch (error) {
      console.error('Error recording video:', error);
      // alert('Failed to access camera or upload video');
    }
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
          ref={videoRef}
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
            onClick={handleFormSubmit}
            className="flex items-center justify-center px-4 py-3 bg-gradient-to-r from-[#4A7BC7] to-[#5D90DE] text-white rounded-lg hover:from-[#5D90DE] hover:to-[#4A7BC7] transition-all duration-300 border border-white shadow-[0_0_6px_rgba(74,123,199,0.6)]"
          >
            <Video className="h-5 w-5 mr-2 text-white drop-shadow-[0_0_8px_#ffffff] filter-none" />
            <span className="font-semibold">Send In Form</span>
          </button>
        </div>
      )}
    </div>
  );
} 