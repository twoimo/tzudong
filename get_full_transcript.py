from youtube_transcript_api import YouTubeTranscriptApi

def get_transcript(video_id):
    try:
        # Get the transcript
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko'])
        # Print all lines with timestamps
        for item in transcript_list:
            start = int(item['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {item['text']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import sys
    video_id = sys.argv[1] if len(sys.argv) > 1 else "rQsuysaJMsg"
    get_transcript(video_id)
