import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ChevronRight, Lock, ChevronLeft, CheckCircle2 } from 'lucide-react';
import { ExerciseVideo } from './ExerciseVideo';
import { ProgramList } from './ProgramList';
import { WorkoutProgram } from './WorkoutProgram';
import type { Category, Program, Exercise, WorkoutProgram as WorkoutProgramType } from '@/types/workouts';
import type { TabState } from '@/types/workouts';

interface WorkoutsProps {
  onNavigateToChat: (newState: Partial<TabState>) => void;
}

const COACH_USER_ID = '195b8756-25ad-4bba-a5d3-553f8049152d';
const WATCHED_VIDEOS_KEY = 'watchedPerformanceVideos';
const WORKOUTS_STATE_KEY_CATEGORY = 'workoutsSelectedCategoryId';
const WORKOUTS_STATE_KEY_PROGRAM = 'workoutsSelectedProgramId';
const WORKOUTS_STATE_KEY_EXERCISE = 'workoutsSelectedExerciseId';

const categories: Category[] = [
  {
    id: 'performance',
    name: 'Maximize Performance',
    image: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?auto=format&fit=crop&q=80&w=1200',
    type: 'education',
    description: 'Master the fundamentals of proper form and technique',
  },
  {
    id: 'basketball',
    name: 'Basketball Programs',
    image: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?auto=format&fit=crop&q=80&w=1200',
    type: 'program',
    description: 'Basketball-specific training programs',
  },
  {
    id: 'soccer',
    name: 'Soccer Programs',
    image: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&q=80&w=1200',
    type: 'program',
    description: 'Soccer-specific training programs',
  },
  {
    id: 'rugby',
    name: 'Rugby Programs',
    image: 'https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&q=80&w=1200',
    type: 'program',
    description: 'Rugby-specific training programs',
  },
];

const programs: Record<string, Program[]> = {
  basketball: [
    {
      id: 'bodyweight',
      name: 'Body Weight',
      description: 'Build foundational strength using just your body weight',
      image: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'inseason',
      name: 'In Season',
      description: 'Maintain peak performance during the competitive season',
      image: 'https://images.unsplash.com/photo-1542652694-40abf526446e?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'offseason',
      name: 'Off Season',
      description: 'Build strength and explosiveness during the off-season',
      image: 'https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'mobility',
      name: 'Extra Mobility',
      description: 'Improve flexibility and prevent injuries',
      image: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&q=80&w=1200',
    },
  ],
  rugby: [
    {
      id: 'bodyweight',
      name: 'Body Weight',
      description: 'Foundation exercises for rugby fitness',
      image: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'inseason',
      name: 'In Season',
      description: 'Maintain strength during the rugby season',
      image: 'https://images.unsplash.com/photo-1574680088814-c9e8a10d8a4d?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'offseason',
      name: 'Off Season',
      description: 'Build power and endurance in the off-season',
      image: 'https://images.unsplash.com/photo-1574680096951-a71cb7be563e?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'mobility',
      name: 'Extra Mobility',
      description: 'Rugby-specific mobility and flexibility',
      image: 'https://images.unsplash.com/photo-1574680178050-55c6a6a96e0a?auto=format&fit=crop&q=80&w=1200',
    },
  ],
  soccer: [
    {
      id: 'bodyweight',
      name: 'Body Weight',
      description: 'Core exercises for soccer players',
      image: 'https://images.unsplash.com/photo-1574680096145-d05b474e2155?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'inseason',
      name: 'In Season',
      description: 'Maintain peak fitness during the season',
      image: 'https://images.unsplash.com/photo-1574680088814-c9e8a10d8a4d?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'offseason',
      name: 'Off Season',
      description: 'Build speed and agility in the off-season',
      image: 'https://images.unsplash.com/photo-1574680096951-a71cb7be563e?auto=format&fit=crop&q=80&w=1200',
    },
    {
      id: 'mobility',
      name: 'Extra Mobility',
      description: 'Soccer-specific flexibility training',
      image: 'https://images.unsplash.com/photo-1574680178050-55c6a6a96e0a?auto=format&fit=crop&q=80&w=1200',
    },
  ],
};

