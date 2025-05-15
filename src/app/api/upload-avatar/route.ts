import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    console.log('[API /upload-avatar] Route hit');
    
    // Client for auth and user-specific db operations
    const supabaseUserClient = createRouteHandlerClient({ cookies });
    
    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
    
    if (authError || !user) {
      console.error('[API /upload-avatar] Authentication error:', authError);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log('[API /upload-avatar] SUPABASE_URL from env:', supabaseUrl);
    console.log('[API /upload-avatar] SERVICE_ROLE_KEY from env (first 5 chars if defined):', serviceRoleKey?.substring(0,5));

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[API /upload-avatar] Critical: Supabase URL or Service Role Key is missing from environment variables. Check .env.local and restart server.');
      return NextResponse.json({ error: 'Server configuration error for storage.' }, { status: 500 });
    }
    
    // Create a Supabase client with service_role privileges for storage operations
    const supabaseAdminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    
    // Parse the multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type: ${file.type}. Please upload a JPEG, PNG, or GIF image.` },
        { status: 400 }
      );
    }
    
    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File is too large. Maximum size is 5MB.' },
        { status: 400 }
      );
    }
    
    // Generate a unique file path
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;
    console.log(`[API /upload-avatar] Attempting to upload to path: ${filePath} with contentType: ${file.type}, size: ${file.size} bytes`);

    // First, try to clean up previous avatar files using admin client
    try {
      const { data: existingFiles } = await supabaseAdminClient.storage
        .from('avatars')
        .list(user.id);
      
      if (existingFiles && existingFiles.length > 0) {
        const filesToRemove = existingFiles.map(f => `${user.id}/${f.name}`);
        console.log('[API /upload-avatar] Attempting to remove existing files:', filesToRemove);
        await supabaseAdminClient.storage
          .from('avatars')
          .remove(filesToRemove);
      }
    } catch (error) {
      console.log('[API /upload-avatar] Error listing/cleaning up existing files with admin client (continuing upload):', error);
    }
    
    // const arrayBuffer = await file.arrayBuffer();
    // console.log(`[API /upload-avatar] ArrayBuffer size: ${arrayBuffer.byteLength}`);

    // --- ATTEMPT 1: Uploading the File object directly ---
    // Some server-side environments or older versions of the client might prefer ArrayBuffer,
    // but the modern client often handles File directly from FormData well.
    console.log('[API /upload-avatar] Attempting to upload File object directly.');
    const { error: uploadError, data: uploadData } = await supabaseAdminClient.storage
      .from('avatars')
      .upload(filePath, file, { // Passing the File object directly
        contentType: file.type,
        cacheControl: '3600',
        upsert: false 
      });
    
    // --- IF ATTEMPT 1 FAILS, UNCOMMENT AND RETRY WITH ArrayBuffer AS BEFORE ---
    // if (uploadError) { 
    //   console.warn('[API /upload-avatar] Uploading File object directly failed. Retrying with ArrayBuffer.', uploadError);
    //   const arrayBuffer = await file.arrayBuffer();
    //   console.log(`[API /upload-avatar] ArrayBuffer size: ${arrayBuffer.byteLength}`);
    //   const { error: uploadErrorRetry, data: uploadDataRetry } = await supabaseAdminClient.storage
    //     .from('avatars')
    //     .upload(filePath, arrayBuffer, {
    //       contentType: file.type,
    //       cacheControl: '3600',
    //       upsert: false
    //     });
    //   if (uploadErrorRetry) {
    //     console.error('[API /upload-avatar] Upload error with ArrayBuffer retry:', JSON.stringify(uploadErrorRetry, null, 2));
    //     return NextResponse.json({ error: 'Failed to upload file (ArrayBuffer retry)', details: uploadErrorRetry.message }, { status: 500 });
    //   }
    //   console.log('[API /upload-avatar] File uploaded successfully via ArrayBuffer retry:', uploadDataRetry);
    //   // Continue with publicUrlData and profile update using uploadDataRetry if this path is taken
    // }
    
    if (uploadError) {
      console.error('[API /upload-avatar] Upload error (tried File object):', JSON.stringify(uploadError, null, 2));
      return NextResponse.json({ error: 'Failed to upload file', details: uploadError.message }, { status: 500 });
    }
    console.log('[API /upload-avatar] File uploaded successfully (using File object or ArrayBuffer if retry was enabled):', uploadData);
    
    // Get the public URL using admin client
    const { data: publicUrlData } = supabaseAdminClient.storage
      .from('avatars')
      .getPublicUrl(filePath);
    
    console.log('[API /upload-avatar] Got public URL:', publicUrlData.publicUrl);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      console.error('[API /upload-avatar] Failed to get public URL for the uploaded file.');
      // Attempt to remove the possibly failed/partial upload if URL retrieval fails
      try {
        await supabaseAdminClient.storage.from('avatars').remove([filePath]);
        console.log('[API /upload-avatar] Cleaned up avatar after failed public URL retrieval.');
      } catch (cleanupError) {
        console.error('[API /upload-avatar] Failed to cleanup avatar after public URL retrieval failure:', cleanupError);
      }
      return NextResponse.json({ error: 'Failed to get public URL for avatar.' }, { status: 500 });
    }
    
    // Update the user's profile with the new avatar URL using user client
    const { error: updateError } = await supabaseUserClient
      .from('profiles')
      .update({ avatar_url: publicUrlData.publicUrl })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('[API /upload-avatar] Profile update error:', updateError);
      // Attempt to remove the uploaded avatar if profile update fails
      try {
        await supabaseAdminClient.storage.from('avatars').remove([filePath]);
        console.log('[API /upload-avatar] Cleaned up avatar after profile update failure.');
      } catch (cleanupError) {
        console.error('[API /upload-avatar] Failed to cleanup avatar after profile update failure:', cleanupError);
      }
      return NextResponse.json(
        { error: 'Failed to update profile', details: updateError.message },
        { status: 500 }
      );
    }
    
    console.log('[API /upload-avatar] Avatar uploaded and profile updated successfully with URL:', publicUrlData.publicUrl);
    
    return NextResponse.json({
      success: true,
      avatar_url: publicUrlData.publicUrl
    });
  } catch (error: any) {
    console.error('[API /upload-avatar] Unexpected error in POST handler:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
} 