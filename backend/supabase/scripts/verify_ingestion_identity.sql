-- Run after the correction inside a transaction that is always rolled back.
DO $verify$
DECLARE rejected boolean;
BEGIN
  INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status, is_ingestion_candidate)
  VALUES ('identity-check-a', 'Identity Check A', 'https://youtu.be/localID0001', 'pending', true);
  INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status)
  VALUES ('identity-check-b', 'Identity Check B', 'https://youtu.be/localID0001', 'approved');

  rejected := false;
  BEGIN
    INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status, is_ingestion_candidate)
    VALUES ('identity-check-c', 'Identity Check C', 'https://youtu.be/localID0001', 'pending', true);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'candidate_duplicate_admitted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status)
    VALUES ('identity-check-d', 'Identity Check B', 'https://youtu.be/localID0001', 'approved');
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'restaurant_duplicate_admitted'; END IF;

  -- Changing a claimed video's URL retains the claim on its new identity.
  UPDATE public.restaurants SET youtube_link='https://youtu.be/localID0002'
  WHERE trace_id='identity-check-a';
  rejected := false;
  BEGIN
    INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status, is_ingestion_candidate)
    VALUES ('identity-check-e', 'Identity Check E', 'https://youtu.be/localID0002', 'pending', true);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'updated_candidate_duplicate_admitted'; END IF;

  UPDATE public.restaurants SET status='deleted' WHERE trace_id='identity-check-a';
  INSERT INTO public.restaurants (trace_id, approved_name, youtube_link, status, is_ingestion_candidate)
  VALUES ('identity-check-f', 'Identity Check F', 'https://youtu.be/localID0002', 'pending', true);
END $verify$;
