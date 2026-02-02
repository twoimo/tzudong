## Daily Crawling Report (2026-02-03)

### Process Statistics
| Step | Count | Status |
|------|-------|--------|
| Step | Count | Status |
|------|-------|--------|
| URLs | 신규 0개 / 삭제 0개 / 전체 1017개 | Collected |
| Metadata | 37 | Updated |
| Transcripts | 0 | Skipped |
| Contexts | 0 | Skipped |
| Heatmaps | 0 | Skipped |
| Frames | 0 | Extracted |
| GDrive Cache | 0 | Hits |
| YouTube DL | 0 | (Blocked) |
| Gemini Analysis | - | Skipped |
| Target Selection | 836 | Selected |
| Rule Eval | 751 | Verified |
| LAAJ Eval |  | Verified |
| DB Insert | - | Skipped |

### Details
<details><summary>Click to expand execution details</summary>

**New URLs (신규 0개 / 삭제 0개 / 전체 1017개)**

**📝 Metadata Updates (37)**
- 2if2TjgSVEY - 음료 7.0L 다먹기 가능..?🤔 카페에서 파는 어묵탕...
- dQ5FochDJEw - 조회수 750만을 기록한 네모난 소고기 맛집?!😳 깍뚝...
- v7U03TXG9oc - 이스탄불7탄) 길거리음식 하루종일 얼마나 먹을수 있을까...
- V__oVpfMi8I - 이스탄불3탄) 여자기록 160개! 남자기록 XXX개⁉️...
- sO8qdAuBAQs - 대구5) 사장님이 죽는날까지 짜장면은 3천원 이래요🥺 ...
- 6FJ1Xo1fu2k - 발리4탄) 발리에서 가장 아름다운 편의점에 가봤습니다🤔...
- 00S1J_3uC0U - 사장님이 다먹으면 평생무료라고 하셔서..🥺 밥10인분 ...
- UUwpPowvgSM - 노래방에서 김경호님이 불러주시는 금지된사랑 들으며 금지...
- BdmMYL3WJ2M - 방콕 회전 샤브샤브 120접시...? 😲 #shorts...
- RPIdUNqytys - 굴 13kg 다 먹을수 있을까..?🤔 외국인이 부러워하...
- HsxX7VMM718 - 연예인맛집에 갔더니 진짜 잘생긴 배우분을 만났습니다😳 ...
- 3Zyb_DU2jFg - 처음으로 먹방유튜버와 대결했습니다🔥🔥 신길동 매운짬뽕 ...
- z0TENHkJmzA - 팔뚝만한 김밥에 곱빼기가 무료?!🫢 가성비 갑이라는 왕...
- liIJBuuJV9k - 베트남 손님이 보고 놀라셨어요🤣 길동 빨간어묵 먹방...
- 4X078jlC35k - 하루매출 최대 1000만원 이라는 경쟁업체 돈까스집 사...
- IYJ9NDTHOPs - 🔥겁나매운 최루탄라면과 매운 닭꼬치🔥 남영동 소소라면 ...
- iBMCHcQRT2M - 사장님이 음료는 서비스라고 했다가 대참사..🤣 무한리필...
- hSvMwl4RaxE - 🔥쯔양 vs 이강인 김민경 이정은🔥 삼겹살 6kg 3대...
- iM8M-iaM1zw - 만두로 탑쌓았습니다🔥 웨스턴차이나 딤섬 XX접시 먹방...
- 6CA09WTaQM0 - 2년만에 재방문했더니 사장님이..🤣 3번째 방문! 포장...
- ... (Total 37 items)

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
