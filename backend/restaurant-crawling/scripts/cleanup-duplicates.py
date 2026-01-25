import os
import json
import shutil
from pathlib import Path
from datetime import datetime, timezone, timedelta

# 환경 설정
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "log" / "cleanup"
KST = timezone(timedelta(hours=9))

def get_channel_path(channel_name):
    return DATA_DIR / channel_name

def load_jsonl(path):
    data = []
    if path.exists():
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        data.append(json.loads(line))
                    except:
                        pass
    return data

def save_jsonl(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        for item in data:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

def cleanup_channel(channel_name):
    print(f"=== Cleaning up channel: {channel_name} ===")
    channel_path = get_channel_path(channel_name)
    meta_dir = channel_path / "meta"
    heatmap_dir = channel_path / "heatmap"
    frames_dir = channel_path / "frames"
    thumb_dir = channel_path / "thumbnails"
    
    if not meta_dir.exists():
        print("Meta directory not found.")
        return

    for meta_file in meta_dir.glob("*.jsonl"):
        video_id = meta_file.stem
        records = load_jsonl(meta_file)
        
        if not records:
            continue
            
        unique_records = []
        last_kept_record = None
        removed_ids = []
        
        # 1. 중복 제거 단계
        for record in records:
            if not last_kept_record:
                unique_records.append(record)
                last_kept_record = record
                continue
                
            curr_time_str = record.get("collected_at")
            prev_time_str = last_kept_record.get("collected_at")
            
            if not curr_time_str or not prev_time_str:
                 unique_records.append(record)
                 last_kept_record = record
                 continue
                 
            try:
                curr_dt = datetime.fromisoformat(curr_time_str.replace("Z", "+00:00")).astimezone(KST)
                prev_dt = datetime.fromisoformat(prev_time_str.replace("Z", "+00:00")).astimezone(KST)
                
                is_same_day = curr_dt.date() == prev_dt.date()
                curr_vars = record.get("recollect_vars", [])
                
                is_duplicate = False
                if is_same_day:
                    if "scheduled_weekly" in curr_vars and "scheduled_weekly" in last_kept_record.get("recollect_vars", []):
                        is_duplicate = True
                        print(f"  [Meta Check] Duplicate Weekly found for {video_id}: ID {record.get('recollect_id')}")
                    elif (curr_dt - prev_dt).total_seconds() < 3600:
                        if "viral_growth" not in curr_vars and "new_video" not in curr_vars:
                             is_duplicate = True
                             print(f"  [Meta Check] Rapid re-collection found for {video_id}: ID {record.get('recollect_id')}")

                if is_duplicate:
                    removed_ids.append(record.get('recollect_id'))
                else:
                    unique_records.append(record)
                    last_kept_record = record
                    
            except Exception as e:
                unique_records.append(record)
                last_kept_record = record

        # 2. Reordering 단계 (ID 재정렬 및 파일/폴더 동기화)
        reordered_records = []
        id_mapping = {} # old_id -> new_id
        
        for idx, record in enumerate(unique_records):
            old_id = record.get('recollect_id')
            new_id = idx # 0부터 순차 할당
            
            if old_id != new_id:
                id_mapping[old_id] = new_id
                record['recollect_id'] = new_id
                
            reordered_records.append(record)

        if removed_ids or id_mapping:
            print(f"  Processing {video_id}: Removed {len(removed_ids)}, Reordered {len(id_mapping)}")
            
            # 메타 파일 저장
            save_jsonl(meta_file, reordered_records)
            
            # 히트맵 파일 처리
            h_path = heatmap_dir / f"{video_id}.jsonl"
            if h_path.exists():
                heatmaps = load_jsonl(h_path)
                new_heatmaps = []
                for h in heatmaps:
                    rid = h.get('recollect_id')
                    if rid in removed_ids:
                        continue # 삭제된 ID는 히트맵도 제외
                    
                    if rid in id_mapping:
                        h['recollect_id'] = id_mapping[rid]
                    new_heatmaps.append(h)
                
                save_jsonl(h_path, new_heatmaps)

            # Frames 폴더 처리
            # 먼저 삭제
            for rid in removed_ids:
                f_path = frames_dir / video_id / str(rid)
                if f_path.exists():
                    try: shutil.rmtree(f_path) 
                    except: pass
            
            # 그 다음 이름 변경 (높은 번호 -> 낮은 번호 순으로 바뀌므로 충돌 가능성? -> 3->2, 4->3..
            # 임시 이름으로 먼저 바꾸고 다시 바꾸는 게 안전하지만, 
            # 여기선 순차 증가(gap filling)이므로 작은 숫자가 이미 점유될 일은 없음 (clean상태라면)
            # 하지만 4->3으로 갈 때 3이 이미 있으면? (근데 3이 있었으면 id_mapping에 없을 것)
            # id_mapping은 {4:3, 6:4} 이런 식이 될 것. 
            # 순서가 중요함. 낮은 ID부터 처리하면 안됨. 
            # 예: 0, 1, 3(->2), 4(->3). 
            # 3->2는 2가 이미 있으므로(원래 2번 데이터) 불가?
            # 아님. unique_records 순서대로 0,1,2,3... 이 되니까.
            # 원래 0 -> 0 (mapping x)
            # 원래 1 -> 1 (mapping x)
            # 원래 3 -> 2 (mapping o) -> 폴더 '3'을 '2'로? 아니 '2'는 원래 '2'가 있었으면... 
            # 아, removed_ids에 2가 있었으면 폴더 2는 지워짐.
            # removed_ids에 없었으면 폴더 2는 2로 남음 (mapping x).
            # 즉, target ID (new_id)가 이미 존재하는 폴더면 충돌.
            # 따라서 id_mapping에 있는 애들은 "이동해야 할" 애들임.
            # 충돌 방지를 위해 정렬: 작은 ID로 이동하는 경우, 작은 ID쪽이 비어있어야 함.
            # Gap filling은 항상 큰 ID -> 작은 ID 이동이므로, 작은 ID 순서대로 처리하면...
            # 예: 2제거. 3->2, 4->3.
            # 3->2 처리 시 2는 이미 삭제됨(removed). OK.
            # 4->3 처리 시 3은 이미 '2'로 갔음. OK.
            # 따라서 작은 new_id 순서대로 처리하면 됨.
            
            sorted_mapping = sorted(id_mapping.items(), key=lambda x: x[1]) # new_id 오름차순
            
            for old_id, new_id in sorted_mapping:
                old_f_path = frames_dir / video_id / str(old_id)
                new_f_path = frames_dir / video_id / str(new_id)
                
                if old_f_path.exists():
                    if new_f_path.exists():
                        print(f"    ⚠️ Conflict: {new_f_path} already exists. Skipping move {old_id}->{new_id}")
                    else:
                        try:
                            old_f_path.rename(new_f_path)
                            print(f"    📂 Moved Frames: {old_id} -> {new_id}")
                        except Exception as e:
                            print(f"    ❌ Move failed: {e}")

                # Thumbnail 처리
                # 파일명: {video_id}-{old_id}.ext
                # glob으로 찾기
                for t_file in thumb_dir.glob(f"{video_id}-{old_id}.*"):
                    ext = t_file.suffix
                    new_t_name = f"{video_id}-{new_id}{ext}"
                    new_t_path = thumb_dir / new_t_name
                    try:
                        t_file.rename(new_t_path)
                        # print(f"    🖼️ Renamed Thumb: {old_id} -> {new_id}")
                    except: pass

if __name__ == "__main__":
    cleanup_channel("tzuyang")
