'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NavBar from '@/components/NavBar';
import { Workouts } from '@/components/Workouts';
import type { TabState } from '@/types/workouts';

export default function TrainingPage() {
  const router = useRouter();
  const [tabState, setTabState] = useState<TabState>({
    activeTab: 'training'
  });

  const handleNavigateToChat = (newState: Partial<TabState>) => {
    setTabState(prev => ({ ...prev, ...newState }));
    
    if (newState.activeTab === 'chat' && newState.chatState?.selectedGroupId) {
      router.push(`/chat?group=${newState.chatState.selectedGroupId}`);
    }
  };

  return (
    <main className="min-h-screen pb-20 bg-black">
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-2xl font-bold mb-6 text-white">Training</h1>
        <Workouts onNavigateToChat={handleNavigateToChat} />
      </div>
      <NavBar />
    </main>
  );
} 