import sys
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id):
    try:
        # Correct way to use the library based on dir() output
        transcript_list = YouTubeTranscriptApi.list(video_id)
        transcript = transcript_list.find_transcript(['ko']).fetch()
        for item in transcript:
            start = int(item['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {item['text']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    video_id = sys.argv[1] if len(sys.argv) > 1 else "rQsuysaJMsg"
    get_transcript(video_id)
