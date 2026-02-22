#!/bin/bash
# Storage Migration Script: Supabase Cloud -> Self-Hosted
set -euo pipefail

# Required settings are injected via environment variables.
# Example:
# CLOUD_URL=https://<project-ref>.supabase.co
# PGHOST=<postgres-host>
# PGUSER=<postgres-user>
# PGPASSWORD=<postgres-password>
# SERVICE_ROLE_KEY=<service-role-jwt>
#
# Optional:
# SELF_HOST_URL=http://localhost:8000
# PGPORT=5432
# PGDATABASE=postgres

CLOUD_URL="${CLOUD_URL:-}"
SELF_HOST_URL="${SELF_HOST_URL:-http://localhost:8000}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
PGHOST="${PGHOST:-}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-}"
PGPASSWORD="${PGPASSWORD:-}"
PGDATABASE="${PGDATABASE:-postgres}"

if [[ -z "${CLOUD_URL}" ]]; then
    echo "CLOUD_URL is required."
    exit 1
fi

if [[ -z "${SERVICE_ROLE_KEY}" ]]; then
    echo "SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required."
    exit 1
fi

if [[ -z "${PGHOST}" || -z "${PGUSER}" || -z "${PGPASSWORD}" ]]; then
    echo "PGHOST, PGUSER, and PGPASSWORD are required."
    exit 1
fi

# Create temp directory
mkdir -p /tmp/storage_migration

# Get file list from Cloud database
PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -t -A -F '|' -c "SELECT bucket_id, name FROM storage.objects;" > /tmp/storage_migration/files.txt

# Download and upload each file
while IFS='|' read -r bucket_id filename; do
    echo "Processing: $bucket_id/$filename"
    
    # Create directory structure
    mkdir -p "/tmp/storage_migration/$bucket_id/$(dirname "$filename")"
    
    # Download from Cloud (public bucket)
    curl -s -o "/tmp/storage_migration/$bucket_id/$filename" \
        "$CLOUD_URL/storage/v1/object/public/$bucket_id/$filename"
    
    # Check if download was successful
    if [ -f "/tmp/storage_migration/$bucket_id/$filename" ] && [ -s "/tmp/storage_migration/$bucket_id/$filename" ]; then
        echo "  Downloaded: $bucket_id/$filename"
        
        # Upload to Self-Hosted
        curl -s -X POST \
            -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
            -H "Content-Type: application/octet-stream" \
            --data-binary "@/tmp/storage_migration/$bucket_id/$filename" \
            "$SELF_HOST_URL/storage/v1/object/$bucket_id/$filename"
        
        echo "  Uploaded: $bucket_id/$filename"
    else
        echo "  FAILED to download: $bucket_id/$filename"
    fi
done < /tmp/storage_migration/files.txt

echo "Migration complete!"
