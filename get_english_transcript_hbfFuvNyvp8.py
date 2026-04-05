from youtube_transcript_api import YouTubeTranscriptApi

video_id = 'hbfFuvNyvp8'

def format_timestamp(seconds):
    minutes = int(seconds // 60)
    seconds_rem = int(seconds % 60)
    return f"[{minutes:02d}:{seconds_rem:02d}]"

try:
    # Try to get English transcript directly
    transcript_data = YouTubeTranscriptApi.get_transcript(video_id, languages=['en'])
    
    for entry in transcript_data:
        timestamp = format_timestamp(entry['start'])
        print(f"{timestamp} {entry['text']}")

except Exception as e:
    print(f"An error occurred: {e}")
    # Try to see what's available
    try:
        # Based on the dir output, it has 'list' and 'fetch'
        # Let's see if we can get anything
        print("Trying to list all available transcripts...")
        # Actually, in youtube-transcript-api, there's a list_transcripts method but it's not in the dir() of the class?
        # Maybe it's a module level function or I need to instantiate something?
        # Let's try to get any transcript if English is not available
        transcript_data = YouTubeTranscriptApi.get_transcript(video_id)
        for entry in transcript_data:
            timestamp = format_timestamp(entry['start'])
            print(f"{timestamp} {entry['text']}")
    except Exception as e2:
        print(f"Could not get any transcript: {e2}")