const performanceVideos: Exercise[] = [
  {
    id: '1',
    name: 'Proper Breathing Techniques',
    sets: 3,
    reps: '10 breaths',
    description: 'Master the art of breathing for maximum power and stability during lifts',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  },
  {
    id: '2',
    name: 'Core Bracing Fundamentals',
    sets: 4,
    reps: '30 seconds',
    description: 'Learn how to properly brace your core for heavy lifts',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  },
  {
    id: '3',
    name: 'Recovery Optimization',
    sets: 3,
    reps: '1 minute each',
    description: 'Essential techniques for faster recovery between training sessions',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
  },
  {
    id: '4',
    name: 'Mental Preparation',
    sets: 2,
    reps: '5 minutes',
    description: 'Develop a strong mindset for better performance',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
  },
  {
    id: '5',
    name: 'Injury Prevention',
    sets: 3,
    reps: '12-15',
    description: 'Key strategies to prevent common training injuries',
    videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
  },
];

const sampleWorkoutProgram: WorkoutProgramType = {
  id: 'basketball-bodyweight',
  name: 'Basketball Body Weight',
  description: 'A comprehensive body weight training program designed specifically for basketball players. Build foundational strength and improve your game performance without the need for equipment.',
  image: 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?auto=format&fit=crop&q=80&w=1200',
  currentWeek: 1,
  workouts: [
    {
      id: '1',
      day: 'Monday',
      exercises: [
        {
          id: 'squat',
          name: 'Body Weight Squats',
          sets: 4,
          reps: '15 reps',
          videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
          description: 'Focus on proper form and depth',
        },
        {
          id: 'pushup',
          name: 'Push-Ups',
          sets: 3,
          reps: '12 reps',
          videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
          description: 'Keep core tight throughout the movement',
        },
      ],
    },
    {
      id: '2',
      day: 'Wednesday',
      exercises: [
        {
          id: 'lunges',
          name: 'Walking Lunges',
          sets: 3,
          reps: '10 each leg',
          videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
          description: 'Maintain balance and control',
        },
        {
          id: 'plank',
          name: 'Plank Hold',
          sets: 3,
          reps: '45 seconds',
          videoUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
          description: 'Keep body in straight line',
        },
      ],
    },
  ],
};

