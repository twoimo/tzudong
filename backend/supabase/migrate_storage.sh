#!/bin/bash
# Storage Migration Script: Supabase Cloud -> Self-Hosted

CLOUD_URL="https://aqlcofblfxdrjhhdmarw.supabase.co"
SELF_HOST_URL="http://localhost:8000"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NjkwNjU0MTcsImV4cCI6MTkyNjc0NTQxN30.h5POIDxJCNPTKV7RTMRUPzf9hyxogL0e9RFTFndX1z4"

# Create temp directory
mkdir -p /tmp/storage_migration

# Get file list from Cloud database
PGPASSWORD='H)M2MAprnII$vZKe' psql -h aws-1-ap-southeast-1.pooler.supabase.com -p 5432 -U postgres.aqlcofblfxdrjhhdmarw -d postgres -t -A -F '|' -c "SELECT bucket_id, name FROM storage.objects;" > /tmp/storage_migration/files.txt

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
