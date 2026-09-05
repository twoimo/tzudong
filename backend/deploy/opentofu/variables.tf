# Deployment_Descriptor_Set - OpenTofu variables (design C10, Requirement 14.5).
#
# cluster_id is the render parameter. The same configuration is reused for two
# or more cluster identifiers; only the derived locals (namespace, release_name,
# cluster_label, and per-component fullname) change between renders.

variable "cluster_id" {
  description = "Cluster identifier render parameter. Reused across clusters; only derived fields differ."
  type        = string
  default     = "local-a"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.cluster_id))
    error_message = "cluster_id must be a short lowercase identifier."
  }
}

# Secret reference names ONLY. No credential, token, or connection-string value
# is stored here. These match backend/deploy/migration-readiness.v1.json and the
# Helm values.yaml *_REF identifiers. Values are resolved out of band from an
# external secret store by reference name at deploy time.
variable "secret_reference_names" {
  description = "External secret reference names per component (names only, never values)."
  type        = map(list(string))
  default = {
    Web_App = [
      "SUPABASE_URL_REF",
      "SUPABASE_ANON_KEY_REF",
      "SUPABASE_SERVICE_ROLE_KEY_REF",
    ]
    Backend_Runtime = [
      "PIPELINE_PG_DSN_REF",
      "GEMINI_API_KEY_REF",
      "YOUTUBE_API_KEY_REF",
    ]
    Local_Stack = [
      "MANAGED_PG_DSN_REF",
      "JWT_SECRET_REF",
    ]
    Observability_Stack = [
      "GRAFANA_ADMIN_PASSWORD_REF",
      "LOKI_STORAGE_REF",
    ]
    Log_Pipeline = [
      "LOG_SINK_URL_REF",
      "LOG_SINK_TOKEN_REF",
    ]
  }
}
