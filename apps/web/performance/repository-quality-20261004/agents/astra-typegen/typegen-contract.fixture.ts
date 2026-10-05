import type { Database, Json } from './database.types.generated';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Tables = Database['public']['Tables'];
type Functions = Database['public']['Functions'];
type ProductionTables =
  | 'admin_storyboard_production_assets'
  | 'admin_storyboard_production_events'
  | 'admin_storyboard_production_jobs'
  | 'admin_storyboard_production_projects'
  | 'admin_storyboard_production_restores'
  | 'admin_storyboard_production_revisions'
  | 'admin_storyboard_production_workers';
type ProductionFunctions =
  | 'storyboard_production_admin'
  | 'storyboard_production_assert_owner'
  | 'storyboard_production_auth_worker'
  | 'storyboard_production_error_allowed'
  | 'storyboard_production_final_status'
  | 'storyboard_production_job_json'
  | 'storyboard_production_model_available'
  | 'storyboard_production_project_json'
  | 'storyboard_production_snapshot'
  | 'storyboard_production_worker';

export type ExactTables = Assert<Equal<Extract<keyof Tables, `admin_storyboard_production_${string}`>, ProductionTables>>;
export type ExactFunctions = Assert<Equal<Extract<keyof Functions, `storyboard_production_${string}`>, ProductionFunctions>>;
export type EventIdentity = Assert<Equal<Tables['admin_storyboard_production_events']['Insert']['id'], undefined>>;
export type EventIdentityUpdate = Assert<Equal<Tables['admin_storyboard_production_events']['Update']['id'], undefined>>;
export type RequiredOwner = Assert<Equal<Tables['admin_storyboard_production_jobs']['Insert']['owner_id'], string>>;
export type LeaseNullability = Assert<Equal<Tables['admin_storyboard_production_jobs']['Row']['lease_token'], string | null>>;
export type CompositeOwnerReference = Assert<Equal<Tables['admin_storyboard_production_assets']['Relationships'][1]['referencedColumns'], ['id', 'owner_id']>>;
export type CompositeRowArgument = Assert<Equal<Functions['storyboard_production_job_json']['Args']['j'], Tables['admin_storyboard_production_jobs']['Row']>>;
export type OptionalPayload = Assert<Equal<Functions['storyboard_production_admin']['Args']['p_payload'], Json | undefined>>;
export type VoidReturn = Assert<Equal<Functions['storyboard_production_assert_owner']['Returns'], undefined>>;

// Negative contracts keep generated identity and required-owner restrictions.
// @ts-expect-error Identity GENERATED ALWAYS cannot be inserted explicitly.
const invalidIdentity: Tables['admin_storyboard_production_events']['Insert']['id'] = 1;
// @ts-expect-error The owner column is required and non-null.
const invalidOwner: Tables['admin_storyboard_production_jobs']['Insert']['owner_id'] = null;
void invalidIdentity;
void invalidOwner;
