DECLARE
  global_chat_id UUID := '14502958-08e6-4840-a03f-4815d19db023'; -- Your Global Chat ID (can be NULL if not used)
  admin_user_id UUID  := '5db7397a-c516-4d39-ab84-a13bd337d2e6';   -- CORRECT Coach Joe's ID
  new_private_chat_id UUID;
  new_user_email TEXT;
  new_user_username TEXT;
BEGIN
  -- Get the email of the new user from auth.users
  -- This function is intended to be triggered by an AFTER INSERT trigger on auth.users
  new_user_email := NEW.email; 

  -- 1. Create the profile for the new user
  -- Use the user's email as their initial username.
  new_user_username := new_user_email; 

  INSERT INTO public.profiles (id, username, is_admin, is_banned) 
  VALUES (NEW.id, new_user_username, FALSE, FALSE);

  -- 2. Add user to the global group chat
  IF global_chat_id IS NOT NULL THEN
    INSERT INTO public.chat_participants (chat_id, user_id, created_at)
    VALUES (global_chat_id, NEW.id, now())
    ON CONFLICT (chat_id, user_id) DO NOTHING; 
  ELSE
    RAISE WARNING '[handle_new_user_with_chat_join] Global chat ID is NULL. User % not added to global chat.', NEW.id;
  END IF;

  -- 3. Create a new private 1-on-1 chat with Coach Joe
  IF NEW.id != admin_user_id AND admin_user_id IS NOT NULL THEN
    INSERT INTO public.chats (name, last_message_at)
    VALUES ('Chat with Coach Joe/' || new_user_username, now()) 
    RETURNING id INTO new_private_chat_id;

    INSERT INTO public.chat_participants (chat_id, user_id, created_at)
    VALUES (new_private_chat_id, NEW.id, now());

    INSERT INTO public.chat_participants (chat_id, user_id, created_at)
    VALUES (new_private_chat_id, admin_user_id, now())
    ON CONFLICT (chat_id, user_id) DO NOTHING;
  ELSE
     RAISE WARNING '[handle_new_user_with_chat_join] Admin user ID is NULL or new user is admin. Private chat not created for %.', NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING '[Custom Trigger Error] In handle_new_user_with_chat_join for user ID % (email: %): %. SQLSTATE: %', 
                  NEW.id, 
                  COALESCE(new_user_email, 'N/A'), 
                  SQLERRM, 
                  SQLSTATE;
    RETURN NEW; 
END; 