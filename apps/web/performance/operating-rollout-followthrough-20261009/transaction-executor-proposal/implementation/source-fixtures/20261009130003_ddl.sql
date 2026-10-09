-- owned runtime fixture only
BEGIN;
CREATE TABLE public.fixture_ddl(id int);
SELECT * FROM public.fixture_nonexistent;
COMMIT;
