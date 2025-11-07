import os
from dotenv import load_dotenv
from googleapiclient.discovery import build
import json
from datetime import datetime
import re

# Load environment variables
load_dotenv('../.env')

# YouTube API setup
YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY_BYEON')
youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)

def extract_video_id(url):
    """Extract video ID from YouTube URL."""
    # Patterns for different types of YouTube URLs
    patterns = [
        r'youtube\.com/watch\?v=([^&]+)',  # Standard watch URL
        r'youtu\.be/([^?]+)',              # Shortened URL
        r'youtube\.com/embed/([^?]+)',      # Embed URL
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def get_video_info(video_id):
    """Get video information using YouTube Data API."""
    try:
        request = youtube.videos().list(
            part="snippet",
            id=video_id
        )
        response = request.execute()

        if not response['items']:
            return None

        video_data = response['items'][0]['snippet']
        return {
            'title': video_data['title'],
            'publishedAt': video_data['publishedAt']
        }
    except Exception as e:
        print(f"Error fetching data for video {video_id}: {str(e)}")
        return None

def process_jsonl_file(input_file, output_file):
    """Process the JSONL file and add YouTube metadata."""
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    updated_records = []
    for line in lines:
        record = json.loads(line.strip())
        if 'youtube_link' in record and record['youtube_link']:
            video_id = extract_video_id(record['youtube_link'])
            if video_id:
                video_info = get_video_info(video_id)
                if video_info:
                    record['youtube_meta'] = video_info
        updated_records.append(record)

    # Write updated records to a new file
    with open(output_file, 'w', encoding='utf-8') as f:
        for record in updated_records:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')

if __name__ == "__main__":
    input_file = "../tzuyang_restaurant_results.jsonl"
    output_file = "../tzuyang_restaurant_results_with_meta.jsonl"
    
    if not YOUTUBE_API_KEY:
        print("Error: YOUTUBE_API_KEY not found in environment variables")
        exit(1)
    
    process_jsonl_file(input_file, output_file)
    print("Processing completed. Results saved to:", output_file)
