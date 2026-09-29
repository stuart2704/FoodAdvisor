-- Capture the exact rows removed by FK cascades, in the same transaction as
-- the restaurant deletion. A caller may delete restaurants without using the
-- chef routes, so application-side cleanup alone cannot cover this case.
CREATE OR REPLACE FUNCTION queue_cascaded_chef_photo()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  path text;
BEGIN
  -- Ordinary profile removal is handled by the chef lifecycle. Ordinary intent
  -- expiry is handled by the cleanup worker; neither should enqueue twice.
  IF EXISTS (SELECT 1 FROM restaurants WHERE place_id = OLD.restaurant_id) THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'restaurant_chef_profiles' THEN
    path := OLD.photo_object_path;
  ELSE
    path := OLD.object_path;
  END IF;

  IF path IS NOT NULL THEN
    -- Allow a signed upload already in flight to finish before deleting it.
    INSERT INTO chef_photo_deletion_queue (object_path, due_at)
    VALUES (path, now() + interval '20 minutes')
    ON CONFLICT (object_path) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS chef_profile_cascade_cleanup ON restaurant_chef_profiles;
CREATE TRIGGER chef_profile_cascade_cleanup
AFTER DELETE ON restaurant_chef_profiles
FOR EACH ROW EXECUTE FUNCTION queue_cascaded_chef_photo();

DROP TRIGGER IF EXISTS chef_intent_cascade_cleanup ON chef_photo_upload_intents;
CREATE TRIGGER chef_intent_cascade_cleanup
AFTER DELETE ON chef_photo_upload_intents
FOR EACH ROW EXECUTE FUNCTION queue_cascaded_chef_photo();