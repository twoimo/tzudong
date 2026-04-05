import sys
from youtube_transcript_api import YouTubeTranscriptApi

def get_full_info(video_id):
    try:
        # Standard approach
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko', 'en'])
        for item in transcript_list:
            start = int(item['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {item['text']}")
    except Exception as e:
        print(f"Error fetching transcript: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        get_full_info(sys.argv[1])
    else:
        get_full_info("hbfFuvNyvp8")
