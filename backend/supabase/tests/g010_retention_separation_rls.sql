begin;

-- Execute after the G010 foundation and retention migrations. This test keeps
-- retained content out of fixtures: source references are irreversible hashes.
do $$
declare
  v_cutoff timestamptz := '2026-07-12T00:00:00.000Z'::timestamptz;
  v_preview jsonb;
  v_apply jsonb;
  v_final jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_idempotency_key text := 'g010-retention-test-0001';
  v_subject_active text := repeat('a', 64);
  v_subject_expired text := repeat('b', 64);
  v_subject_released text := repeat('c', 64);
  v_storage_id uuid;
  v_unrelated_id uuid;
  v_audit_now timestamptz;
  v_audit_retention_until timestamptz;
begin
  if has_schema_privilege('anon', 'privacy_retention', 'usage')
    or has_schema_privilege('authenticated', 'privacy_retention', 'usage')
    or has_table_privilege('anon', 'privacy_retention.privacy_retention_runs', 'select')
    or has_table_privilege('authenticated', 'privacy_retention.privacy_legal_holds', 'select')
    or has_function_privilege('anon', 'public.preview_privacy_retention_run(text,timestamp with time zone,integer,integer)', 'execute')
    or has_function_privilege('authenticated', 'public.apply_privacy_retention_run(uuid,text,text,integer)', 'execute')
  then
    raise exception 'G010 retention tables or RPCs are exposed to a browser role';
  end if;

  if has_table_privilege('service_role', 'privacy_retention.privacy_retention_runs', 'select')
    or not has_function_privilege('service_role', 'public.preview_privacy_retention_run(text,timestamp with time zone,integer,integer)', 'execute')
    or not has_function_privilege('service_role', 'public.finalize_privacy_retention_run(uuid,text,text)', 'execute')
  then
    raise exception 'G010 retention runner grant matrix is not least-privilege';
  end if;

  if exists (
    select 1
    from privacy_retention.privacy_retention_classes
    where code in (
      'access_log_1y',
      'access_log_2y',
      'ecommerce_advertising_6m',
      'ecommerce_contract_5y',
      'ecommerce_payment_supply_5y',
      'ecommerce_dispute_3y',
      'privacy_identity_audit',
      'privacy_marketing_audit',
      'privacy_account_deletion_audit',
      'privacy_incident_audit'
    )
      and status <> 'disabled'
  ) then
    raise exception 'statutory retention classes must begin disabled';
  end if;

  begin
    update privacy_retention.privacy_retention_classes
    set status = 'active'
    where code = 'access_log_1y';
    raise exception 'unconfigured disabled class unexpectedly activated';
  exception when check_violation then
    null;
  end;

  begin
    perform public.privacy_resolve_audit_retention_until(
      'privacy_identity_audit',
      pg_catalog.clock_timestamp()
    );
    raise exception 'disabled audit retention class unexpectedly resolved';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  update privacy_retention.privacy_retention_classes
  set
    data_class = 'privacy_identity_audit',
    basis_code = 'test.operator_approved_identity_audit',
    trigger_type = 'event_occurred',
    retention_period = interval '90 days',
    status = 'active',
    approved_evidence_ref = 'G010-TEST-IDENTITY-AUDIT',
    version = 'test-v1'
  where code = 'privacy_identity_audit';

  v_audit_now := pg_catalog.clock_timestamp();
  v_audit_retention_until := public.privacy_resolve_audit_retention_until(
    'privacy_identity_audit',
    v_audit_now
  );
  if v_audit_retention_until <> v_audit_now + interval '90 days' then
    raise exception 'approved audit retention class did not resolve its exact period';
  end if;

  insert into privacy_retention.privacy_retention_classes (
    code, data_class, basis_code, trigger_type, retention_period, status, approved_evidence_ref, version
  ) values (
    'g010_test_retention', 'g010_test_record', 'operator_reviewed_test', 'test_trigger', interval '1 year', 'draft', 'evidence-g010-test', 'test-v1'
  );
  insert into privacy_retention.privacy_retention_class_sources (class_code, source_type, disposition)
  values
    ('g010_test_retention', 'ocr_metadata', 'separate'),
    ('g010_test_retention', 'storage_object', 'purge');
  update privacy_retention.privacy_retention_classes
  set status = 'active'
  where code = 'g010_test_retention';
  begin
    insert into privacy_retention.privacy_retention_class_sources (class_code, source_type, disposition)
    values ('g010_test_retention', 'notification', 'separate');
    raise exception 'active class unexpectedly accepted a new source type';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  begin
    update privacy_retention.privacy_retention_classes
    set retention_period = interval '2 years'
    where code = 'g010_test_retention';
    raise exception 'activated class configuration unexpectedly changed';
  exception when object_not_in_prerequisite_state then
    null;
  end;

  -- Before/at are included; after is excluded. Active holds are planned as
  -- held; expired and released holds do not extend retention.
  insert into privacy_retention.privacy_retention_work_items (
    class_code, data_class, source_type, source_ref_hash, subject_ref_hash, trigger_at
  ) values
    ('g010_test_retention', 'g010_test_record', 'ocr_metadata', repeat('1', 64), repeat('1', 64), v_cutoff - interval '1 microsecond'),
    ('g010_test_retention', 'g010_test_record', 'ocr_metadata', repeat('2', 64), v_subject_active, v_cutoff),
    ('g010_test_retention', 'g010_test_record', 'ocr_metadata', repeat('3', 64), repeat('3', 64), v_cutoff + interval '1 microsecond'),
    ('g010_test_retention', 'g010_test_record', 'ocr_metadata', repeat('4', 64), v_subject_expired, v_cutoff),
    ('g010_test_retention', 'g010_test_record', 'ocr_metadata', repeat('5', 64), v_subject_released, v_cutoff);

  insert into privacy_retention.privacy_retention_work_items (
    class_code, data_class, source_type, source_ref_hash, subject_ref_hash, trigger_at, storage_bucket, storage_object_name
  ) values (
    'g010_test_retention', 'g010_test_record', 'storage_object', repeat('6', 64), repeat('6', 64), v_cutoff, 'g010-test-bucket', 'opaque/object-reference'
  ) returning id into v_storage_id;

  insert into privacy_retention.privacy_retention_work_items (
    class_code, data_class, source_type, source_ref_hash, trigger_at
  ) values (
    'access_log_1y', 'g010_unrelated_record', 'access_log', repeat('7', 64), v_cutoff - interval '1 microsecond'
  ) returning id into v_unrelated_id;

  insert into privacy_retention.privacy_legal_holds (
    subject_ref_hash, data_class, reason_code, approved_by, approved_evidence_ref, expires_at
  ) values
    (v_subject_active, 'g010_test_record', 'test_hold', gen_random_uuid(), 'evidence-active-hold', null),
    (v_subject_expired, 'g010_test_record', 'test_hold', gen_random_uuid(), 'evidence-expired-hold', v_cutoff),
    (v_subject_released, 'g010_test_record', 'test_hold', gen_random_uuid(), 'evidence-released-hold', null);
  update privacy_retention.privacy_legal_holds
  set status = 'released', released_at = v_cutoff - interval '1 microsecond'
  where subject_ref_hash = v_subject_released;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

  select public.preview_privacy_retention_run('g010_test_retention', v_cutoff, 10, 10000) into v_preview;
  if (v_preview #>> '{summary,eligible}')::integer <> 4
    or (v_preview #>> '{summary,held}')::integer <> 1
    or (v_preview #>> '{summary,scanned}')::integer <> 5
    or v_preview ->> 'requiredConfirmation' <> '보존·분리 적용'
  then
    raise exception 'cutoff or hold preview semantics are incorrect: %', v_preview;
  end if;

  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  perform public.confirm_privacy_retention_run(v_run_id, v_preview_hash, '보존·분리 적용', v_idempotency_key);
  select public.apply_privacy_retention_run(v_run_id, v_preview_hash, v_idempotency_key, 10000) into v_apply;

  if v_apply ->> 'status' <> 'applied'
    or (select count(*) from privacy_retention.privacy_retained_records where class_code = 'g010_test_retention') <> 3
    or (select status from privacy_retention.privacy_retention_work_items where source_ref_hash = repeat('2', 64)) <> 'pending'
    or (select status from privacy_retention.privacy_retention_work_items where id = v_unrelated_id) <> 'pending'
  then
    raise exception 'active hold survived or unrelated row was modified incorrectly';
  end if;

  if not exists (
    select 1 from public.claim_privacy_retention_storage_items(v_run_id, v_preview_hash, v_idempotency_key, 10)
    where work_item_id = v_storage_id
  ) then
    raise exception 'storage object was not claimed by the bounded service runner';
  end if;
  if public.ack_privacy_retention_storage_items(v_run_id, v_preview_hash, v_idempotency_key, array[v_storage_id], true) <> 1 then
    raise exception 'storage object acknowledgement did not update exactly one item';
  end if;

  select public.finalize_privacy_retention_run(v_run_id, v_preview_hash, v_idempotency_key) into v_final;
  if v_final ->> 'status' <> 'partial' or (v_final #>> '{readback,passed}')::boolean then
    raise exception 'run completed before active hold release/readback';
  end if;

  update privacy_retention.privacy_legal_holds
  set status = 'released', released_at = v_cutoff + interval '1 microsecond'
  where subject_ref_hash = v_subject_active;

  -- Same operation/idempotency key resumes the partial run without duplicate copies.
  perform public.apply_privacy_retention_run(v_run_id, v_preview_hash, v_idempotency_key, 10000);
  select public.finalize_privacy_retention_run(v_run_id, v_preview_hash, v_idempotency_key) into v_final;
  if v_final ->> 'status' <> 'applied'
    or not (v_final #>> '{readback,passed}')::boolean
    or (select count(*) from privacy_retention.privacy_retained_records where class_code = 'g010_test_retention') <> 4
    or (select status from privacy_retention.privacy_retention_work_items where id = v_storage_id) <> 'purged'
  then
    raise exception 'partial run was not idempotently resumed with matching readback';
  end if;

  if position('pg_try_advisory_xact_lock' in pg_get_functiondef('public.apply_privacy_retention_run(uuid,text,text,integer)'::regprocedure)) = 0
    or position('skip locked' in lower(pg_get_functiondef('public.apply_privacy_retention_run(uuid,text,text,integer)'::regprocedure))) = 0
  then
    raise exception 'retention apply must use bounded concurrent-run locking';
  end if;
end;
$$;

rollback;
