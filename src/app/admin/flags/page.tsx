'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { useToasts } from '@/contexts/ToastContext';
import { format } from 'date-fns';
import { MessageCircle, AlertTriangle, ArrowLeft, Users, UserCheck as RefreshIcon } from 'lucide-react';
import Link from 'next/link';
// import NavBar from '@/components/NavBar'; // Decide if NavBar is needed here or if admin has its own layout

// Define a type for the reported item
interface ReportedItem {
  report_id: string;
  message_id: string;
  message_content: string | null;
  message_media_url?: string | null;
  message_media_type?: string | null;
  message_author_id?: string; // Added to link to profilesMap
  chat_id: string;
  reported_by_username: string | null;
  message_author_username: string | null;
  reason: string | null;
  status: string;
  reported_at: string;
  // raw_message_user_id: string; // To distinguish from reported_by_user_id if needed later
}

// Simplified type for messages fetched separately
interface FetchedMessage {
    id: string;
    content: string | null;
    media_url?: string | null;
    media_type?: string | null;
    user_id: string;
}

export default function FlaggedMessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { showToast } = useToasts();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [reportedItems, setReportedItems] = useState<ReportedItem[]>([]);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isFetchingReports, setIsFetchingReports] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [reportsError, setReportsError] = useState<string | null>(null);

  const fetchReportedMessages = useCallback(async () => {
    if (!isAdmin) return;
    setIsFetchingReports(true);
    setReportsError(null);
    setReportedItems([]); // Clear previous items

    try {
      // Step 1: Fetch core report data
      const { data: reportsData, error: reportsFetchError } = await supabase
        .from('reports')
        .select('id, message_id, chat_id, reason, status, created_at, reported_by_user_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (reportsFetchError) throw reportsFetchError;
      if (!reportsData || reportsData.length === 0) {
        setIsFetchingReports(false);
        return;
      }

      // Step 2: Collect message_ids and reported_by_user_ids
      const messageIds = reportsData.map(r => r.message_id).filter(id => id != null) as string[];
      const reporterUserIds = new Set<string>();
      reportsData.forEach(r => {
        if (r.reported_by_user_id) reporterUserIds.add(r.reported_by_user_id);
      });

      // Step 3: Fetch message details
      let messagesMap = new Map<string, FetchedMessage>();
      if (messageIds.length > 0) {
        const { data: messagesDetails, error: messagesError } = await supabase
          .from('messages')
          .select('id, content, media_url, media_type, user_id')
          .in('id', messageIds);
        if (messagesError) throw messagesError;
        messagesDetails?.forEach(m => messagesMap.set(m.id, m as FetchedMessage));
      }
      
      // Step 4: Collect all unique user IDs for profile fetching (reporters + message authors)
      messagesMap.forEach(msg => {
        if (msg.user_id) reporterUserIds.add(msg.user_id); // Add message authors to the set
      });

      let profilesMap = new Map<string, { username: string | null }>();
      if (reporterUserIds.size > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(reporterUserIds));
        if (profilesError) console.error('Error fetching profiles for reports:', profilesError);
        else profilesData?.forEach(p => profilesMap.set(p.id, { username: p.username }));
      }

      // Step 5: Format items
      const formattedItems: ReportedItem[] = reportsData.map(report => {
        const messageDetail = messagesMap.get(report.message_id);
        return {
          report_id: report.id,
          message_id: report.message_id,
          message_content: messageDetail?.content || null,
          message_media_url: messageDetail?.media_url,
          message_media_type: messageDetail?.media_type,
          message_author_id: messageDetail?.user_id,
          chat_id: report.chat_id,
          reported_by_username: profilesMap.get(report.reported_by_user_id)?.username || 'Unknown User',
          message_author_username: messageDetail ? (profilesMap.get(messageDetail.user_id)?.username || 'Unknown Author') : 'Message data missing',
          reason: report.reason,
          status: report.status,
          reported_at: report.created_at,
        };
      });
      setReportedItems(formattedItems);

    } catch (err: any) {
      console.error('Error fetching reported messages:', err);
      setReportsError('Failed to load reported messages. ' + err.message);
      showToast('Failed to load reported messages.', 'error');
    } finally {
      setIsFetchingReports(false);
    }
  }, [isAdmin, showToast, supabase]); // Ensure supabase is in deps if used directly

  const handleHideMessage = async (reportId: string, messageId: string) => {
    if (!user || !isAdmin) {
      showToast('Action not allowed.', 'error');
      return;
    }
    console.log(`[ADMIN_ACTION] Hiding message ${messageId} for report ${reportId}`);
    // Consider adding a loading state for individual item actions if many reports

    try {
      // Step 1: Hide the message
      const { error: hideError } = await supabase
        .from('messages')
        .update({ is_hidden: true })
        .eq('id', messageId);

      if (hideError) throw hideError;

      // Step 2: Update the report status
      const { error: reportUpdateError } = await supabase
        .from('reports')
        .update({
          status: 'reviewed_hidden',
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: user.id,
        })
        .eq('id', reportId);

      if (reportUpdateError) throw reportUpdateError;

      showToast('Message hidden and report updated.', 'success');
      
      // Send a custom realtime event to notify clients
      if (supabase) { // Ensure supabase client is available
        const channel = supabase.channel('admin-actions'); // Global channel for admin actions
        // Note: For broadcasting, Supabase recommends sending from a trusted server/edge function if possible,
        // but for client-to-client for this specific internal admin action, it can work.
        // Ensure RLS on the channel itself is considered if it needs to be private.
        // For now, this is a simple broadcast.
        channel.send({
          type: 'broadcast',
          event: 'message_hidden',
          payload: { 
            messageId: messageId,
            chatId: reportedItems.find(item => item.report_id === reportId)?.chat_id // Get chatId from local state
          }
        }).catch(err => console.error("Error sending message_hidden event:", err));
        // We don't necessarily need to await the send or subscribe to this channel here on the admin page itself.
      }

      setReportedItems(prevItems => prevItems.filter(item => item.report_id !== reportId));
    } catch (err: any) {
      console.error('Error processing hide message action:', err);
      showToast(err.message || 'Failed to hide message or update report.', 'error');
    }
  };

  const handleDismissReportAsKept = async (reportId: string) => {
    if (!user || !isAdmin) {
      showToast('Action not allowed.', 'error');
      return;
    }
    console.log(`[ADMIN_ACTION] Dismissing report ${reportId} as message kept.`);

    try {
      const { error } = await supabase
        .from('reports')
        .update({
          status: 'reviewed_kept',
          reviewed_at: new Date().toISOString(),
          reviewed_by_user_id: user.id,
        })
        .eq('id', reportId);

      if (error) throw error;

      showToast('Report dismissed, message will remain visible.', 'success');
      setReportedItems(prevItems => prevItems.filter(item => item.report_id !== reportId));

    } catch (err: any) {
      console.error('Error dismissing report:', err);
      showToast(err.message || 'Failed to dismiss report.', 'error');
    }
  };

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (authLoading) return;
      if (!user) {
        router.push('/login');
        return;
      }
      setIsLoadingPage(true);
      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single();

        if (profileError) throw profileError;

        if (profile && profile.is_admin) {
          setIsAdmin(true);
          await fetchReportedMessages();
        } else {
          setIsAdmin(false);
          setPageError('Access Denied: You do not have permission to view this page.');
        }
      } catch (err: any) {
        console.error('Error checking admin status:', err);
        setPageError('An error occurred. ' + (err.message || ''));
        setIsAdmin(false);
      } finally {
        setIsLoadingPage(false);
      }
    };
    checkAdminStatus();
  }, [user, authLoading, router, fetchReportedMessages, supabase]);

  if (isLoadingPage || authLoading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <p className="ml-3 text-gray-600 dark:text-gray-300">Loading Admin Portal...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
        <p className="text-gray-700">{pageError || 'You do not have permission to view this page.'}</p>
        <button onClick={() => router.push('/')} className="mt-6 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded">
          Go to Homepage
        </button>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      {/* <NavBar /> */}
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-xl rounded-lg">
        <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <div className="flex items-center min-w-0">
            <button 
              onClick={() => router.push('/chats')} 
              className="mr-3 p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
              aria-label="Back to chats"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-300" />
            </button>
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white truncate">Flagged Messages Portal</h1>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Link href="/admin/ban" className="text-sm bg-purple-500 hover:bg-purple-600 text-white font-semibold py-1.5 px-3 rounded-md flex items-center" title="Manage User Bans">
              <Users className="h-4 w-4 mr-1.5 flex-shrink-0" />
              <span className="hidden sm:inline">Manage Bans</span>
            </Link>
            <button 
              onClick={fetchReportedMessages} 
              disabled={isFetchingReports}
              className="text-sm bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1.5 px-3 rounded-md disabled:opacity-50 flex items-center"
            >
              {isFetchingReports ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1.5"></div>
              ) : (
                  <RefreshIcon className="h-4 w-4 mr-1.5" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </header>
        
        <div className="p-6">
          {isFetchingReports && reportedItems.length === 0 && (
            <p className="text-center text-gray-400 dark:text-gray-500 py-8">Loading reported messages...</p>
          )}
          {!isFetchingReports && reportsError && (
             <div className="text-center py-10 px-4 bg-red-50 dark:bg-red-900/20 p-4 rounded-md">
              <AlertTriangle className="h-10 w-10 text-red-400 mx-auto mb-3" />
              <p className="text-red-600 dark:text-red-300">{reportsError}</p>
              <button onClick={fetchReportedMessages} className="mt-3 text-sm text-blue-500 hover:underline">Try again</button>
            </div>
          )}
          {!isFetchingReports && !reportsError && reportedItems.length === 0 && (
            <div className="text-center py-10 px-4">
               <MessageCircle className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-gray-400">No pending flagged messages found.</p>
            </div>
          )}

          {!isFetchingReports && !reportsError && reportedItems.length > 0 && (
            <div className="space-y-4">
              {reportedItems.map((item) => (
                <div key={item.report_id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-700/30 shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Report ID: <span className="font-mono text-gray-700 dark:text-gray-200">{item.report_id.substring(0,8)}</span> | 
                        Status: <span className={`font-semibold ${item.status === 'pending' ? 'text-yellow-500' : 'text-gray-500'}`}>{item.status}</span>
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Reported: {format(new Date(item.reported_at), 'MMM d, yyyy, h:mm a')}
                      </p>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                       Chat ID: <span className="font-mono text-gray-700 dark:text-gray-200">{item.chat_id.substring(0,8)}</span>
                    </div>
                  </div>
                  
                  <div className="p-3 bg-white dark:bg-gray-700/50 rounded border border-gray-300 dark:border-gray-600 my-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Original message by: <span className="font-medium text-gray-700 dark:text-gray-200">{item.message_author_username}</span>
                    </p>
                    {item.message_content && <p className="mt-1 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{item.message_content}</p>}
                    {item.message_media_url && (
                        <p className="mt-1 text-sm italic text-gray-600 dark:text-gray-300">Media: [{item.message_media_type}] <a href={item.message_media_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">View Media</a></p>
                    )}
                  </div>

                  {item.reason && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-1">
                      Reason: <span className="italic text-gray-600 dark:text-gray-300">"{item.reason}"</span>
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Reported by: <span className="font-medium text-gray-700 dark:text-gray-200">{item.reported_by_username}</span>
                  </p>

                  <div className="flex space-x-3">
                    <button 
                      onClick={() => handleHideMessage(item.report_id, item.message_id)}
                      className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-md hover:bg-red-700 shadow-sm"
                    >
                      Hide Message
                    </button>
                    <button 
                      onClick={() => handleDismissReportAsKept(item.report_id)}
                      className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 shadow-sm"
                    >
                      Keep & Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
} 