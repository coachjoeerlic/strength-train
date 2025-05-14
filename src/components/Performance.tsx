import React, { useState } from 'react';
import { User } from '@supabase/supabase-js';
import { ChevronRight } from 'lucide-react';
import { ExerciseVideo } from '@/components/ExerciseVideo';

interface PerformanceProps {
  user: User;
  initialVideoId?: string;
  onVideoSelect: (videoId: string) => void;
  onChatClick: () => void;
}

interface Tutorial {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  videoUrl: string;
  duration: string;
  coach: string;
}

const tutorials: Tutorial[] = [
  {
    id: '1',
    name: 'Proper Breathing Techniques',
    description: 'Master the art of breathing for maximum power and stability during lifts',
    thumbnail: 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: '15:30',
    coach: 'Sarah Johnson'
  },
  {
    id: '2',
    name: 'Core Bracing Fundamentals',
    description: 'Learn how to properly brace your core for heavy lifts',
    thumbnail: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    duration: '12:45',
    coach: 'Mike Chen'
  },
  {
    id: '3',
    name: 'Recovery Optimization',
    description: 'Essential techniques for faster recovery between training sessions',
    thumbnail: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    duration: '20:15',
    coach: 'Emma Wilson'
  },
  {
    id: '4',
    name: 'Mental Preparation',
    description: 'Develop a strong mindset for better performance',
    thumbnail: 'https://images.unsplash.com/photo-1593164842264-854604db2260?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    duration: '18:20',
    coach: 'Dr. James Lee'
  },
  {
    id: '5',
    name: 'Nutrition for Strength',
    description: 'Optimize your nutrition for maximum strength gains',
    thumbnail: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
    duration: '25:10',
    coach: 'Lisa Martinez'
  },
  {
    id: '6',
    name: 'Mobility for Lifters',
    description: 'Essential mobility work for better lifting mechanics',
    thumbnail: 'https://images.unsplash.com/photo-1517637382994-f02da38c6728?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    duration: '22:45',
    coach: 'Tom Bradley'
  },
  {
    id: '7',
    name: 'Progressive Overload',
    description: 'Understanding and implementing progressive overload effectively',
    thumbnail: 'https://images.unsplash.com/photo-1534368420009-621bfab424a8?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
    duration: '16:30',
    coach: 'Chris Parker'
  },
  {
    id: '8',
    name: 'Sleep Optimization',
    description: 'Maximize your recovery through better sleep habits',
    thumbnail: 'https://images.unsplash.com/photo-1541781774459-bb2af2f05b55?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    duration: '19:15',
    coach: 'Dr. Rachel Kim'
  },
  {
    id: '9',
    name: 'Injury Prevention',
    description: 'Key strategies to prevent common training injuries',
    thumbnail: 'https://images.unsplash.com/photo-1576678927484-cc907957088c?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    duration: '21:40',
    coach: 'Dr. Mark Thompson'
  },
  {
    id: '10',
    name: 'Deload Strategies',
    description: 'How to properly implement deload weeks for optimal gains',
    thumbnail: 'https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?auto=format&fit=crop&q=80&w=1000',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
    duration: '17:55',
    coach: 'Sarah Anderson'
  }
];

export function Performance({ user, initialVideoId, onVideoSelect, onChatClick }: PerformanceProps) {
  const [selectedTutorial, setSelectedTutorial] = useState<Tutorial | null>(() => {
    if (initialVideoId) {
      return tutorials.find(t => t.id === initialVideoId) || null;
    }
    return null;
  });

  const handleTutorialSelect = (tutorial: Tutorial) => {
    setSelectedTutorial(tutorial);
    onVideoSelect(tutorial.id);
  };

  const handleBack = () => {
    setSelectedTutorial(null);
    onVideoSelect('');
  };

  if (selectedTutorial) {
    // Hide buttons for specific tutorials
    const hideButtonsFor = ['1', '2', '3', '4', '9']; // IDs matching the specified exercise names
    const showButtons = !hideButtonsFor.includes(selectedTutorial.id);
    
    return (
      <ExerciseVideo
        exercise={{
          id: selectedTutorial.id,
          name: selectedTutorial.name,
          sets: 1,
          reps: selectedTutorial.duration,
          videoUrl: selectedTutorial.videoUrl,
          description: selectedTutorial.description
        }}
        onBack={handleBack}
        onChatClick={onChatClick}
        showButtons={showButtons}
      />
    );
  }

  return (
    <div className="bg-[#5D90DE] shadow rounded-lg p-6 border border-[#4A7BC7]">
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-white text-center">Performance Enhancement Tutorials</h2>
        <div className="space-y-4">
          {tutorials.map((tutorial) => (
            <button
              key={tutorial.id}
              onClick={() => handleTutorialSelect(tutorial)}
              className="w-full bg-[#5D90DE] rounded-lg shadow hover:shadow-md transition-all duration-200 overflow-hidden border border-[#4A7BC7]"
            >
              <div className="flex items-center">
                <div className="w-48 h-32 flex-shrink-0">
                  <img
                    src={tutorial.thumbnail}
                    alt={tutorial.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 p-4 text-left">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-semibold text-white">{tutorial.name}</h3>
                    <span className="text-sm text-white">{tutorial.duration}</span>
                  </div>
                  <p className="text-white text-sm mb-2">{tutorial.description}</p>
                  <p className="text-sm text-blue-400">Coach: {tutorial.coach}</p>
                </div>
                <div className="p-4">
                  <ChevronRight className="h-6 w-6 text-white" />
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
} 