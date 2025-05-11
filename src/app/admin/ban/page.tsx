'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToasts } from '@/contexts/ToastContext';
import { ArrowLeft, UserX, UserCheck, ShieldAlert, Users, AlertTriangle as AlertTriangleIcon, RefreshCw, Ban } from 'lucide-react';
import Link from 'next/link';

// Type for profile data, including is_banned
interface UserProfileAdminView {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_banned: boolean;
  // Add other fields if needed for display
}

export default function UserBanManagementPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { showToast } = useToasts();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [bannedUsers, setBannedUsers] = useState<UserProfileAdminView[]>([]);
  const [isFetchingBannedUsers, setIsFetchingBannedUsers] = useState(false);
  const [bannedUsersError, setBannedUsersError] = useState<string | null>(null);
  const [usernameToBan, setUsernameToBan] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchBannedUsers = useCallback(async () => {
    if (!isAdmin) return; // Ensure admin status is confirmed
    setIsFetchingBannedUsers(true);
    setBannedUsersError(null);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, avatar_url, is_banned')
        .eq('is_banned', true)
        .order('username', { ascending: true });

      if (error) throw error;
      setBannedUsers(data || []);
    } catch (err: any) {
      console.error('Error fetching banned users:', err);
      setBannedUsersError('Failed to load banned users.');
      showToast('Failed to load banned users: ' + err.message, 'error');
    } finally {
      setIsFetchingBannedUsers(false);
    }
  }, [isAdmin, showToast, supabase]); // Added supabase to dependencies

  const handleUnbanUser = async (userIdToUnban: string) => {
    if (!isAdmin || !user) {
      showToast('Action not allowed.', 'error');
      return;
    }
    setActionInProgress(userIdToUnban);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_banned: false })
        .eq('id', userIdToUnban);

      if (error) throw error;

      showToast('User unbanned successfully.', 'success');
      // Optimistically remove from the list
      setBannedUsers(prevUsers => prevUsers.filter(u => u.id !== userIdToUnban));
      // Optionally, call fetchBannedUsers() again if strict consistency over optimism is needed

    } catch (err: any) {
      console.error(`Error unbanning user ${userIdToUnban}:`, err);
      showToast(err.message || 'Failed to unban user.', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleBanUserByUsername = async () => {
    if (!isAdmin || !user || !usernameToBan.trim()) {
      showToast('Please enter a username to ban.', 'info');
      return;
    }
    const usernameToBanTrimmed = usernameToBan.trim();
    setActionInProgress(`ban-${usernameToBanTrimmed}`);

    try {
      // Step 1: Find user by username
      const { data: targetUser, error: findError } = await supabase
        .from('profiles')
        .select('id, is_banned, username')
        .eq('username', usernameToBanTrimmed)
        .single();

      if (findError || !targetUser) {
        showToast(`User "${usernameToBanTrimmed}" not found.`, 'error');
        console.error('Error finding user or user not found:', findError);
        setActionInProgress(null);
        return;
      }

      if (targetUser.is_banned) {
        showToast(`User "${targetUser.username}" is already banned.`, 'info');
        setActionInProgress(null);
        setUsernameToBan('');
        return;
      }

      console.log(`[ADMIN_BAN] Attempting to ban user ID: ${targetUser.id}, username: ${targetUser.username}`);

      // Step 2: Ban the user
      const { error: banError } = await supabase
        .from('profiles')
        .update({ is_banned: true })
        .eq('id', targetUser.id);

      console.log('[ADMIN_BAN] Supabase ban update error object:', banError);

      if (banError) {
        console.error('[ADMIN_BAN] Detailed ban error:', JSON.stringify(banError, null, 2));
        throw banError;
      }

      showToast(`User "${targetUser.username}" has been banned successfully.`, 'success');
      setUsernameToBan('');
      fetchBannedUsers(); 
      
      if (supabase && targetUser && targetUser.id) {
        const userSpecificChannelName = `user-status:${targetUser.id}`;
        const userChannel = supabase.channel(userSpecificChannelName);
        
        console.log(`[ADMIN_BAN] Sending 'account_banned' event to channel: ${userSpecificChannelName}`);
        userChannel.send({
          type: 'broadcast',
          event: 'account_banned',
          payload: { 
            message: 'Your account has been suspended by an administrator.',
            bannedUserId: targetUser.id
          }
        })
        .then((response) => { 
            console.log('[ADMIN_BAN] \'account_banned\' event send acknowledged by server:', response);
            // supabase.removeChannel(userChannel); // Optional: remove channel after sending
        })
        .catch((err) => { 
            console.error("[ADMIN_BAN] Error sending \'account_banned\' event:", err);
        });
      }

    } catch (err: any) {
      console.error(`Error banning user ${usernameToBanTrimmed}:`, err);
      showToast(err.message || `Failed to ban user "${usernameToBanTrimmed}".`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  useEffect(() => {
    const checkAdminStatusAndFetchData = async () => {
      if (authLoading) return;
      if (!user) {
        router.push('/login');
        return;
      }
      setIsLoadingPage(true); // Covers initial admin check and first fetch if admin
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        if (profile && profile.is_admin) {
          setIsAdmin(true);
          await fetchBannedUsers(); // Fetch immediately if admin
        } else {
          setIsAdmin(false);
          setPageError('Access Denied: You do not have permission to view this page.');
        }
      } catch (err: any) {
        console.error('Error during initial page setup:', err);
        setPageError('An error occurred: ' + (err.message || ''));
        setIsAdmin(false);
      } finally {
        setIsLoadingPage(false);
      }
    };
    checkAdminStatusAndFetchData();
  }, [user, authLoading, router, supabase, fetchBannedUsers]); // Added supabase and fetchBannedUsers

  // Combined loading for initial page view
  if (isLoadingPage || authLoading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <p className="ml-3 text-gray-600 dark:text-gray-300">Loading User Management...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <ShieldAlert className="h-16 w-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold text-red-600 mb-2">Access Denied</h1>
        <p className="text-gray-700 dark:text-gray-300">{pageError || 'You do not have permission to view this page.'}</p>
        <button onClick={() => router.push('/')} className="mt-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md transition-colors">
          Go to Homepage
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 md:p-6">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
                <button 
                    onClick={() => router.push('/admin/flags')} 
                    className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    aria-label="Back to Flagged Messages Portal"
                >
                    <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-200" />
                </button>
                <h1 className="text-2xl font-bold text-gray-800 dark:text-white">User Ban Management</h1>
            </div>
             <button 
                onClick={fetchBannedUsers} 
                disabled={isFetchingBannedUsers}
                className="text-sm bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1.5 px-3 rounded-md disabled:opacity-50 flex items-center"
              >
                {isFetchingBannedUsers ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                ) : (
                    <UserCheck className="h-4 w-4 mr-1.5" /> /* Or another icon like RefreshCw */
                )}
                Refresh List
            </button>
        </header>

        <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-white mb-3">Ban User by Username</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 italic mb-3">Enter the exact username of the user you wish to ban.</p>
             <div className="flex items-center space-x-2">
                <input 
                    type="text"
                    value={usernameToBan}
                    onChange={(e) => setUsernameToBan(e.target.value)}
                    placeholder="Enter username..."
                    className="flex-grow p-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white disabled:opacity-50"
                    disabled={actionInProgress !== null} // Disable if any action is in progress
                />
                <button 
                    onClick={handleBanUserByUsername}
                    disabled={!usernameToBan.trim() || actionInProgress !== null}
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-md shadow-sm disabled:opacity-60 flex items-center"
                >
                    {actionInProgress === `ban-${usernameToBan.trim()}` ? (
                        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                        <Ban className="h-4 w-4 mr-2" />
                    )}
                    {actionInProgress === `ban-${usernameToBan.trim()}` ? 'Banning...' : 'Ban User'}
                </button>
            </div>
        </div>

        <div className="bg-white dark:bg-gray-800 shadow-xl rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-white mb-4">Currently Banned Users</h2>
          {isFetchingBannedUsers && bannedUsers.length === 0 && (
            <p className="text-center text-gray-400 dark:text-gray-500 py-8">Loading banned users...</p>
          )}
          {!isFetchingBannedUsers && bannedUsersError && (
             <div className="text-center py-10 px-4 bg-red-50 dark:bg-red-900/20 p-4 rounded-md">
              <AlertTriangleIcon className="h-10 w-10 text-red-400 mx-auto mb-3" />
              <p className="text-red-600 dark:text-red-300">{bannedUsersError}</p>
              <button onClick={fetchBannedUsers} className="mt-3 text-sm text-blue-500 hover:underline">Try again</button>
            </div>
          )}
          {!isFetchingBannedUsers && !bannedUsersError && bannedUsers.length === 0 && (
            <div className="text-center py-10 px-4">
               <Users className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No users are currently banned.</p>
            </div>
          )}
          {!isFetchingBannedUsers && !bannedUsersError && bannedUsers.length > 0 && (
            <ul className="space-y-3">
              {bannedUsers.map((bUser) => (
                <li key={bUser.id} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md shadow-sm flex items-center justify-between border border-gray-200 dark:border-gray-600">
                  <div className="flex items-center">
                    {bUser.avatar_url ? (
                        <img src={bUser.avatar_url} alt={bUser.username || 'avatar'} className="h-8 w-8 rounded-full mr-3" />
                    ) : (
                        <div className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600 mr-3 flex items-center justify-center">
                            <UserX className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                        </div>
                    )}
                    <span className="font-medium text-gray-800 dark:text-gray-100">{bUser.username || 'Unknown User'}</span>
                  </div>
                  <button 
                    onClick={() => handleUnbanUser(bUser.id)}
                    disabled={actionInProgress === bUser.id}
                    className="text-xs bg-green-500 hover:bg-green-600 text-white font-semibold py-1.5 px-3 rounded-md shadow-sm disabled:opacity-60 flex items-center"
                  >
                    {actionInProgress === bUser.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                        <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {actionInProgress === bUser.id ? 'Unbanning...' : 'Unban'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
} 