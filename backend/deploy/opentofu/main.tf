# Deployment_Descriptor_Set - OpenTofu component definitions (design C10).
#
# Local render only. This configuration produces a local plan/render artifact.
# It declares no remote backend and no provider credentials; a render must not
# require remote cluster credentials or remote apply permission. The
# Deployment_Descriptor_Set checker records a remote apply attempt count of 0.
#
# Each of the five components carries all four required items and leaves none
# empty: image reference, resource requests, environment variable names with a
# source reference, and secret reference names. Secret values are indicated by
# external reference names only.

terraform {
  required_version = ">= 1.12.0"
}

locals {
  # Derived fields (Requirement 14.5). Everything that varies between two
  # cluster renders is derived from var.cluster_id.
  namespace     = "tzudong-${var.cluster_id}"
  release_name  = "tzudong-${var.cluster_id}"
  cluster_label = var.cluster_id

  # Cluster-invariant component definitions. Identical across cluster renders.
  components = {
    Web_App = {
      image = "registry.local/tzudong/web-app:1.4.0"
      resource_request = {
        cpu    = "250m"
        memory = "512Mi"
      }
      env = [
        { name = "NODE_ENV", source = "configmap:web-app-config/node_env" },
        { name = "SUPABASE_URL", source = "secretRef:SUPABASE_URL_REF" },
        { name = "SUPABASE_ANON_KEY", source = "secretRef:SUPABASE_ANON_KEY_REF" },
        { name = "SUPABASE_SERVICE_ROLE_KEY", source = "secretRef:SUPABASE_SERVICE_ROLE_KEY_REF" },
      ]
    }
    Backend_Runtime = {
      image = "registry.local/tzudong/pipeline-worker:1.4.0"
      resource_request = {
        cpu    = "500m"
        memory = "1Gi"
      }
      env = [
        { name = "TZUDONG_PROFILE", source = "configmap:backend-runtime-config/profile" },
        { name = "PIPELINE_PG_DSN", source = "secretRef:PIPELINE_PG_DSN_REF" },
        { name = "GEMINI_API_KEY", source = "secretRef:GEMINI_API_KEY_REF" },
        { name = "YOUTUBE_API_KEY", source = "secretRef:YOUTUBE_API_KEY_REF" },
      ]
    }
    Local_Stack = {
      image = "registry.local/tzudong/local-stack:1.4.0"
      resource_request = {
        cpu    = "500m"
        memory = "1Gi"
      }
      env = [
        { name = "POSTGRES_DB", source = "configmap:local-stack-config/postgres_db" },
        { name = "MANAGED_PG_DSN", source = "secretRef:MANAGED_PG_DSN_REF" },
        { name = "JWT_SECRET", source = "secretRef:JWT_SECRET_REF" },
      ]
    }
    Observability_Stack = {
      image = "registry.local/tzudong/observability:1.4.0"
      resource_request = {
        cpu    = "250m"
        memory = "768Mi"
      }
      env = [
        { name = "GF_SERVER_ROOT_URL", source = "configmap:observability-config/grafana_root_url" },
        { name = "GF_SECURITY_ADMIN_PASSWORD", source = "secretRef:GRAFANA_ADMIN_PASSWORD_REF" },
        { name = "LOKI_STORAGE", source = "secretRef:LOKI_STORAGE_REF" },
      ]
    }
    Log_Pipeline = {
      image = "registry.local/tzudong/otel-collector:1.4.0"
      resource_request = {
        cpu    = "200m"
        memory = "384Mi"
      }
      env = [
        { name = "OTEL_LOG_LEVEL", source = "configmap:log-pipeline-config/otel_log_level" },
        { name = "LOG_SINK_URL", source = "secretRef:LOG_SINK_URL_REF" },
        { name = "LOG_SINK_TOKEN", source = "secretRef:LOG_SINK_TOKEN_REF" },
      ]
    }
  }

  # Rendered per-component descriptor. Derived name/namespace/label are the only
  # cluster-dependent fields.
  rendered = {
    for component_id, definition in local.components : component_id => {
      fullname      = replace(lower("${var.cluster_id}-${component_id}"), "_", "-")
      namespace     = local.namespace
      cluster_label = local.cluster_label
      image         = definition.image
      resources     = definition.resource_request
      env           = definition.env
      secret_refs   = var.secret_reference_names[component_id]
    }
  }
}
