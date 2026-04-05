from youtube_transcript_api import YouTubeTranscriptApi
import sys

def main():
    video_id = "ZNg4ydyfUqY"
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko'])
        for entry in transcript:
            start = int(entry['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {entry['text']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == '__main__':
    main()
