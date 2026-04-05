from youtube_transcript_api import YouTubeTranscriptApi
import sys

def get_transcript(video_id):
    try:
        t_list = YouTubeTranscriptApi.list_transcripts(video_id)
        # Try to find 'ko'
        try:
            transcript = t_list.find_transcript(['ko']).fetch()
        except:
            # Try to get the first available one
            transcript = next(iter(t_list)).fetch()

        for item in transcript:
            start = int(item['start'])
            minutes = start // 60
            seconds = start % 60
            print(f"[{minutes:02d}:{seconds:02d}] {item['text']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    v_id = sys.argv[1] if len(sys.argv) > 1 else "rQsuysaJMsg"
    get_transcript(v_id)
