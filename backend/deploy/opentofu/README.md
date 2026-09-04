# tzudong OpenTofu Deployment_Descriptor_Set

Local-render descriptor set for the platform-modernization migration readiness
(design C10, Requirement 14).

## Local render only

This configuration is inspected locally and never applied to a remote target.

```text
tofu init -backend=false
tofu plan -var 'cluster_id=local-a'
tofu plan -var 'cluster_id=local-b'
```

- No remote backend is declared and no provider credentials are configured.
- The Deployment_Descriptor_Set checker records a remote apply attempt count of
  0. If a render requests remote cluster credentials or remote apply permission
  the checker refuses with the fixed code `remote_apply_not_admitted` and leaves
  no partial render artifact.

## Secret handling

Secret values never appear in these files. Credential, token, and
connection-string secret components are indicated by external secret reference
names only (`*_REF`), matching `backend/deploy/migration-readiness.v1.json` and
the Helm `values.yaml`. A credential or token literal detected in any descriptor
file fails the check with the fixed code `secret_value_in_descriptor` and
produces no render artifact.

## Cluster parameter

`cluster_id` is the only render parameter. Rendering the same source for two or
more cluster identifiers differs only in derived fields (`namespace`,
`release_name`, `cluster_label`, per-component `fullname`).

## Out of scope

- Vercel actions require the Git-integrated `tzudong` project to be verified and
  read back first; an unverified project or a `web` project directive returns
  `vercel_project_not_verified`.
- DNS record changes are out of scope for this spec's automation and return
  `dns_change_out_of_scope`.

This source tree makes no claim that any deployment occurred.
