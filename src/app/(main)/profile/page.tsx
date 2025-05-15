'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import NavBar from '@/components/NavBar';
import ChatIconWithBadge from '@/components/ChatIconWithBadge';
import { useToasts } from '@/contexts/ToastContext';
import ProfilePageSkeleton from '@/components/Skeletons/ProfilePageSkeleton';

type Profile = {
  username: string;
  avatar_url: string | null;
  bio: string | null;
};

export default function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const { showToast } = useToasts();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);
  
  const [editForm, setEditForm] = useState({
    username: '',
    bio: '',
  });

  const memoizedSupabase = useMemo(() => supabase, []);
  const memoizedShowToast = useMemo(() => showToast, [showToast]);

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    console.log('[PROFILE_PAGE] fetchProfile called for user:', user.id);
    try {
      const { data, error } = await memoizedSupabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) {
        console.error('[PROFILE_PAGE] Error fetching profile data:', error);
        memoizedShowToast('Error loading profile.', 'error');
        setProfile(null);
        throw error;
      }
      
      if (data) {
        console.log('[PROFILE_PAGE] Profile data fetched:', data);
        console.log('[PROFILE_PAGE] Fetched avatar_url:', data.avatar_url);
        setProfile(data);
      } else {
        console.warn('[PROFILE_PAGE] No profile data returned for user:', user.id);
        memoizedShowToast('Profile not found.', 'warning');
        setProfile(null);
      }
    } catch (error) {
      // Error already logged, toast shown
    }
  }, [user, memoizedSupabase, memoizedShowToast]);

  useEffect(() => {
    if (user) {
      setLoading(true);
      fetchProfile().finally(() => setLoading(false));
    } else if (!loading && !user) {
      router.push('/login');
    }
  }, [user?.id, fetchProfile]);

  useEffect(() => {
    if (profile) {
      setEditForm({
        username: profile.username || '',
        bio: profile.bio || '',
      });
    } else {
      setEditForm({ username: '', bio: '' });
    }
  }, [profile]);

  const handleAvatarClick = () => {
    if (isEditing && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!allowedTypes.includes(file.type)) {
      showToast('Please select a valid image file (JPEG, PNG, or GIF)', 'error');
      return;
    }

    if (file.size > maxSize) {
      showToast('File is too large. Maximum size is 5MB', 'error');
      return;
    }

    // Create a preview
    const reader = new FileReader();
    reader.onload = (event) => {
      setAvatarPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const uploadAvatar = async (file: File): Promise<string | null> => {
    if (!user) return null;

    try {
      setUploadingAvatar(true);
      
      // Create a FormData object to send the file
      const formData = new FormData();
      formData.append('file', file);
      
      // Send the file to our API route
      const response = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Error uploading avatar:', errorData);
        throw new Error(errorData.error || errorData.details || 'Failed to upload avatar');
      }
      
      const data = await response.json();
      return data.avatar_url;
    } catch (error: any) {
      console.error('Error uploading avatar:', error.message);
      showToast(`Error uploading avatar: ${error.message}`, 'error');
      return null;
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setUploadingAvatar(true); // Set loading true at the start of save
    
    try {
      let newAvatarUploaded = false;
      let avatarUrlToUpdate = profile?.avatar_url; // Start with current or null

      // If a new file was selected and previewed, upload it via API
      if (avatarPreview && fileInputRef.current?.files?.[0]) {
        const file = fileInputRef.current.files[0];
        const newApiAvatarUrl = await uploadAvatar(file); // uploadAvatar now calls our API
        
        if (newApiAvatarUrl) {
          newAvatarUploaded = true;
          avatarUrlToUpdate = newApiAvatarUrl;
        } else {
          setUploadingAvatar(false);
          return; // Stop if avatar upload failed
        }
      }
      
      const updates: { username?: string; bio?: string; avatar_url?: string | null} = {}; // Allow avatar_url to be null
      if (editForm.username !== profile?.username) {
        updates.username = editForm.username;
      }
      if (editForm.bio !== profile?.bio) {
        updates.bio = editForm.bio;
      }
      
      // The API route /api/upload-avatar has already updated the avatar_url in the database if a new avatar was uploaded.
      // If only username/bio changed, or if the user is clearing an avatar (not implemented here), this logic would handle it.
      // For now, this 'updates' object will primarily send username/bio changes.
      // If avatarUrlToUpdate has changed AND it wasn't due to a new upload (avatarPreview is false),
      // it implies an edge case not currently handled, like programmatically setting avatar_url to null.
      // The current flow is: new upload -> API updates URL -> fetchProfile gets it.
      // So, we don't explicitly set updates.avatar_url here from avatarUrlToUpdate if avatarPreview was true,
      // as that would be redundant with what the API route did.
      if (avatarUrlToUpdate !== profile?.avatar_url && !avatarPreview) { 
        updates.avatar_url = avatarUrlToUpdate; // This handles clearing or an external change if any
      }

      if (Object.keys(updates).length > 0 || newAvatarUploaded) { // Update if text changed OR new avatar was uploaded
        if (Object.keys(updates).length > 0) { // Only run DB update if text fields changed
            const { error } = await memoizedSupabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id);
            if (error) throw error;
        }
      }
      
      showToast('Profile updated successfully!', 'success');
      await fetchProfile(); 
      if (newAvatarUploaded) {
        setAvatarVersion(prev => prev + 1); 
      }
      setIsEditing(false);
      setAvatarPreview(null); 
    } catch (error: any) {
      console.error('Error updating profile (handleSave):', error);
      if (!avatarPreview || !(error.message.includes('avatar'))) { 
        showToast(`Error updating profile: ${error.message}`, 'error');
      }
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return <ProfilePageSkeleton />;
  }

  return (
    <main className="min-h-screen pb-20">
      <div className="max-w-md mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Profile</h1>
          <ChatIconWithBadge />
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex justify-center">
            <div className="relative" onClick={handleAvatarClick}>
              <div className={`w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden ${isEditing ? 'cursor-pointer' : ''}`}>
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="Profile Preview"
                    className="w-24 h-24 rounded-full object-cover"
                  />
                ) : profile?.avatar_url ? (
                  <img
                    src={`${profile.avatar_url}?v=${avatarVersion}&t=${new Date().getTime()}`}
                    alt="Profile"
                    className="w-24 h-24 rounded-full object-cover"
                    key={`${profile.avatar_url}-${avatarVersion}`}
                  />
                ) : (
                  <svg
                    className="w-12 h-12 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                )}
              </div>
              {isEditing && (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/jpeg,image/png,image/gif"
                    className="hidden"
                  />
                  <div className="absolute bottom-0 right-0 bg-blue-500 text-white rounded-full p-1 shadow-md">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                </>
              )}
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Username</label>
                <input
                  type="text"
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Bio</label>
                <textarea
                  value={editForm.bio}
                  onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                  rows={3}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="flex space-x-4">
                <button
                  onClick={handleSave}
                  disabled={uploadingAvatar}
                  className={`flex-1 ${uploadingAvatar ? 'bg-blue-300' : 'bg-blue-500 hover:bg-blue-600'} text-white px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center`}
                >
                  {uploadingAvatar ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Saving...
                    </>
                  ) : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setAvatarPreview(null);
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-center">{profile?.username}</h2>
                <p className="text-gray-600 text-center mt-2">{profile?.bio}</p>
              </div>
              <div className="flex space-x-4">
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex-1 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Edit Profile
                </button>
                <button
                  onClick={handleLogout}
                  className="flex-1 bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <NavBar />
    </main>
  );
} 