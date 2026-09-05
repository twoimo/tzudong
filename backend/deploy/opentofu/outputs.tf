# Local render outputs (design C10, Requirement 14.6).
#
# These outputs expose the rendered descriptor set as a local artifact. No
# remote target is contacted; the render is inspected with `tofu plan` / local
# evaluation only.

output "cluster_id" {
  description = "The cluster identifier this render was parameterized with."
  value       = var.cluster_id
}

output "namespace" {
  description = "Derived namespace for this cluster render."
  value       = local.namespace
}

output "rendered_components" {
  description = "Per-component rendered descriptor (secret reference names only, no values)."
  value       = local.rendered
}
