import sys
from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id):
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko'])
        for item in transcript_list:
            start = int(item['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {item['text']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    get_transcript("g-bz7LdNkiU")