export function Workouts({ onNavigateToChat }: WorkoutsProps) {
  const { user } = useAuth();
  const [isLoadingChat, setIsLoadingChat] = useState(false);

  // Initialize state from localStorage or defaults
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(() => {
    if (typeof window !== 'undefined') {
      const savedCategoryId = localStorage.getItem(WORKOUTS_STATE_KEY_CATEGORY);
      if (savedCategoryId) {
        return categories.find(c => c.id === savedCategoryId) || null;
      }
    }
    return null;
  });

  const [selectedProgram, setSelectedProgram] = useState<Program | null>(() => {
    if (typeof window !== 'undefined') {
      const savedProgramId = localStorage.getItem(WORKOUTS_STATE_KEY_PROGRAM);
      const savedCategoryId = localStorage.getItem(WORKOUTS_STATE_KEY_CATEGORY);
      if (savedProgramId && savedCategoryId && programs[savedCategoryId]) {
        return programs[savedCategoryId].find(p => p.id === savedProgramId) || null;
      }
    }
    return null;
  });

  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(() => {
    if (typeof window !== 'undefined') {
      const savedExerciseId = localStorage.getItem(WORKOUTS_STATE_KEY_EXERCISE);
      const savedCategoryId = localStorage.getItem(WORKOUTS_STATE_KEY_CATEGORY);

      if (savedExerciseId) {
        // Check if it's a performance video
        if (savedCategoryId === 'performance') {
          return performanceVideos.find(e => e.id === savedExerciseId) || null;
        }
        // Check if it's an exercise from the sample workout program (assuming current structure)
        // This part would need to be more robust if programs are dynamic or fetched
        if (selectedProgram && selectedProgram.id === sampleWorkoutProgram.id) { // Or more general program lookup
            for (const workout of sampleWorkoutProgram.workouts) {
                const exercise = workout.exercises.find(e => e.id === savedExerciseId);
                if (exercise) return exercise;
            }
        }
      }
    }
    return null;
  });

  const [watchedVideos, setWatchedVideos] = useState<Set<string>>(new Set([]));

  // Load watchedVideos from localStorage (existing logic)
  useEffect(() => {
    if (typeof window !== 'undefined') {
        try {
          const saved = localStorage.getItem(WATCHED_VIDEOS_KEY);
          if (saved) {
            setWatchedVideos(new Set(JSON.parse(saved)));
          }
        } catch (error) {
          console.error('Error loading watched videos from localStorage:', error);
        }
    }
  }, []);

  // Save selectedCategory ID to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
        try {
            if (selectedCategory) {
                localStorage.setItem(WORKOUTS_STATE_KEY_CATEGORY, selectedCategory.id);
            } else {
                localStorage.removeItem(WORKOUTS_STATE_KEY_CATEGORY);
            }
        } catch (error) {
            console.error('Error saving selected category to localStorage:', error);
        }
    }
  }, [selectedCategory]);

  // Save selectedProgram ID to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
        try {
            if (selectedProgram) {
                localStorage.setItem(WORKOUTS_STATE_KEY_PROGRAM, selectedProgram.id);
            } else {
                localStorage.removeItem(WORKOUTS_STATE_KEY_PROGRAM);
            }
        } catch (error) {
            console.error('Error saving selected program to localStorage:', error);
        }
    }
  }, [selectedProgram]);

  // Save selectedExercise ID to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
        try {
            if (selectedExercise) {
                localStorage.setItem(WORKOUTS_STATE_KEY_EXERCISE, selectedExercise.id);
            } else {
                localStorage.removeItem(WORKOUTS_STATE_KEY_EXERCISE);
            }
        } catch (error) {
            console.error('Error saving selected exercise to localStorage:', error);
        }
    }
  }, [selectedExercise]);
  
  // Save watchedVideos to localStorage (existing logic)
  useEffect(() => {
    if (typeof window !== 'undefined') {
        try {
          // Only save if there are actual watched videos to prevent empty string storage
          if (watchedVideos.size > 0) { 
            localStorage.setItem(WATCHED_VIDEOS_KEY, JSON.stringify([...watchedVideos]));
          } else {
            // Optional: If you want to clear it when the set is empty
            localStorage.removeItem(WATCHED_VIDEOS_KEY); 
          }
        } catch (error) {
          console.error('Error saving watched videos to localStorage:', error);
        }
    }
  }, [watchedVideos]);

  const handleVideoComplete = () => {
    if (selectedExercise) {
      setWatchedVideos(prev => new Set([...prev, selectedExercise.id]));
    }
  };

  const isPerformanceComplete = () => {
    return performanceVideos.every(video => watchedVideos.has(video.id));
  };

  const getNextUnwatchedVideo = () => {
    return performanceVideos.find(video => !watchedVideos.has(video.id));
  };

  const handleCategorySelect = (category: Category) => {
    if (category.id !== 'performance' && !isPerformanceComplete()) {
      return;
    }
    if (selectedCategory?.id === category.id) {
      return;
    }
    setSelectedCategory(category);
    setSelectedProgram(null);
    setSelectedExercise(null);
  };

  const handleProgramSelect = (program: Program) => {
    if (selectedProgram?.id === program.id) {
      return;
    }
    setSelectedProgram(program);
    setSelectedExercise(null);
  };

  const handleExerciseSelect = (exercise: Exercise) => {
    if (selectedExercise?.id === exercise.id) {
      return;
    }
    setSelectedExercise(exercise);
  };

  const handleBack = () => {
    if (selectedExercise) {
      setSelectedExercise(null);
    } else if (selectedProgram) {
      setSelectedProgram(null);
    } else if (selectedCategory) {
      setSelectedCategory(null);
      // When going back from a category, also clear saved program and exercise
      if (typeof window !== 'undefined') {
          localStorage.removeItem(WORKOUTS_STATE_KEY_PROGRAM);
          localStorage.removeItem(WORKOUTS_STATE_KEY_EXERCISE);
      }
    }
  };

  const handleCoachChatClick = async () => {
    if (!user) return;
    setIsLoadingChat(true);
    console.log('handleCoachChatClick started');

    try {
      const currentUserId = user.id;
      let targetGroupId: string | null = null;

      const { data: potentialGroups, error: groupsError } = await supabase
        .from('chat_groups')
        .select(`
          id,
          members:chat_group_members(user_id)
        `)
        .filter('chat_group_members.user_id', 'in', `(${currentUserId},${COACH_USER_ID})`);

      if (groupsError) throw groupsError;

      if (potentialGroups) {
          console.log('Potential DM groups found:', potentialGroups);
          for (const group of potentialGroups) {
              if (group.members.length === 2) {
                  const memberIds = group.members.map((m: { user_id: string }) => m.user_id);
                  if (memberIds.includes(currentUserId) && memberIds.includes(COACH_USER_ID)) {
                      targetGroupId = group.id;
                      console.log('Existing DM group found:', targetGroupId);
                      break;
                  }
              }
          }
      }

      if (!targetGroupId) {
        console.log('No existing DM group found, creating new one...');
        const groupName = `DM: You / Coach`;
        const { data: newGroup, error: createGroupError } = await supabase
          .from('chat_groups')
          .insert({ name: groupName, created_by: currentUserId })
          .select()
          .single();

        if (createGroupError) throw createGroupError;
        if (!newGroup) throw new Error('Failed to create new group');

        targetGroupId = newGroup.id;
        console.log('New DM group created:', targetGroupId);

        const { error: addMembersError } = await supabase
          .from('chat_group_members')
          .insert([
            { group_id: targetGroupId, user_id: currentUserId },
            { group_id: targetGroupId, user_id: COACH_USER_ID },
          ]);

        if (addMembersError) {
             console.error('Error adding members to new group:', addMembersError);
        }
      }

      if (targetGroupId) {
        console.log(`Navigating to chat group: ${targetGroupId}`);
        onNavigateToChat({
          activeTab: 'chat',
          chatState: { selectedGroupId: targetGroupId },
        });
      } else {
          console.error('Could not determine target group ID.');
      }

    } catch (error) {
      console.error('Error finding or creating coach chat:', error);
    } finally {
      setIsLoadingChat(false);
    }
  };

  const renderCategories = () => (
    <div>
      <div className="bg-black p-4 border-b border-[#4A7BC7]">
        <div className="flex items-center justify-center">
          <h2 className="text-2xl font-bold text-white text-center">Workout Categories</h2>
        </div>
      </div>
      
      <div className="p-6 space-y-6 bg-black">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-black">
          {categories.map((category) => {
            const isLocked = category.id !== 'performance' && !isPerformanceComplete();
            
            return (
              <button
                key={category.id}
                onClick={() => handleCategorySelect(category)}
                disabled={isLocked}
                className={`relative rounded-lg shadow-lg overflow-hidden transform transition-all duration-300 ${
                  isLocked ? 'opacity-50 cursor-not-allowed' : 'hover:-translate-y-2 hover:shadow-xl'
                }`}
              >
                <div className="aspect-w-16 aspect-h-9">
                  <img
                    src={category.image}
                    alt={category.name}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <h3 className="text-xl font-bold text-white mb-2">{category.name}</h3>
                  {category.description && (
                    <p className="text-white/80 text-sm">{category.description}</p>
                  )}
                  {isLocked && (
                    <div className="flex items-center gap-2 text-white/80 mt-2">
                      <Lock className="h-5 w-5" />
                      <span>Complete Performance to unlock</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderPerformanceVideos = () => (
    <div className="bg-[#5D90DE] shadow rounded-lg border border-[#4A7BC7]">
      {/* Header */}
      <div className="bg-black p-4 border-b border-[#4A7BC7]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={handleBack}
              className="text-white hover:text-gray-300 font-medium flex items-center"
            >
              <ChevronLeft className="h-5 w-5" />
              Back
            </button>
            <h2 className="text-2xl font-bold text-white text-center">
              Maximize Performance
            </h2>
          </div>
          <div className="text-sm text-white">
            {watchedVideos.size} of {performanceVideos.length} completed
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-6 space-y-4 bg-black">
        {performanceVideos.map((video) => {
          const isWatched = watchedVideos.has(video.id);
          const nextUnwatched = getNextUnwatchedVideo();
          const isUnlocked = isWatched || (nextUnwatched && nextUnwatched.id === video.id);

          return (
            <button
              key={video.id}
              onClick={() => isUnlocked && handleExerciseSelect(video)}
              disabled={!isUnlocked}
              className={`w-full bg-[#5D90DE] rounded-lg shadow hover:shadow-md transition-all duration-200 p-6 flex items-center justify-between border border-[#4A7BC7] ${
                !isUnlocked ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <div className="flex items-center flex-1">
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">
                    {video.name}
                  </h3>
                  <p className="text-white">{video.description}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 ml-4">
                {isWatched ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500" />
                ) : !isUnlocked ? (
                  <Lock className="h-6 w-6 text-gray-400" />
                ) : (
                  <ChevronRight className="h-6 w-6 text-gray-400" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Function to get the next video in the performance sequence
  const getNextPerformanceVideo = (currentId: string) => {
    const currentIndex = performanceVideos.findIndex(video => video.id === currentId);
    if (currentIndex < performanceVideos.length - 1) {
      return performanceVideos[currentIndex + 1];
    }
    return null;
  };

  // Function to check if the current video is the final performance video
  const isFinalPerformanceVideo = (currentId: string) => {
    return currentId === performanceVideos[performanceVideos.length - 1].id;
  };

  // Function to handle navigation to the next video
  const handleNextVideo = () => {
    if (selectedExercise) {
      const nextVideo = getNextPerformanceVideo(selectedExercise.id);
      if (nextVideo) {
        setSelectedExercise(nextVideo);
      }
    }
  };

  // Function to handle navigation back to workout categories
  const handleProceedToWorkouts = () => {
    setSelectedExercise(null);
    setSelectedProgram(null);
    setSelectedCategory(null);
  };

  // Render components based on current state
  if (selectedExercise) {
    const isPerformanceExercise = performanceVideos.some(pv => pv.id === selectedExercise.id);
    const nextVideo = isPerformanceExercise ? getNextPerformanceVideo(selectedExercise.id) : null;
    const hasNextVideo = !!nextVideo;
    const isFinalVideo = isPerformanceExercise && isFinalPerformanceVideo(selectedExercise.id);
    
    return (
      <ExerciseVideo
        exercise={selectedExercise}
        onBack={handleBack}
        onChatClick={handleCoachChatClick}
        onComplete={handleVideoComplete}
        showButtons={!isPerformanceExercise} 
        isPerformanceVideo={isPerformanceExercise}
        hasNextVideo={hasNextVideo}
        onNextVideo={handleNextVideo}
        isFinalVideo={isFinalVideo}
        onProceedToWorkouts={handleProceedToWorkouts}
      />
    );
  }

  if (selectedProgram) {
    // For now, we assume selectedProgram implies sampleWorkoutProgram for simplicity
    // A more robust solution would fetch or find the program by selectedProgram.id
    const programToDisplay = (selectedProgram.id === sampleWorkoutProgram.id) ? sampleWorkoutProgram : sampleWorkoutProgram; // Placeholder for actual lookup
    return (
      <WorkoutProgram
        program={programToDisplay} 
        onBack={handleBack}
        onExerciseSelect={handleExerciseSelect}
      />
    );
  }

  if (selectedCategory) {
    if (selectedCategory.id === 'performance') {
      return renderPerformanceVideos();
    }
    const categoryPrograms = programs[selectedCategory.id] || [];
    return (
      <ProgramList
        categoryName={selectedCategory.name}
        programs={categoryPrograms}
        onBack={handleBack}
        onProgramSelect={handleProgramSelect}
      />
    );
  }

  return renderCategories();
} 