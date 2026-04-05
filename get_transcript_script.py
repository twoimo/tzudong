from youtube_transcript_api import YouTubeTranscriptApi
import json

video_id = "fnJr_CsQOKE"
try:
    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
    # Try Korean first, then English, then others
    try:
        transcript = transcript_list.find_transcript(['ko']).fetch()
    except:
        try:
            transcript = transcript_list.find_transcript(['en']).fetch()
        except:
            transcript = transcript_list.find_generated_transcript(['ko', 'en']).fetch()
    
    for entry in transcript:
        print(f"[{int(entry['start'] // 60):02d}:{int(entry['start'] % 60):02d}] {entry['text']}")
except Exception as e:
    print(f"Error: {e}")
