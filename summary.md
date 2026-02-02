## Daily Crawling Report (2026-02-02)

### Process Statistics
| Step | Count | Status |
|------|-------|--------|
| Step | Count | Status |
|------|-------|--------|
| URLs | 신규 0개 / 삭제 0개 / 전체 1017개 | Collected |
| Metadata | 38 | Updated |
| Transcripts | 0 | Skipped |
| Contexts | 0 | Skipped |
| Heatmaps | 0 | Skipped |
| Frames | 0 | Extracted |
| GDrive Cache | 0 | Hits |
| YouTube DL | 0 | (Blocked) |
| Gemini Analysis | - | Skipped |
| Target Selection | 836 | Selected |
| Rule Eval | 749 | Verified |
| LAAJ Eval |  | Verified |
| DB Insert | - | Skipped |

### Details
<details><summary>Click to expand execution details</summary>

**New URLs (신규 0개 / 삭제 0개 / 전체 1017개)**

**📝 Metadata Updates (38)**
- SbjywgoDGF4 - 미국 3대장 샌드위치?!😳 외국인도 한개 밖에 못먹는대...
- cGhoGXfAVS4 - 대전 시장 길거리음식 다 털었습니다🔥 떡볶이 칼국수 어...
- N1BF4F4cz9o - 오늘은 안먹어요...
- x8EdsDzKuQk - 시드니5탄) 다먹는거 못믿고 지켜본다길래 보여드렸습니다...
- swV9d6MDgJk - 37년 전통 라면가게에서 라면 10그릇 먹었더니 사람들...
- WjoktAzYqG4 - 초대왕 솥뚜껑에 김치볶음밥 10인분?!😳 황금레시피로 ...
- GBRoyvoSfAY - 부다페스트1탄) 이거 먹으러 헝가리 갔습니다..😂 2k...
- d8pEUU8djhI - 백반 먹으러 ktx타고 2시간 달렸습니다🔥 문경 삼겹살...
- fFSyYTu6y70 - 이거 먹으러 새벽 6시에 찾아갔습니다🥺 옆손님이 대결신...
- Eru0qdlHTAU - 독도새우 100마리...?!🦐 #shorts #mukb...
- _-F6tqh9pLw - 방콕5탄) 태국 편의점 다 털었더니 직원분이..🤣 태국...
- RFudEbfL2TU - 제 인생 비빔면과 군만두입니다🥹...
- g0-ZWjMcpbk - 한국 대식가를 본 미국 본토의 찐 반응🤣 #shorts...
- -WxGII56e8g - 이해할 수 없는 인도네시아 포차😵 #shorts #in...
- Tiw7_yiBiX8 - 먹고 응급실 간 손님도 있다는 매운냉면?!🔥눈물 콧물 ...
- 0FACIBa9Jfg - 할머님들께 단체로 박수받았습니다🤣 짜장면이 무료라고 해...
- e8IACC60ADc - 버블티 7L 먹을 수 있을까?🤔 줄서서 먹는 아마스빈 ...
- iRcaePXQRto - 다먹었더니 용돈을 받았습니다..?😳 종로 57년 전통 ...
- m_NAMq7X3fI - 배부를때까지 주신다길래 맘껏 먹었더니..🤣 이장우님과 ...
- QvqRsI7-3Wc - 사장님이 이렇게 먹으면 혼난대요😂 30년 전통 솥뚜껑 ...
- ... (Total 38 items)

</details>

### ✅ All Systems Go!
모든 영상이 정상적으로 처리되었습니다.


### 🏗️ Pipeline Architecture
```wmgraph
+-------------------------------------------------------------------------------------------------------+
|                                  🚀 TZUDONG DETAILED PIPELINE FLOW                                    |
+-------------------------------------------------------------------------------------------------------+
|                                                                                                       |
|  [GitHub Actions] --> [Step 0: Sync] <--(Fetch)-- [Data Branch]                                       |
|                             |                                                                         |
|                             v                                                                         |
|  [Step 1: URLs] --> [Step 2: Meta] --> [Step 2.5: Cleanup] ==(Save)==> [Commit]                       |
|                             | (Scheduled)                                                             |
|                             v                                                                         |
|  [Step 3: Transcript] --> [Step 3.1: Context] ==(Save)==> [Commit]                                    |
|                             |                                                                         |
|                             v                                                                         |
|  [Step 4: Frames/Heatmap] ==(Save)==> [Commit]                                                        |
|                             |                                                                         |
|                             v                                                                         |
|  [Step 6: Gemini Analysis] --> [Step 6.1/6.2: Meta Enrichment]                                        |
|                             |                                                                         |
|                             v                                                                         |
|                             v                                                                         |
|  [Step 08: Target Selection] --> [Step 09: Rule Eval] --> [Step 10: LAAJ Eval]                        |
|                             |                                                                         |
|                             v                                                                         |
|  [Step 11: Transform] --> [Step 12: Supabase Insert] --> [Step 7: Final Sync] ==(Push)==> [Remote]    |
|                                                                                                       |
+-------------------------------------------------------------------------------------------------------+
```
