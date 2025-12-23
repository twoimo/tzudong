/**
 * YouTube Video Retention Analysis Script
 * 
 * This script demonstrates how to analyze YouTube video retention using Gemini.
 * It takes video metadata and retention highlights as input and generates a deep analysis JSON.
 * 
 * Usage:
 *   node scripts/analyze-retention.js <VIDEO_ID>
 * 
 * Prerequisites:
 *   - GOOGLE_API_KEY environment variable set (for Gemini)
 *   - YouTube Data API Key (if fetching real transcript)
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Configuration
const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL_NAME = "gemini-1.5-pro-latest"; // Using Pro for better reasoning context

// Mock Input (In a real scenario, this would come from DB or YouTube API)
// This simulates the data we have for 'abc123' in the HeatmapSection mock
const TARGET_VIDEO = {
    videoId: 'abc123',
    title: '[쯔양] 서울 최고의 삼겹살 맛집 탐방기',
    peakSegment: { start: 42, end: 58 },
    lowestSegment: { start: 85, end: 100 },
    // Simplified Mock Transcript centered around the segments
    transcriptSegments: [
        { start: 0, end: 60, text: "안녕하세요 쯔양입니다. 오늘은 서울의 삼겹살 맛집에 왔습니다. (입장 및 주문)" },
        { start: 420, end: 580, text: "(지글지글 고기 굽는 소리) 와 소리 들리시나요? 육즙이 정말 장난 아닙니다. 자 이제 한 입에 다 넣어보겠습니다. (ASMR 쩝쩝)" }, // 42% ~ 58% approx
        { start: 850, end: 1000, text: "아 너무 맛있게 잘 먹었습니다. 다음에는 어디로 갈까요? 주저리주저리... (이동 중) (검은 화면)" } // 85% ~ 100% approx
    ]
};

async function analyzeRetention(videoData) {
    if (!API_KEY) {
        console.error("Error: GOOGLE_API_KEY is missing in .env");
        process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    console.log(`Analyzing video: ${videoData.title}...`);

    const prompt = `
You are an expert YouTube content analyst. Your goal is to explain WHY viewers were most engaged or least engaged at specific parts of a video.

**Video Metadata:**
- Title: ${videoData.title}

**Retention Data:**
1. PEAK SEGMENT (Highest Retention): ${videoData.peakSegment.start}% to ${videoData.peakSegment.end}% of the video.
   Transcript/Event Context: "${videoData.transcriptSegments[1].text}"
   
2. LOWEST SEGMENT (Lowest Retention/Drop-off): ${videoData.lowestSegment.start}% to ${videoData.lowestSegment.end}% of the video.
   Transcript/Event Context: "${videoData.transcriptSegments[2].text}"

**Task:**
Analyze the transcript context and video metadata to determine the likely reasons for high and low engagement.
Output the result in strict JSON format with the following schema:

{
  "peakReason": "One sentence explaining why this was the most watched part.",
  "lowestReason": "One sentence explaining why viewers dropped off here.",
  "overallSummary": "Two sentences summarizing the retention strategy for this video.",
  "keywords": ["Keyword1", "Keyword2", "Keyword3", "Keyword4"]
}

Response MUST be in Korean (한국어).
`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // Clean markdown code blocks if present
        const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(jsonString);

        console.log("\n--- Analysis Result ---");
        console.log(JSON.stringify(analysis, null, 2));

        return analysis;
    } catch (error) {
        console.error("Analysis failed:", error);
    }
}

// Execute
analyzeRetention(TARGET_VIDEO);
