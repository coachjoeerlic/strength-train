import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Program } from '@/types/workouts';

interface ProgramListProps {
  categoryName: string;
  programs: Program[];
  onBack: () => void;
  onProgramSelect: (program: Program) => void;
}

export function ProgramList({ categoryName, programs, onBack, onProgramSelect }: ProgramListProps) {
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
            <h2 className="text-2xl font-bold text-white text-center">{categoryName}</h2>
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-6 bg-black">
        <div className="grid grid-cols-1 gap-6">
          {programs.map((program) => (
            <button
              key={program.id}
              onClick={() => onProgramSelect(program)}
              className="w-full bg-[#5D90DE] rounded-lg shadow hover:shadow-md transition-all duration-200 overflow-hidden border border-[#4A7BC7]"
            >
              <div className="relative h-48">
                <img
                  src={program.image}
                  alt={program.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <h3 className="text-xl font-bold text-white">{program.name}</h3>
                </div>
              </div>
              <div className="p-6">
                <p className="text-white">{program.description}</p>
                <div className="mt-4 flex justify-end">
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