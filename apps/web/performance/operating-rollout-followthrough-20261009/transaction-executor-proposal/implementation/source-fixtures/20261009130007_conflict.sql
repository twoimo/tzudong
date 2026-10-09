-- owned runtime fixture only
BEGIN;
CREATE TABLE public.fixture_conflict(id int);
COMMIT;
