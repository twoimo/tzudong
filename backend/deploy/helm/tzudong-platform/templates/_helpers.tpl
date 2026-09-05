{{/*
Derived-field helpers (design C10, Requirement 14.5).

The cluster identifier is the only render parameter that differentiates two
renders. Every field below is *derived* from .Values.clusterId, so rendering the
same chart for two cluster identifiers differs only in these derived fields:
namespace, releaseName, clusterLabel, fullname.
*/}}

{{- define "tzudong.clusterId" -}}
{{- required "clusterId render parameter is required" .Values.clusterId | lower | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Keep external *_REF identities separate from valid Secret object names. */}}
{{- define "tzudong.secretName" -}}
{{- if or (gt (len .) 63) (not (regexMatch "^[A-Z][A-Z0-9_]*_REF$" .)) -}}
{{- fail "secret_reference_invalid" -}}
{{- end -}}
{{- . | lower | replace "_" "-" -}}
{{- end -}}

{{/* Kubernetes object, label, and container-safe component identifier. */}}
{{- define "tzudong.componentName" -}}
{{- . | lower | replace "_" "-" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tzudong.namespace" -}}
{{- printf "tzudong-%s" (include "tzudong.clusterId" .) -}}
{{- end -}}

{{- define "tzudong.releaseName" -}}
{{- printf "tzudong-%s" (include "tzudong.clusterId" .) -}}
{{- end -}}

{{- define "tzudong.clusterLabel" -}}
{{- include "tzudong.clusterId" . -}}
{{- end -}}

{{/* fullname: <clusterId>-<componentName> derived per component. */}}
{{- define "tzudong.fullname" -}}
{{- printf "%s-%s" (include "tzudong.clusterId" .root) (include "tzudong.componentName" .name) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
