\set ON_ERROR_STOP on
\pset pager off
\pset footer off
\pset format unaligned
\pset tuples_only on
SET client_min_messages = warning;
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED;
SHOW transaction_isolation;
\i /tmp/p1.sql
\i /tmp/h3.sql
SELECT 'PASS|P1_H3_CATALOG';
