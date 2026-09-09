# Canonical catalog generator: local Docker admission

`generate_g014_catalog_contract_baseline.sh` resolves the account's saved Docker
context through `catalog_docker_endpoint.py`. This is read-only discovery: it
never runs `docker context use` or changes global Docker configuration.
Discovery inherits only PATH and the operating-system account home, dropping
`DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, TLS and API-version overrides.
Compose/image operations retain their existing empty-environment wrapper, private
Docker config directory and explicitly admitted `DOCKER_HOST`.

The existing fixed Desktop/Linux endpoints remain admitted:

- `unix:///var/run/docker.sock`
- `npipe:////./pipe/docker_engine`
- `npipe:////./pipe/dockerDesktopLinuxEngine`

On Darwin only, saved context `colima` additionally admits the exact socket
`<current account home>/.colima/default/docker.sock`. HOME environment substitution,
other Colima profiles, alternate paths, traversal, TCP and SSH URLs are not
accepted. The account home must resolve without symlink substitution; home,
`.colima`, `default` and the socket must be owned by the current UID, not
symlinks, and not group/world writable. The final entry must actually be a Unix
socket. Unavailable or incompatible installations fail with a fixed denial code;
the generator does not repair permissions, install/start Colima or switch contexts.
This validates a local endpoint, not the daemon's provenance or any hosted state.

The helper is included in the generator's clean-source inventory. Its source
must be committed along with the generator before a canonical run. Database index
and AMD64 manifest digests, `linux/amd64` inspection/execution, isolated compose
project and all canonical replay/verification requirements remain unchanged.

Read-only admission check from the repository root:

```sh
python3 backend/supabase/scripts/catalog_docker_endpoint.py
```

After committing relevant source inputs, generate into a new, absent directory:

```sh
bash backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh --output-dir /absolute/new/evidence-directory
```

A successful admission check does not establish successful generation. Retain
actual replay artifacts and run the independent dual-replay comparison for that
claim. No hosted database operation is part of either command.

The Catalog workflow now triggers on the endpoint helper/tests, G014 diagnostic
source/tests and restaurant-refresh boundary tests. Its private database step
runs both boundary modules with their explicit opt-ins; source-only tests cannot
silently substitute for those database branches.
