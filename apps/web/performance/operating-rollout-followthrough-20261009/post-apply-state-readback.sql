-- Only after all three migrations commit and presence is confirmed above.
-- Never call admin_record_action/readback in this READ ONLY transaction: its row lock requires a normal API transaction.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT state,count(*) AS operations FROM pipeline_control.admin_record_operations GROUP BY state ORDER BY state;
SELECT count(*) AS audit_rows FROM pipeline_control.admin_record_audit;
SELECT state,count(*) AS cleanup_jobs FROM pipeline_control.admin_record_media_cleanup GROUP BY state ORDER BY state;
SELECT count(*) AS broken_operation_audit_bindings FROM pipeline_control.admin_record_operations o
WHERE o.state='applied' AND NOT EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit a WHERE a.operation_id=o.id);
SELECT revision FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton;
ROLLBACK;
