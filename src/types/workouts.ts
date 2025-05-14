export interface Category {
  id: string;
  name: string;
  image: string;
  type: 'program' | 'education';
  description: string;
}

export interface Program {
  id: string;
  name: string;
  description: string;
  image: string;
}

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  description?: string;
  videoUrl: string;
}

export interface Workout {
  id: string;
  day: string;
  exercises: Exercise[];
}

export interface WorkoutProgram {
  id: string;
  name: string;
  description: string;
  image: string;
  currentWeek: number;
  workouts: Workout[];
}

export interface TabState {
  activeTab: string;
  chatState?: {
    selectedGroupId: string;
  };
} 