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
                
                # Check if migration needed
                if 'recollect_vars' not in data:
                    reason = data.get('recollect_reason')
                    
                    # Create list
                    if reason:
                        data['recollect_vars'] = [reason]
                    else:
                        data['recollect_vars'] = []
                    
                    changed = True
                
                updated_lines.append(json.dumps(data, ensure_ascii=False) + '\n')
            except:
                updated_lines.append(line) # Keep corrupted lines as is
        
        if changed:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.writelines(updated_lines)
            print(f"[Migrated] {filepath}")
        else:
            # print(f"[Skipped] {filepath}")
            pass

    except Exception as e:
        print(f"[Error] {filepath}: {e}")

def main():
    # Target all types
    targets = ["meta", "heatmap", "transcript"]
    
    total_files = 0
    for target in targets:
        pattern = str(BASE_DIR / "**" / target / "*.jsonl")
        files = glob.glob(pattern, recursive=True)
        print(f"Migrating {target}: Found {len(files)} files")
        
        for f in files:
            migrate_file(f)
        total_files += len(files)
        
    print(f"Done. Processed {total_files} files.")

if __name__ == "__main__":
    main()
