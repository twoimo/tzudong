DO $version_guard$
BEGIN
  IF current_setting('server_version_num')::integer <> 170006 THEN
    RAISE EXCEPTION 'PARSER_FIX_WRONG_POSTGRES_VERSION';
  END IF;
END;
$version_guard$;

CREATE FUNCTION public.case_fixture(x integer) RETURNS integer LANGUAGE SQL
BEGIN ATOMIC
  SELECT CASE WHEN x > 0 THEN x ELSE 0 END;
END;

CREATE FUNCTION public.nested_case_fixture(x integer) RETURNS integer LANGUAGE SQL
BEGIN ATOMIC
  SELECT CASE WHEN x > 0 THEN CASE WHEN x > 1 THEN 2 ELSE 1 END ELSE 0 END;
END;

CREATE FUNCTION public.identifier_fixture(weekend text) RETURNS text LANGUAGE SQL
BEGIN ATOMIC
  SELECT weekend;
  SELECT weekend;
END;

CREATE FUNCTION public.comment_fixture() RETURNS integer LANGUAGE SQL
BEGIN /* reviewed gap */ ATOMIC
  SELECT 1;
END;

DO $assertions$
BEGIN
  IF public.case_fixture(4) IS DISTINCT FROM 4
    OR public.nested_case_fixture(3) IS DISTINCT FROM 2
    OR public.identifier_fixture('kept') IS DISTINCT FROM 'kept'
    OR public.comment_fixture() IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION 'PARSER_FIX_ASSERTION_FAILED';
  END IF;
END;
$assertions$;

SELECT jsonb_build_object(
  'server_version_num', current_setting('server_version_num'),
  'case', public.case_fixture(4) = 4,
  'nested_case', public.nested_case_fixture(3) = 2,
  'identifier_suffix', public.identifier_fixture('kept') = 'kept',
  'comment_separated_begin_atomic', public.comment_fixture() = 1
) AS result;
