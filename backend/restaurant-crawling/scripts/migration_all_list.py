import os
import json
import glob
from pathlib import Path

# Base Path
BASE_DIR = Path("/home/ubuntu/tzudong/backend/restaurant-crawling/data")

def migrate_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        if not lines:
            return

        updated_lines = []
        changed = False

        for line in lines:
            try:
                data = json.loads(line.strip())
                
                original_vars = data.get('recollect_vars', [])
                # Handle case where vars might not have been created yet (if run cleanly) OR fixing previous run
                if 'recollect_vars' not in data:
                    reason = data.get('recollect_reason')
                    original_vars = [reason] if reason else []

                # Filter "migration"
                new_vars = [v for v in original_vars if v != "migration"]
                
                # Check changes
                has_migration_string = "migration" in original_vars
                has_legacy_key = "recollect_reason" in data
                vars_changed = (original_vars != new_vars) or ('recollect_vars' not in data)

                if has_legacy_key or vars_changed or has_migration_string:
                    data['recollect_vars'] = new_vars
                    if 'recollect_reason' in data:
                        del data['recollect_reason']
                    changed = True
                
                updated_lines.append(json.dumps(data, ensure_ascii=False) + '\n')
            except:
                updated_lines.append(line) 
        
        if changed:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(updated_lines)
            print(f"[Fixed] {filepath}")

    except Exception as e:
        print(f"[Error] {filepath}: {e}")

def main():
    targets = ["meta", "heatmap", "transcript"]
    total_files = 0
    for target in targets:
        pattern = str(BASE_DIR / "**" / target / "*.jsonl")
        files = glob.glob(pattern, recursive=True)
        print(f"Checking {target}: Found {len(files)} files")
        
        for f in files:
            migrate_file(f)
        total_files += len(files)
        
    print(f"Done. Processed {total_files} files.")

if __name__ == "__main__":
    main()
