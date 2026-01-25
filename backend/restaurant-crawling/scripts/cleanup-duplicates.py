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
    
    if not meta_dir.exists():
        print("Meta directory not found.")
        return

    for meta_file in meta_dir.glob("*.jsonl"):
        video_id = meta_file.stem
        records = load_jsonl(meta_file)
        
        if not records:
            continue
            
        # 중복 감지 로직
        # 같은 날짜(KST 기준)에 'scheduled_weekly' 등으로 수집된 레코드가 여러 개 있는지 확인
        # 또는 단순히 timestamp 차이가 매우 적은 경우 (1시간 이내?)
        
        unique_records = []
        last_kept_record = None
        removed_ids = []
        
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
                
                # 조건: 같은 날짜 AND 같은 recollect_vars (또는 scheduled_weekly 포함)
                # 문제 사례: ID 4 (scheduled_weekly), ID 5 (scheduled_weekly) - 13분 차이
                
                is_same_day = curr_dt.date() == prev_dt.date()
                curr_vars = record.get("recollect_vars", [])
                
                # 중복 조건:
                # 1. 같은 날짜에 'scheduled_weekly'가 중복 발생
                # 2. 또는 수집 간격이 너무 짧음 (< 1시간) (Viral 제외)
                
                is_duplicate = False
                if is_same_day:
                    if "scheduled_weekly" in curr_vars and "scheduled_weekly" in last_kept_record.get("recollect_vars", []):
                        is_duplicate = True
                        print(f"  [Meta Check] Duplicate Weekly found for {video_id}: ID {record.get('recollect_id')} (Time: {curr_dt.strftime('%H:%M:%S')}) vs ID {last_kept_record.get('recollect_id')} (Time: {prev_dt.strftime('%H:%M:%S')})")
                    elif (curr_dt - prev_dt).total_seconds() < 3600: # 1시간 이내 재수집
                        # 단, viral_growth나 new_video 등 특수 사유가 있으면 허용할 수도 있음
                        # 하지만 여기서는 '잘못 연달아 수집된' 케이스를 잡는 것이므로 제거 대상
                        if "viral_growth" not in curr_vars and "new_video" not in curr_vars:
                             is_duplicate = True
                             print(f"  [Meta Check] Rapid re-collection found for {video_id}: ID {record.get('recollect_id')} (+{(curr_dt - prev_dt).total_seconds()/60:.1f} min)")

                if is_duplicate:
                    removed_ids.append(record.get('recollect_id'))
                    print(f"  -> Marking ID {record.get('recollect_id')} for REMOVAL")
                    # last_kept_record는 업데이트하지 않음 (이전 것이 유효하다고 가정)
                    # 만약 '최신'을 남기고 '이전'을 지워야 한다면 로직이 복잡해짐 (이미 리스트에 들어갔으므로)
                    # 보통 나중 것이 중복이므로 제거
                else:
                    unique_records.append(record)
                    last_kept_record = record
                    
            except Exception as e:
                # 파싱 에러 시 일단 유지
                unique_records.append(record)
                last_kept_record = record

        # 변경사항 적용
        if removed_ids:
            print(f"  💾 Updating Meta: {video_id} (Removed IDs: {removed_ids})")
            save_jsonl(meta_file, unique_records)
            
            # Heatmap 정리
            heatmap_file = heatmap_dir / f"{video_id}.jsonl"
            if heatmap_file.exists():
                heatmaps = load_jsonl(heatmap_file)
                new_heatmaps = [h for h in heatmaps if h.get('recollect_id') not in removed_ids]
                if len(heatmaps) != len(new_heatmaps):
                     print(f"  💾 Updating Heatmap: {video_id} (Removed {len(heatmaps)-len(new_heatmaps)} records)")
                     save_jsonl(heatmap_file, new_heatmaps)
            
            # Frames 폴더 정리
            for rid in removed_ids:
                if rid is None: continue
                # rid가 정수일 수도 있고 문자열일 수도 있음
                frame_path = frames_dir / video_id / str(rid)
                if frame_path.exists():
                    print(f"  🗑️ Deleting Frame Dir: {frame_path}")
                    try:
                        shutil.rmtree(frame_path)
                    except Exception as e:
                        print(f"    Error deleting frames: {e}")

if __name__ == "__main__":
    cleanup_channel("tzuyang")
