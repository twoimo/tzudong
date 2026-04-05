from youtube_transcript_api import YouTubeTranscriptApi
import sys

def get_transcript(video_id):
    try:
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['ko', 'en'])
        for entry in transcript_list:
            print(f"[{entry['start']:.2f}] {entry['text']}")
    except Exception as e:
        print(f"Error fetching transcript: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        get_transcript(sys.argv[1])
