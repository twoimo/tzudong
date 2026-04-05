import youtube_transcript_api
from youtube_transcript_api import YouTubeTranscriptApi

print(f"youtube_transcript_api file: {youtube_transcript_api.__file__}")
print(f"YouTubeTranscriptApi: {YouTubeTranscriptApi}")
print(f"dir(YouTubeTranscriptApi): {dir(YouTubeTranscriptApi)}")

try:
    # Try the most common one
    print("Trying get_transcript...")
    print(YouTubeTranscriptApi.get_transcript("g-bz7LdNkiU"))
except Exception as e:
    print(f"get_transcript failed: {e}")

try:
    print("Trying list_transcripts...")
    print(YouTubeTranscriptApi.list_transcripts("g-bz7LdNkiU"))
except Exception as e:
    print(f"list_transcripts failed: {e}")
