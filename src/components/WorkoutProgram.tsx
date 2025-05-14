import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WorkoutProgram as WorkoutProgramType, Exercise } from '@/types/workouts';

interface WorkoutProgramProps {
  program: WorkoutProgramType;
  onBack: () => void;
  onExerciseSelect: (exercise: Exercise) => void;
}

export function WorkoutProgram({ program, onBack, onExerciseSelect }: WorkoutProgramProps) {
  return (
    <div className="bg-[#5D90DE] shadow rounded-lg border border-[#4A7BC7]">
      {/* Header */}
      <div className="bg-black p-4 border-b border-[#4A7BC7]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={onBack}
              className="text-white hover:text-gray-300 font-medium flex items-center"
            >
              <ChevronLeft className="h-5 w-5" />
              Back
            </button>
            <h2 className="text-2xl font-bold text-white text-center">{program.name}</h2>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-6 space-y-6 bg-black">
        {/* Program Overview */}
        <div className="relative h-48 rounded-lg overflow-hidden">
          <img
            src={program.image}
            alt={program.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        </div>

        {/* Program Description */}
        <div className="bg-[#5D90DE] rounded-lg p-6 shadow border border-[#4A7BC7]">
          <p className="text-white">{program.description}</p>
        </div>

        {/* Program Stats */}
        <div className="bg-[#5D90DE] rounded-lg shadow border border-[#4A7BC7]">
          <div className="p-4 flex justify-between items-center">
            <span className="text-white font-semibold">Sets Exercises</span>
            <span className="text-white font-semibold">Week {program.currentWeek}</span>
          </div>
          <div className="h-px bg-[#4A7BC7]" />
        </div>

        {/* Workouts */}
        <div className="space-y-4">
          {program.workouts.map((workout) => (
            <div key={workout.id} className="bg-[#5D90DE] rounded-lg shadow border border-[#4A7BC7]">
              <div className="p-4 border-b border-[#4A7BC7]">
                <h3 className="text-lg font-semibold text-white">
                  Workout {workout.id}: {workout.day}
                </h3>
              </div>
              <div className="divide-y divide-[#4A7BC7]">
                {workout.exercises.map((exercise) => (
                  <button
                    key={exercise.id}
                    onClick={() => onExerciseSelect(exercise)}
                    className="w-full p-4 hover:bg-[#4A7BC7] flex items-center text-white transition-colors"
                  >
                    {/* Sets Bubble */}
                    <div className="w-12 h-12 rounded-full bg-[#4A7BC7] flex items-center justify-center flex-shrink-0 border border-white">
                      <span className="text-white font-semibold">{exercise.sets}x</span>
                    </div>
                    
                    {/* Exercise Details */}
                    <div className="ml-4 flex-1 text-left">
                      <h4 className="font-semibold text-white">{exercise.name}</h4>
                      <p className="text-sm text-white">{exercise.reps}</p>
                    </div>
                    
                    {/* Arrow */}
                    <ChevronRight className="h-5 w-5 text-white" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 