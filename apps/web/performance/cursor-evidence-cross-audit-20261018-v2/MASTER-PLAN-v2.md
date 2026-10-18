# Tzudong 9228 권한·모바일 자원·배포 근거 반대 감사

이 문서는 Gemini4 Argon 최고가 + Deep Research 반대 감사의 단일 canonical plan이다. source18개 SHA256 7bb1e2b658c3781078f0eef5b61494bd494d72c8e29a20abf8f4408045655203 및 revision9228/tree d0cee44ace30d3a337b0fd8077032ed099cfb567는 첫 감사와 동일하다. 인증·개인정보·좌표·원본 사용자 응답은 전송하지 않는다. 원본 plan-v1은 역사적 배포 전 snapshot으로 보존돼 있다.

현재 source #3319, develop→data #3320, data→main #3321의 exact-head CI는 모두 완료/실패0/미해결리뷰0이다. main b4eb780c532c9ba02a1af456b17459debc59a757의 tree는 후보와 동일하고 READY production dpl_5MdWf1WjdpgsTGWzo7SV97u7nFcn 및 www/root health와 일치한다. 아래 JSON은 익명 공개 기능/자산 readback과 합성 fixture의 정제 원시 기록이다. 이 자료가 full trace/HAR/물리/field evidence를 대신하지 않는다.

ADR-01/W001: 저장된 binary64 deadline fl(grantedAt+300000)의 half-open 구간, WeakMap 원본 identity, finite/safe timestamps와 명시 철회·만료 관찰 후 replay 차단을 보존한다. 실수론적으로 정확한300000ms나 임의 clock 역행 자체 탐지는 주장하지 않는다. conforming captured performance.now()를 trusted primitive로 두는 것이 합리적인지 반대 검토하라. 새 요구/epsilon/권한 확대 없이 결정하라.

ADR-02/W002: unknown/intermediate mobile/touch memory에서 optional3D caller를 static으로 보내 dynamic viewer mount를 피한다. default experimental3D=false, unpublished cohort/entries0은 유지한다. synthetic navigator/softwareGL의 local instrumentation만 존재하며 실사용 memory/FPS/latency/field gain은 입증되지 않았다. 6 threshold는 coarse API signal이며 물리6GiB detector가 아니다. powerful unsupported-API iPhone static trade-off와 global OS→model 한계가 남는다. session helper/실제 home caller 등은원래9-source에서 빠졌던 session/site-config/home/readiness와 Naver의 명시된 location 범위를 추가했다. renderer 나머지/전체 dependency graph·실제 SDK concurrency를 인증하지 마라.

ADR-03/W003: source→CI→protected main→READY/gitSourceSHA→alias→실제URL의 증거와 functional/mocked/physical/field 증거의 강도를 구별하라. strict restored-marker failure는 원래 before와 최종 after에서 남는다. diagnostic detail/close3/3은 strict fail을 대체하지 않는다. CSP/401도 남는다. hash map/remote packet sealing은 별도 실행이며 이 연구 입력에는 완료가 추정되지 않는다.

찬사·통과모듈 요약을 제외하고 첫 ChatGPT 보고서의 수학·threat model·코드/성능 주장·제안 diff를 반박하라. 결함별 formal derivation, evidence7등급, W/ADR ID, executable reproduction 또는 unified diff, severity와 ACCEPT/CONDITIONAL/REJECT/DEFER를 제공하라. 시험을 실제 실행했다고 지어내거나 과거 운영자료를 새 후보의 증거로 재라벨하지 마라. 보안·기존 디자인·접근성·도장/리뷰/지도 기능을 보존한다. 연구 보고서는 외부 변경 권한이 아니다.

## 정제된 저장 증거

### delivery-final-readback-v1.json

```json
{
  "observedAt": "2026-10-18T11:33:38.924242+00:00",
  "mainSha": "b4eb780c532c9ba02a1af456b17459debc59a757",
  "sourceCandidate": "9228c1454393560bcd37240f793065e450f85683",
  "sourceTree": "d0cee44ace30d3a337b0fd8077032ed099cfb567",
  "deploymentId": "dpl_5MdWf1WjdpgsTGWzo7SV97u7nFcn",
  "deploymentUrl": "tzudong-gfa0qdb3c-twoimos-projects.vercel.app",
  "projectId": "prj_sau35J5uUtShIQ9OKofRtOVVnTSl",
  "primaryPassed": true,
  "publicViewportFunctionalChecks": 15,
  "pageErrors": 0,
  "publicAssetsEqual": 4,
  "newCriticalRegressionObserved": false,
  "allErrorsFixedClaimed": false,
  "knownStrictHistory": {
    "passed": false,
    "stage": "restored-marker",
    "baselineSameFailure": true
  },
  "diagnosticStatus": "passed",
  "physicalOrFieldPerformanceClaimed": false,
  "rollbackPerformed": false,
  "noDbStorageDnsPhoneChanges": true
}
```

### location-main-final-ci-v1.json

```json
{
  "baseRefName": "main",
  "baseRefOid": "2e5630fada4cd50fb71ff7542723ca6393afe7c0",
  "headRefOid": "8b24f0c4560b9b8b0d1f4f7a3cf264b409b7dc20",
  "mergeCommit": {
    "oid": "b4eb780c532c9ba02a1af456b17459debc59a757"
  },
  "mergeStateStatus": "UNKNOWN",
  "mergedAt": "2026-10-18T11:22:02Z",
  "number": 3321,
  "state": "MERGED",
  "url": "https://github.com/twoimo/tzudong/pull/3321",
  "checks": [
    {
      "name": "Install",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345341"
    },
    {
      "name": "Install",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332913"
    },
    {
      "name": "Analyze (actions)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334320"
    },
    {
      "name": "Analyze (actions)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341302"
    },
    {
      "name": "Promotion Path",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013639/job/117659346637"
    },
    {
      "name": "Release",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013385/job/117659345243"
    },
    {
      "name": "Release",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008711/job/117659332626"
    },
    {
      "name": "Analyze (go)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334287"
    },
    {
      "name": "Analyze (go)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341465"
    },
    {
      "name": "Analyze (javascript-typescript)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334249"
    },
    {
      "name": "Analyze (javascript-typescript)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341474"
    },
    {
      "name": "Analyze (python)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334238"
    },
    {
      "name": "Analyze (python)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341439"
    },
    {
      "name": "Analyze (rust)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334317"
    },
    {
      "name": "Analyze (rust)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341475"
    },
    {
      "name": "Analyze (swift)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008168/job/117659334091"
    },
    {
      "name": "Analyze (swift)",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122011238/job/117659341435"
    },
    {
      "name": "Ubuntu npm",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345339"
    },
    {
      "name": "Ubuntu npm",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332800"
    },
    {
      "name": "Ubuntu Bun",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345364"
    },
    {
      "name": "Ubuntu Bun",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332741"
    },
    {
      "name": "Windows npm",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345374"
    },
    {
      "name": "Windows npm",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332830"
    },
    {
      "name": "Windows Bun",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345168"
    },
    {
      "name": "Windows Bun",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332827"
    },
    {
      "name": "Admin",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122013392/job/117659345367"
    },
    {
      "name": "Admin",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/actions/runs/39122008692/job/117659332834"
    },
    {
      "name": "CodeQL",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/twoimo/tzudong/runs/117659470611"
    },
    {
      "name": "GitGuardian Security Checks",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://dashboard.gitguardian.com"
    }
  ],
  "counts": {
    "SUCCESS": 29
  },
  "unresolved": [],
  "pending": [],
  "failed": [],
  "requiredChecks": [
    {
      "bucket": "pass",
      "link": "https://github.com/twoimo/tzudong/actions/runs/39122013639/job/117659346637",
      "name": "Promotion Path",
      "state": "SUCCESS"
    },
    {
      "bucket": "pass",
      "link": "https://github.com/twoimo/tzudong/actions/runs/39122013385/job/117659345243",
      "name": "Release",
      "state": "SUCCESS"
    },
    {
      "bucket": "pass",
      "link": "https://github.com/twoimo/tzudong/actions/runs/39122008711/job/117659332626",
      "name": "Release",
      "state": "SUCCESS"
    }
  ],
  "requiredCommandExitCode": 0,
  "requiredSuccess": true,
  "allChecksCompleted": true,
  "observedAt": "2026-10-18T11:25:16.029994+00:00"
}
```

### production-verification-receipt-v2.json

```json
{
  "gitSha": "b4eb780c532c9ba02a1af456b17459debc59a757",
  "scope": "anonymous production functional/asset/CSP verification, no account or database writes; not field/device/performance proof",
  "runs": [
    {
      "script": "run-live-readback-v4.mjs",
      "startedAt": "2026-10-18T11:30:29.198546+00:00",
      "completedAt": "2026-10-18T11:30:49.861696+00:00",
      "exitCode": 0
    },
    {
      "script": "run-public-assets-readback-v2.mjs",
      "startedAt": "2026-10-18T11:30:49.861742+00:00",
      "completedAt": "2026-10-18T11:30:50.715901+00:00",
      "exitCode": 0
    },
    {
      "script": "run-console-boundary-diagnosis-v3.mjs",
      "startedAt": "2026-10-18T11:30:50.715943+00:00",
      "completedAt": "2026-10-18T11:30:59.989126+00:00",
      "exitCode": 0
    }
  ],
  "assetEquality": [
    {
      "path": "apps/web/public/assets/badges/badge_popular_fire_40.webp",
      "gitBytes": 2410,
      "liveBytes": 2410,
      "gitSha256": "77cf5b90c7823b16ef2f11f3f1d30a4f5c45f38c662e7604848950cba7e4170d",
      "liveSha256": "77cf5b90c7823b16ef2f11f3f1d30a4f5c45f38c662e7604848950cba7e4170d",
      "equal": true
    },
    {
      "path": "apps/web/public/assets/badges/badge_popular_fire_80.webp",
      "gitBytes": 7618,
      "liveBytes": 7618,
      "gitSha256": "36fca709dc18574f138ae5beeec9cec72c01030c003dc8652a809d593fc9aa65",
      "liveSha256": "36fca709dc18574f138ae5beeec9cec72c01030c003dc8652a809d593fc9aa65",
      "equal": true
    },
    {
      "path": "apps/web/public/assets/badges/badge_popular_rainbow_40.webp",
      "gitBytes": 2718,
      "liveBytes": 2718,
      "gitSha256": "9aa8bd618b2a1f77c6a0d8783c339ad16e46d56f65856a7c4966bb5ab0cf770d",
      "liveSha256": "9aa8bd618b2a1f77c6a0d8783c339ad16e46d56f65856a7c4966bb5ab0cf770d",
      "equal": true
    },
    {
      "path": "apps/web/public/assets/badges/badge_popular_rainbow_80.webp",
      "gitBytes": 8766,
      "liveBytes": 8766,
      "gitSha256": "92cc370f652e2d9e530c11b15bd54526e49afe0bf838773b52b6ff4afffd51b3",
      "liveSha256": "92cc370f652e2d9e530c11b15bd54526e49afe0bf838773b52b6ff4afffd51b3",
      "equal": true
    }
  ],
  "passed": true
}
```

### badge-mobile-comparison-v1.json

```json
{
  "scope": "actual production React component, synthetic navigator inputs, software GL; baseline4696; no physical/field/memory/timing claim",
  "independentProcessesPerPhase": 1,
  "independentContextsPerPhase": 10,
  "dependentOpensPerContext": 3,
  "observations": [
    {
      "profile": "desktop-high",
      "contextsBefore": 3,
      "contextsAfter": 3,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 1,
      "rafBefore": [
        13,
        14,
        13
      ],
      "rafAfter": [
        13,
        14,
        14
      ]
    },
    {
      "profile": "desktop-reduced",
      "contextsBefore": 3,
      "contextsAfter": 3,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 1,
      "rafBefore": [
        0,
        0,
        0
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "generic-ios17-cores6",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        14,
        14,
        14
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "generic-ios17-cores8",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        14,
        14,
        14
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "generic-ios18-cores6",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        13,
        14,
        14
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "generic-ios18-cores8",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        14,
        13,
        14
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "desktop-ua-touch-unknown",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        13,
        14,
        14
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "android-high",
      "contextsBefore": 3,
      "contextsAfter": 3,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 1,
      "rafBefore": [
        13,
        14,
        14
      ],
      "rafAfter": [
        14,
        14,
        14
      ]
    },
    {
      "profile": "android-model-high-memory4",
      "contextsBefore": 3,
      "contextsAfter": 0,
      "additionalScriptsBefore": 1,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        13,
        14,
        13
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    },
    {
      "profile": "low-memory",
      "contextsBefore": 0,
      "contextsAfter": 0,
      "additionalScriptsBefore": 0,
      "additionalScriptsAfter": 0,
      "rafBefore": [
        0,
        0,
        0
      ],
      "rafAfter": [
        0,
        0,
        0
      ]
    }
  ],
  "tradeoff": "Unknown or mid-memory mobile/touch devices, including powerful iPhones with no deviceMemory API, receive static optional preview. Default public cohort empty. Existing global map tier/presets unchanged.",
  "source": "https://www.w3.org/TR/device-memory/",
  "sourceStatus": "Working Draft 2026-03-30, rounded bounded values; unknown handling is application policy"
}
```

### location-precision-browser-comparison-v1.json

```json
{
  "sourceBefore": "2e5630fada4cd50fb71ff7542723ca6393afe7c0",
  "sourceAfter": "9228c1454393560bcd37240f793065e450f85683",
  "browser": "153.0.8010.12",
  "independentBrowserProcessesPerPhase": 1,
  "freshContextsPerPhase": 4,
  "scope": "actual compiled capability API, synthetic clock and readiness, no device permission/location/account data; fixture UI not whole app; no latency or performance benefit claim",
  "rows": [
    {
      "syntheticTime": 1000,
      "beforeSuccessfulMints": 3,
      "afterSuccessfulMints": 3,
      "dependentAttempts": 3,
      "afterBoundaries": [
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        }
      ]
    },
    {
      "syntheticTime": 262144.02702702704,
      "beforeSuccessfulMints": 0,
      "afterSuccessfulMints": 3,
      "dependentAttempts": 3,
      "afterBoundaries": [
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        }
      ]
    },
    {
      "syntheticTime": 262144.1081081081,
      "beforeSuccessfulMints": 0,
      "afterSuccessfulMints": 3,
      "dependentAttempts": 3,
      "afterBoundaries": [
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        }
      ]
    },
    {
      "syntheticTime": 262144.1621621622,
      "beforeSuccessfulMints": 0,
      "afterSuccessfulMints": 3,
      "dependentAttempts": 3,
      "afterBoundaries": [
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        },
        {
          "justBefore": true,
          "at": false,
          "rewind": false
        }
      ]
    }
  ],
  "pixelsInspected": [
    "location-precision-browser-v2/before-fractional-1.png",
    "location-precision-browser-v2/after-fractional-1.png"
  ],
  "originalHarnessFailuresRetained": "location-precision-browser-v1",
  "noise": "deterministic success/failure counts only; no populationCI or p95; no relative increase from0 baseline"
}
```

### live-history-after-v3.json

```json
{
  "phase": "after",
  "gitSha": "b4eb780c532c9ba02a1af456b17459debc59a757",
  "deploymentId": "dpl_5MdWf1WjdpgsTGWzo7SV97u7nFcn",
  "browser": "153.0.8010.12",
  "startedAt": "2026-10-18T11:31:43.856Z",
  "scope": "anonymous real SDK full-navigation history restoration; no row bodies, query URLs, account mutations, device/field/performance claim",
  "rows": [],
  "status": "failed",
  "failedStage": "restored-marker",
  "completedAt": "2026-10-18T11:32:20.655Z"
}
```

### live-history-after-v4.json

```json
{
  "phase": "after",
  "gitSha": "b4eb780c532c9ba02a1af456b17459debc59a757",
  "deploymentId": "dpl_5MdWf1WjdpgsTGWzo7SV97u7nFcn",
  "browser": "153.0.8010.12",
  "startedAt": "2026-10-18T11:32:21.441Z",
  "scope": "anonymous real SDK full-navigation detail restoration; exact marker visibility is observational and unproven, not a passing gate; no row bodies, query URLs, account mutations, device/field/performance claim",
  "rows": [
    {
      "viewport": {
        "width": 1440,
        "height": 900
      },
      "clusterOpens": 1,
      "sameRestaurantRestored": true,
      "exactOriginalMarkerVisible": false,
      "exactMarkerCount": 0,
      "markerCount": 0,
      "clusterCount": 16,
      "detailClosed": true
    },
    {
      "viewport": {
        "width": 834,
        "height": 1112
      },
      "clusterOpens": 1,
      "sameRestaurantRestored": true,
      "exactOriginalMarkerVisible": false,
      "exactMarkerCount": 0,
      "markerCount": 0,
      "clusterCount": 16,
      "detailClosed": true
    },
    {
      "viewport": {
        "width": 430,
        "height": 860
      },
      "clusterOpens": 1,
      "sameRestaurantRestored": true,
      "exactOriginalMarkerVisible": false,
      "exactMarkerCount": 0,
      "markerCount": 0,
      "clusterCount": 16,
      "detailClosed": true
    }
  ],
  "status": "passed",
  "completedAt": "2026-10-18T11:32:39.341Z"
}
```

### 로컬 synthetic counterexample 관찰

```json
{
  "source": "9228c1454393560bcd37240f793065e450f85683",
  "scope": "Actual private API in one isolated Bun process; synthetic nonconforming clock and readiness only. No actual location/permission/network/account operation.",
  "steps": [
    {
      "syntheticNow": 1000,
      "allowed": true
    },
    {
      "syntheticNow": 2000,
      "allowed": true
    },
    {
      "syntheticNow": 1500,
      "allowed": true
    },
    {
      "syntheticNow": 301000,
      "allowed": false
    },
    {
      "syntheticNow": 1500,
      "allowed": false
    }
  ],
  "numeric": {
    "grantedAt": 262144.02702702704,
    "storedDeadline": 562144.027027027,
    "subtraction": 299999.99999999994,
    "storedSumEquality": true
  },
  "conclusion": "Intra-window backwards synthetic time is not independently detected. Stored exact deadline rejects and deletes capability; later rewind cannot revive it. Do not claim generic rewind-proof or real-number-exact five minutes.",
  "productChange": false,
  "performanceClaim": false
}
```


## 첫 감사 후 보완과 반대 감사 질문

원래9개 파일에 site-config, badge-viewer-session 및 관련 native test, home-client 전체, device-location-map, location-readiness 및 route, package.json을 추가했다. NaverMapView는 source-index-v2.json에 whole-file hash와 정확한 line 범위를 기록한 발췌이므로 전체파일/전체SDK 검증은 아니다. 모든 code blob은9228과 실제배포main b4에서 byte-identical임을 확인했다. 새 bundle은 원래 미전송 대기 요청의 입력 보완이며 같은 감사 재실행/중복전송이 아니다.

첫 요청의 evidence taxonomy를 정정한다. canonical7등급은 SOURCE_OBSERVED, BOUNDARY_INTEGRATION_TESTED, SYNTHETIC_MOCK_TESTED, HOST_TESTED(목표 물리 하드웨어 실측), PROPOSED, UNVERIFIED, CONTRADICTED다. FIELD_TESTED는 이7등급에 없다. physical/field/lab는 별도 environmentClass로 기록해야 한다. 첫 보고서는 원문을 바꾸지 않고 이 분류 혼동 자체도 반대/역검증하라.

첫 보고서의 W001-F1..F4, W002-F1..F6, W003-F1..F9 총19개에 동일 ID를 유지하고 새 지적은 신규 ID를 부여하라. ACCEPT/적용가능 CONDITIONAL에는 실제 수정(문서 포함)과 native 실행/경계 검증을 매핑하라. 소스/증거가 이미 보완됐으면 과거 snapshot DEFER와 현재 판단을 구별하라. unsigned attestation/standalone summary/같은 SHA 문자열만으로 runtime proof가 되지 않는다.

보존된 기능/자원 원시JSON이 있어도 fullHAR/trace/process-memory/물리Galaxy/field gain이 아니다. renderer disposal source와 module fetch cancellation은 다른 계약이며, 정상 사용자가 loading 중 닫기 어려운 상태도 실제 source에 근거해 판단하라. 표준에 없는 abort-import 가정이나 불필요한 speculative refactor를 요구하지 말고 구체적 재현/조건을 제시하라.

## ChatGPT6 Pro + Deep Research 첫 보고서 전문 (원문 무수정)

# Tzudong 중요 권한·렌더링·릴리스 독립 기술 감사

## 감사 범위와 증거 규칙

본 감사는 사용자가 지정한 **소스 revision `9228c1454393560bcd37240f793065e450f85683`**, 첨부 `MASTER-PLAN.md`, 그리고 자동 이름 변경된 `source_bundle(1).txt`에 수록된 **9개 공개 소스**만을 Tzudong 사실관계의 근거로 삼았다. `source_bundle(1).txt`가 원본 `source_bundle.txt`와 같은 내용이라는 사용자의 범위 지시를 따르며, 파일명 변경 자체를 리비전 변경으로 취급하지 않는다. 번들 본문은 SHA-256 `9420e4c1a47230c305c98e9f739571f9a3c188919fac750ee0fd45635902a6ee`와 9개 파일별 해시를 선언한다. 다만 이 보고서에서는 로컬 해시 명령이나 테스트·CLI를 실행했다고 주장하지 않으므로, 해당 해시는 **첨부물에서 관찰된 provenance assertion**이지 별도 HOST 검증 결과는 아니다. fileciteturn0file1

`MASTER-PLAN.md`는 후보 9228이 아직 승격·배포되지 않았고, 스냅샷 당시 운영 main은 `2e5630fada4cd50fb71ff7542723ca6393afe7c0`, 운영 deployment는 `dpl_8vFh9BJnQPLE9kvvrHrdgKqE8FDE`라고 명시한다. 또한 Chromium 브라우저 결과, synthetic component 수치, 타입체커 sampler 결과, PR/CI 상태 등을 서술하지만 그 원시 로그·trace·HAR·스크린샷·deployment metadata·CI artifact는 두 첨부물에 포함되어 있지 않다. 따라서 “그런 실행 결과가 MASTER에 기록되어 있다”는 사실은 `SOURCE_OBSERVED`지만, 그 실행 결과 자체는 이 감사에서는 `UNVERIFIED`다. fileciteturn0file0

이 보고서에서 증거 태그는 엄격하게 사용한다. `SOURCE_OBSERVED`는 9개 소스나 MASTER 본문에서 직접 확인되는 코드·서술, `SYNTHETIC_MOCK_TESTED`는 실제 실행 원시물이 제시된 mock test, `BOUNDARY_INTEGRATION_TESTED`는 실제 경계 통합 원시물, `HOST_TESTED`는 실제 브라우저·호스트 trace, `FIELD_TESTED`는 물리 기기·field 증거를 뜻한다. **테스트 소스가 존재한다는 것만으로 `*_TESTED`를 부여하지 않는다.** `CONTRADICTED`는 주장과 이용 가능한 소스가 직접 충돌하는 경우다.

또한 현재 bundle은 완전한 의존성 폐쇄 집합이 아니다. 예를 들어 `location-gate.ts`는 범위 밖 `site-config`를 import하고, 위치 테스트는 번들에 없는 `app/home-client.tsx`와 `components/map/NaverMapView.tsx`를 파일 시스템에서 읽는다. `Badge3DViewer.tsx`와 `badge-viewer-lifecycle.ts`는 번들에 없는 `badge-viewer-session`을 import한다. 그러므로 그 외부 파일의 실제 구현까지 필요한 통합 주장에는 별도 증거가 필요하다. fileciteturn0file1

| 판정 대상 | 현재 독립 감사 결론 |
|---|---|
| W001 / ADR-01 | **CONDITIONAL**. WeakMap 원본성·명시 철회·저장된 expiry에서의 exact rejection·expiry 관찰 후 replay 차단은 소스상 유지된다. 그러나 “수학적으로 정확히 300000 ms”와 “모든 rewind를 탐지”라는 더 강한 해석은 성립하지 않는다. |
| W002 / ADR-02 | **CONDITIONAL**. static 분기는 소스상 3D 컴포넌트 mount/WebGL/RAF를 차단하도록 배치되어 있다. 그러나 실제 chunk fetch/context/RAF 0이라는 HOST 수치는 원시 결과가 없어 미검증이며, `deviceMemory`의 coarse semantics와 지원 부재로 인한 iPhone 정적화 trade-off가 명시적으로 남는다. |
| W003 / ADR-03 | **DEFER**. 후보 9228이 아직 배포 전이라고 MASTER 자체가 명시하므로 기존 production SHA/alias/readback은 후보 릴리스 증거가 될 수 없다. 현재 상태에서 “9228이 production에 검증되어 릴리스됐다”는 주장은 **REJECT**다. |

## W001 권한 수명·원본성·철회 감사

현재 소스는 `L = 300000` ms에 대해 mint 시

\[
g := \mathrm{performance.now()}
\]

\[
e := \operatorname{fl}(g + L)
\]

를 저장하고, `hasFixedAuthorizationLifetime(g,e)`가 다시

\[
e === \operatorname{fl}(g + L)
\]

를 검사한다. ECMAScript `Number`는 IEEE-754 binary64이고 `Number::add`는 binary double-precision 규칙에 따라 합을 산출하므로, 이 등식은 **“mint 때 계산한 동일한 binary64 합인가”**를 확인하는 조건이다. 반면 `e - g === 300000`은 다시 한 번 binary64 뺄셈을 거치므로 합에서 생긴 반올림과 뺄셈 반올림 때문에 실패할 수 있다. citeturn0search1turn0search11 현재 코드의 주석도 바로 이 문제를 이유로 subtraction 대신 minted sum을 직접 비교한다고 설명한다. fileciteturn0file1

### 형식적 결론

실제 authorization 유효 조건은 소스상 다음 논리식과 같다.

\[
\begin{aligned}
V(a,n) :=&\ Registry.hasIdentity(a)\\
&\land safe(n)\land safe(g)\land safe(e)\\
&\land e>g\\
&\land e=\operatorname{fl}(g+300000)\\
&\land a.grantedAt=g\\
&\land a.expiresAt=e\\
&\land g\le n<e.
\end{aligned}
\]

실패하면 WeakMap entry를 즉시 삭제한다. 따라서 `n === e`이면 false가 되고 entry가 삭제되며, 그 뒤 `n`을 과거 값으로 되돌려도 같은 object에는 더 이상 WeakMap state가 없다. 명시적 revoke 역시 `WeakMap.delete`다. clone/spread/JSON/structured clone은 다른 object identity를 만들기 때문에 registry lookup 자체가 실패한다. ECMAScript에서 Object는 고유 identity를 갖고, WeakMap key 관찰 역시 그 identity를 기반으로 한다. citeturn1search1 이 부분은 `SOURCE_OBSERVED`, 판정은 **ACCEPT**다. fileciteturn0file1

다만 이 식이 보장하는 것은 **저장된 binary64 deadline**이지 모든 fractional `g`에 대해 실수론적 차이 `e-g = 300000`이 정확하다는 것은 아니다.

| 결함 / 경계 | W/ADR | Formal derivation | Evidence | Severity | 판정 기준 |
|---|---|---|---|---|---|
| **W001-F1: minted-sum equality는 exact mathematical 5분과 동치가 아니다** | W001 / ADR-01 | `e=fl(g+L)`이므로 `e===fl(g+L)`은 참이어도 `fl(e-g)` 또는 실수값 `e-g`는 `L`과 다를 수 있다. | `SOURCE_OBSERVED`; “모든 fractional 값에서 정확히 300000ms”라는 강한 주장에는 `CONTRADICTED` | **MEDIUM** — 권한 경계의 형식적 정의 문제. 실환경 오차는 극소일 수 있으나 invariant를 “exact”라고 부를 때 중요하다. | 5분을 **minted deadline `fl(g+300000)`의 half-open 구간**으로 정의한다면 ACCEPT. 실수론적으로 정확히 300000ms가 필수라면 현재 표현은 REJECT. |
| **W001-F2: intra-window clock rewind를 기억하지 않는다** | W001 / ADR-01 | 상태에는 `lastObservedNow`가 없다. `g=1000`, 첫 사용 `n=2000`, 다음 사용 `n=1500`이면 두 번 모두 `g≤n<e`라서 허용된다. | `SOURCE_OBSERVED`; “임의 rewind는 항상 거부”에는 `CONTRADICTED` | **MEDIUM assurance / LOW conforming-browser operational risk** | W3C가 보장하는 monotonic `performance.now()`만 threat model이면 CONDITIONAL-ACCEPT. mocked/nonconforming clock까지 “rewind-proof”를 ADR이 약속한다면 REJECT 후 stateful rewind check 필요. |
| **W001-F3: NaN/±Infinity/unsafe timestamp는 fail-closed지만 한 번의 비정상 now가 capability를 영구 철회한다** | W001 / ADR-01 | `isSafeTimestamp`가 finite와 `abs≤MAX_SAFE_INTEGER`를 요구한다. `now`가 한 번이라도 실패하면 WeakMap entry가 삭제된다. | `SOURCE_OBSERVED` | **LOW** — privilege 확대가 아니라 availability 축소 | 보안 쪽에서는 ACCEPT. “일시적 clock 이상 후 자동 복구”를 요구한다면 별도 설계가 필요하나, 자동 복구는 replay 특성을 바꾸므로 본 감사는 제안하지 않는다. |
| **W001-F4: W001 caller 통합 증명은 9-source bundle만으로 닫히지 않는다** | W001 / ADR-01 | 테스트가 `home-client.tsx`, `NaverMapView.tsx`, `site-config`에 의존하지만 실제 파일 내용은 bundle에 없다. | `UNVERIFIED` | **MEDIUM** evidence gap | 실제 caller/renderer source 또는 해당 revision의 raw integration artifact가 있어야 `BOUNDARY_INTEGRATION_TESTED`를 부여할 수 있다. 현재는 DEFER. |

High Resolution Time 명세는 동일 time origin의 `performance.now()` 값 차이가 음수가 되어서는 안 된다고 요구한다. 따라서 정상 규격 준수 브라우저에서는 W001-F2의 `2000 → 1500` 시퀀스 자체가 발생해서는 안 된다. citeturn0search0 중요한 구분은 이것이 **“현재 코드가 rewind를 탐지한다”는 뜻은 아니라는 것**이다. 코드는 브라우저의 monotonic 계약에 의존하며, 현재 번들의 “expiry를 한 번 관찰한 뒤 과거로 되돌림” 테스트는 WeakMap tombstoning을 시험할 뿐, expiry 전에 감소하는 clock sequence를 시험하지 않는다. fileciteturn0file1

다음 코드는 subtraction regression, mathematical-duration 차이, safe-range 경계를 한 번에 재현하는 독립 ECMAScript 반례다. 이는 실행 방법이며 이 보고서에서 실행했다고 주장하지 않는다.

```js
const L = 300_000;

for (const grantedAt of [
  262144.02702702704,
  262144.1081081081,
  4503599627370495.5,
]) {
  const expiresAt = grantedAt + L;

  console.log({
    grantedAt,
    expiresAt,
    delta: expiresAt - grantedAt,
    oldSubtractionCheck: expiresAt - grantedAt === L,
    currentMintedSumCheck: expiresAt === grantedAt + L,
    safe:
      Number.isFinite(grantedAt) &&
      Number.isFinite(expiresAt) &&
      Math.abs(grantedAt) <= Number.MAX_SAFE_INTEGER &&
      Math.abs(expiresAt) <= Number.MAX_SAFE_INTEGER,
  });
}
```

ECMAScript binary64 규칙상 처음 값에서는 `delta`가 `299999.99999999994`, 두 번째에서는 `300000.00000000006`이 될 수 있으면서 현재 minted-sum check는 참이다. 더 극단적이지만 여전히 현재 `isSafeTimestamp` 범위 안인 `g = 4503599627370495.5`에서는 `e = 4503599627670496`이고 차이가 **300000.5ms**가 되는 실행 가능한 Number 반례가 있다. 이 uptime은 약 142,713년 규모이므로 현실 브라우저 수명 문제라고 과장해서는 안 되지만, “finite + safe 범위 전체에서 수학적으로 정확한 5분”이라는 형식 명제의 반례로는 유효하다. citeturn0search1

unsafe mint는 반대로 fail closed다.

```js
const MAX = Number.MAX_SAFE_INTEGER; // 9007199254740991
const g = MAX - 299_999;             // still inside current "safe" bound
const e = g + 300_000;

console.log(g);                       // 9007199254440992
console.log(e);                       // 9007199254740992
console.log(e > MAX);                 // true

// Current hasFixedAuthorizationLifetime() rejects because expiresAt is unsafe.
```

`NaN`, `Infinity`, `-Infinity`도 `Number.isFinite`에서 탈락한다. 즉 이들 값으로 권한을 늘리는 반례는 찾을 수 없고, 결과는 mint 거부 또는 기존 capability 삭제다. fileciteturn0file1

정확한 expiry와 replay는 다음 두 경우를 분리해야 한다.

```js
const g = 1000;
const e = g + 300_000;

// Current predicate:
// exact expiry
console.log(g <= e && e < e);     // false

// Strong rewind counterexample before any invalidating observation:
console.log(g <= 2000 && 2000 < e); // true
console.log(g <= 1500 && 1500 < e); // true: rewind is not detected
```

첫 번째 false 뒤 실제 구현에서는 WeakMap entry까지 삭제되므로 `e → g+1` replay는 차단된다. 반면 `2000 → 1500`은 둘 다 window 안이어서 entry가 유지된다. 따라서 **“만료 후 재생 방지”는 보존되지만 “모든 clock rewind 방지”는 보존된다고 말하면 안 된다.**

ADR-01이 비규격/mock clock의 rewind까지 명시적으로 차단해야 한다면 epsilon이나 임의 지연 없이 다음과 같은 강화가 가능하다. 이는 선택적 제안이며 현재 규격 브라우저 threat model만 인정한다면 필수 수정은 아니다.

```diff
 type DeviceLocationAuthorizationState = Readonly<{
   grantedAt: number;
   expiresAt: number;
+  lastObservedAt: number;
 }>;

 const isActiveAuthorization = (
   authorization: DeviceLocationUseAuthorization | null | undefined,
 ): boolean => {
   if (!authorization || typeof authorization !== "object") return false;

   const state = deviceLocationAuthorizationRegistry.get(authorization);
   if (!state) return false;

   const now = capturedMonotonicNow();
   const isValid = isSafeTimestamp(now)
     && hasFixedAuthorizationLifetime(state.grantedAt, state.expiresAt)
     && authorization.grantedAt === state.grantedAt
     && authorization.expiresAt === state.expiresAt
     && state.grantedAt <= now
+    && state.lastObservedAt <= now
     && now < state.expiresAt;

-  if (!isValid) deviceLocationAuthorizationRegistry.delete(authorization);
-  return isValid;
+  if (!isValid) {
+    deviceLocationAuthorizationRegistry.delete(authorization);
+    return false;
+  }
+  deviceLocationAuthorizationRegistry.set(authorization, {
+    ...state,
+    lastObservedAt: now,
+  });
+  return true;
 };

 // mint:
 deviceLocationAuthorizationRegistry.set(authorization, {
   grantedAt,
   expiresAt,
+  lastObservedAt: grantedAt,
 });
```

이 diff는 동일 timestamp를 허용하고 감소만 거부하므로 clock precision 때문에 같은 값이 연속 반환되는 경우를 불필요하게 거부하지 않는다. 권한 시간을 연장하거나 epsilon을 추가하지도 않는다.

**W001 최종 판정:** WeakMap 원본성, clone/spread 거부, explicit revoke, exact stored expiry의 half-open `now < expiresAt`, 그리고 **expiry를 실제로 관찰하여 entry를 삭제한 뒤**의 replay 차단은 `ACCEPT`. `expiresAt === grantedAt + 300000` 수정은 subtraction-rounding regression을 제거한다. 그러나 ADR의 “exact 5분”을 실수론적 `e-g===300000`으로 해석하거나 “어떤 rewind든 자체 탐지”를 요구한다면 **CONDITIONAL을 넘어 REJECT 조건**이다. 그 두 요구는 현재 구현보다 강하다.

## W002 모바일 static gate·동적 import·WebGL·RAF 감사

현재 gate는 소스상 다음 함수다.

\[
S = low
\lor \neg browser
\lor \left(
mobileOrTouch \land
(memory=null \lor \neg finite(memory) \lor HardwareTier(cpu,memory)\ne HIGH)
\right).
\]

`getTierFromHardware`는 `memoryGB !== null`이면 CPU를 보지 않고 memory부터 평가하여 `>=6 → HIGH`, `>=4 → MEDIUM`, 그 아래 → LOW로 정한다. `PopularityBadge`는 `phase === "open"`일 때 `S`가 참이면 `StaticBadgeViewer`, 거짓일 때만 `Badge3DViewer`를 렌더링한다. `experimental3D` 기본값은 false이므로 기본 3D off 역시 소스상 유지된다. fileciteturn0file1

Next.js의 공식 lazy-loading 문서는 `next/dynamic`이 React lazy/Suspense 계열의 지연 로딩 메커니즘이며 조건부로 렌더링하는 dynamic component는 조건이 충족될 때 on-demand로 로딩될 수 있다고 설명한다. 또한 `ssr:false`는 Client Component에서 browser-only component의 prerender를 끄는 방식이다. citeturn0search2turn2search3 React 공식 문서는 effect setup이 component mount 후 실행되고 unmount 때 cleanup이 실행된다고 규정한다. citeturn3search0 따라서 **소스 구조만 놓고 보면** static branch가 선택된 렌더에서는 `Badge3DViewer`가 mount되지 않고, 그 파일의 `useEffect` 내부에 있는 `new WebGLRenderer(...)`와 `startBadgeRenderLoop(...)`도 실행되지 않는다. `requestAnimationFrame`은 실제 callback 등록 API이고 `cancelAnimationFrame`은 해당 handle을 제거하는 API라는 HTML Standard의 모델과도 일치한다. citeturn4search0

그러나 이것은 actual-browser 계측 결과와 같은 것이 아니다. MASTER가 주장하는 “contexts 3→0, cold 추가모듈 1→0, RAF 13–14→0”에는 원시 network trace, instrumentation log, browser context artifact가 첨부되어 있지 않아 `HOST_TESTED` 또는 `BOUNDARY_INTEGRATION_TESTED`로 승격할 수 없다. fileciteturn0file0

| 결함 / 경계 | W/ADR | Formal derivation | Evidence | Severity | 판정 기준 |
|---|---|---|---|---|---|
| **W002-F1: source gate는 WebGL/RAF mount를 차단하지만 실제 “0 import/0 context/0 RAF” 계측은 증명되지 않았다** | W002 / ADR-02 | `open ∧ S → StaticBadgeViewer`; `Badge3DViewer`와 그 effect는 false branch에만 존재한다. | code path는 `SOURCE_OBSERVED`; 제시된 브라우저 수치는 `UNVERIFIED` | **MEDIUM** evidence | 코드 설계는 ACCEPT. 실제 resource 절감 수치는 raw trace 전까지 CONDITIONAL/UNVERIFIED. |
| **W002-F2: `deviceMemory`를 물리 RAM 6GB 임계치처럼 해석하면 잘못이다** | W002 / ADR-02 | W3C Device Memory 값은 실제 RAM을 coarse power-of-two로 반올림하고 implementation-defined bound로 clamp한다. 따라서 코드의 `>=6`은 물리 “6GB 이상”과 동치가 아니다. | `SOURCE_OBSERVED` + 표준상 `CONTRADICTED` for literal physical-RAM claim | **MEDIUM** | heuristic 신호라고 명시하면 ACCEPT. “물리 6GB 이상을 식별한다”는 주장은 REJECT. |
| **W002-F3: API 미지원 mobile/touch는 CPU나 OS 추정이 아무리 높아도 static이다** | W002 / ADR-02 | `mobileOrTouch ∧ memoryGB===null → S=true`. | `SOURCE_OBSERVED` | **LOW 기능 위험 / 의도된 conservative trade-off** | 안전 우선 정책이라면 ACCEPT. “고성능 iPhone에도 3D 제공”이 제품 요구라면 현재 정책은 그 요구와 충돌하므로 CONDITIONAL/REJECT. |
| **W002-F4: OS→model 추정은 viewer gate에서 우회되지만 전역 hook에는 남아 있다** | W002 / ADR-02 | iOS version을 `'iPhone 13'`, `'iPhone 14 Pro'`, `'iPhone 15'` 등으로 직접 매핑한다. badge gate는 memory null이면 다시 static 처리하지만 다른 `useDevicePerformance` consumer에는 이 보호가 없다. | `SOURCE_OBSERVED` | **MEDIUM scope** | “W002가 global device classification을 고쳤다”는 주장 REJECT. badge viewer 한정 보호라는 표현은 ACCEPT. |
| **W002-F5: in-flight dynamic import의 cancellation은 코드에서 관리하지 않는다** | W002 / ADR-02 | dynamic component가 실제로 요청되면 import 자체에 application AbortSignal이나 cancel token이 없다. close/unmount 뒤 effect를 안 올리는 것과 이미 시작된 module fetch를 취소하는 것은 다른 문제다. | `SOURCE_OBSERVED` + browser-race result `UNVERIFIED` | **LOW–MEDIUM** | static path에는 영향 없음. dynamic path의 open→route-unmount/import-resolve race는 HOST evidence가 있어야 ACCEPT. |
| **W002-F6: session-level duplicate/recovery semantics는 bundle closure 밖이다** | W002 / ADR-02 | renderer와 lifecycle가 `badge-viewer-session`을 import하지만 그 파일은 9-source bundle에 없다. | `UNVERIFIED` | **MEDIUM** | duplicate renderer/session release 등의 주장은 해당 revision source 또는 raw boundary test 전까지 DEFER. |

Device Memory 표준은 값이 실제 RAM의 정확한 측정값이 아니라 nearest power-of-two 계열로 coarse 처리되고 fingerprinting 완화를 위해 상·하한도 둘 수 있다고 규정한다. 표준 자체도 API를 지원하지 않는 브라우저의 경우 feature를 default-on 할지 default-off 할지 애플리케이션이 정책을 선택해야 한다고 명시한다. citeturn1search0 따라서 Tzudong이 API 미지원 mobile/touch를 **정적화하는 것은 보안·리소스 측면에서 일관된 fail-closed 선택**이지만, 그것을 “실제 RAM이 낮아서”라고 설명하면 안 된다.

특히 현재 source comment의 “6GB+ RAM, 8코어+”와 실제 알고리즘 사이에는 의미 차이가 있다. memory 값이 존재하면 `getTierFromHardware()`는 CPU를 보지 않는다. 다음은 source-level counterexample이다.

```ts
const performance = {
  isLowEndDevice: false,
  cpuCores: 1,
  memoryGB: 8,
};

const mobile = {
  userAgent: "Android",
  maxTouchPoints: 1,
};

// Current logic:
// getTierFromHardware(1, 8) === "HIGH"
// shouldUseStaticBadgeViewer(performance, mobile) === false
```

HTML Standard는 `hardwareConcurrency`가 실제 물리 코어의 절대 측정치가 아니라 user agent가 잠재적으로 이용 가능한 logical processors 이하의 값을 반환할 수 있고 fingerprinting 등의 이유로 낮게 노출할 수도 있다고 규정한다. citeturn9search2 즉 `memoryGB=8, cpuCores=1`이 곧 “실제 단일코어 8GB 기기”라는 뜻도 아니다. 핵심은 현재 정책이 **memory report가 있으면 CPU와의 conjunction을 요구하지 않는다**는 것이다.

또한 W3C의 coarse-memory 규칙 때문에 synthetic test의 `memoryGB = 6`은 실제 `navigator.deviceMemory`의 일반적인 표준적 의미와 구분해야 한다. 그 값은 unit-test input으로는 유효하지만 물리 브라우저 관찰값을 곧바로 대표하지 않는다. citeturn1search0 따라서 MASTER의 synthetic profile과 실제 physical-device capability 주장을 분리해야 한다.

API 미지원 iPhone 시나리오는 더 명확하다.

```ts
shouldUseStaticBadgeViewer(
  {
    isLowEndDevice: false,
    cpuCores: 8,
    memoryGB: null,
  },
  {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    maxTouchPoints: 1,
  },
);
// => true
```

이는 현재 테스트에도 명시적으로 들어 있다. OS-derived model이 HIGH로 추정되더라도 `memoryGB === null`이 badge viewer에서는 우선적으로 static을 강제한다. fileciteturn0file1 이 trade-off는 **강한 iPhone까지 false-negative로 정적화할 수 있다는 것**이며, 기본 3D off·미공개 cohort라는 현재 정책 아래에서는 안전한 쪽의 손실이다. 이 정책을 사용자 성능 자동 최적화의 “정확한 기기 판별”로 홍보해서는 안 된다.

`useDevicePerformance.ts`의 OS→model inference는 별개다. iOS major version을 특정 iPhone model 문자열로 바꾸는 것은 UA의 feature detection과 다르며, MDN도 UA 기반 device/browser inference가 신뢰성이 낮아 feature detection을 선호한다고 경고한다. citeturn7search2 W002가 이 global hook을 바꾸지 않으므로 다른 consumer가 `isHighEndDevice`를 신뢰하는 문제까지 해결했다고 주장할 수 없다. fileciteturn0file1

SSR/hydration 쪽에서는 현재 source 구조상 즉각적인 불일치는 발견되지 않았다. `PopularityBadge`는 Client Component지만 Next.js Client Component도 초기 요청에서 HTML로 prerender될 수 있다. citeturn2search0 서버에서 `navigator`가 없으면 `browser=null`로 static 판정되지만 초기 `open` state는 언제나 false이므로 **static-vs-dynamic 선택 자체가 초기 DOM에 나타나지 않는다**. 클라이언트 첫 render에서 desktop이 dynamic-eligible로 달라져도 viewer는 아직 열리지 않았기 때문에 해당 차이만으로 hydration markup mismatch가 생기지 않는다. 이 결론은 `SOURCE_OBSERVED` 정적 분석이며 실제 framework version과 hydration trace는 bundle에 package manifest가 없으므로 `HOST_TESTED`는 아니다.

취소 경합은 두 종류를 분리해야 한다. static path는 `<Badge3DViewer>`를 렌더하지 않으므로 dynamic loader 자체가 필요하지 않다. 반면 dynamic-eligible 사용자가 viewer를 여는 순간 시작된 `import()`에는 이 소스에서 별도의 AbortSignal이나 취소 핸들이 없다. `import()`은 Promise 기반 module loading이고 현재 표준 사용 형태는 fetch-style AbortSignal을 제공하지 않는다. citeturn3search2 React unmount cleanup은 이미 mount된 WebGL resources에 대해서는 실행될 수 있고, 현재 코드 역시 RAF 취소·geometry/material/renderer disposal·context loss 순서를 둔다. React는 dependency change/unmount 시 cleanup을 실행하고, Three.js 역시 geometry/material/renderer GPU 자원은 애플리케이션이 명시적으로 dispose해야 한다고 문서화한다. citeturn3search0turn5search0turn5search2

다만 **in-flight module network work가 취소됐다는 뜻은 아니다.** 또한 dynamic component의 `loading: () => null` 때문에 chunk가 아직 해결되지 않은 사이에는 opener는 이미 `phase === "open"`으로 hidden이고 dynamic viewer의 close button도 아직 존재하지 않는다. 따라서 “열기 직후 사용자 close로 import를 취소”하는 정상 UI 경로 자체가 없다. route unmount나 parent removal race는 별도 HOST test가 필요하다.

실제 “static gate가 dynamic chunk/WebGL/RAF를 막는다”는 강한 evidence를 얻으려면 임의의 220ms sleep 대신 event-driven raw trace가 필요하다. 최소 artifact는 다음 의미의 instrumentation이어야 한다.

```ts
// Evidence harness concept; not executed here.
//
// Fresh browser context:
// 1. instrument requestAnimationFrame count;
// 2. instrument WebGL/WebGL2 context creation;
// 3. record JS requests whose module graph contains Badge3DViewer/three;
// 4. inject a mobile/touch navigator with deviceMemory absent;
// 5. render PopularityBadge(experimental3D=true);
// 6. click "3D 보기";
// 7. wait for deterministic fallback DOM: [data-badge-viewer="fallback"];
// 8. assert:
//      Badge3DViewer/three cold module request count === 0
//      WebGL context creation count === 0
//      requestAnimationFrame count === 0
// 9. retain HAR/trace + exact build SHA.
```

이 원시물이 없으므로 MASTER에 적힌 3→0, 1→0, 13–14→0 수치는 본 감사에서 `UNVERIFIED`로 유지한다. fileciteturn0file0

CPU까지 반드시 HIGH여야 한다는 ADR이 별도로 존재할 경우에만 아래와 같은 강화가 정당하다. 현재 ADR이 “unknown/intermediate **memory**는 static”만 요구한다면 이 변경을 자동 권고하지 않는다.

```diff
   const { memoryGB, cpuCores } = performance;
   return memoryGB === null || !Number.isFinite(memoryGB)
+    || !Number.isFinite(cpuCores)
+    || cpuCores < 8
     || getTierFromHardware(cpuCores, memoryGB) !== "HIGH";
```

이 변경은 권한 완화나 한도 우회가 아니라 더 보수적인 정적화지만, `8`이라는 threshold를 실제 제품 requirement로 승인한 자료가 현재 범위에는 없으므로 **조건부 제안**일 뿐이다.

**W002 최종 판정:** unknown/intermediate mobile memory → static 정책, API 미지원 touch/mobile → static 정책, default 3D off는 source-level **ACCEPT**. “이 수정으로 실제 browser에서 module/network/WebGL/RAF가 0이 되었다”는 성능 증거는 **CONDITIONAL / UNVERIFIED**. OS→model global 문제를 해결했다는 주장은 **REJECT**. API 미지원 iPhone이 강한 기기여도 static이 되는 것은 현재 정책의 의도된 보수적 trade-off이며, 그 제품 손실을 숨기면 안 된다.

## W003 브라우저·synthetic·production 릴리스 증거 감사

가장 중요한 릴리스 경계는 MASTER 자체가 후보 9228을 **아직 승격·배포 전**이라고 명시한다는 점이다. 따라서 같은 문서에 있는 기존 운영 main `2e5630...`와 deployment `dpl_8vF...`에 대한 browser/readback 결과는 후보 9228의 production deployment 증거가 될 수 없다. fileciteturn0file0

이는 단순한 문서 미비가 아니라 source/deployment identity 문제다. Vercel 공식 문서는 Git commit SHA를 deployment metadata로 조회할 수 있고, `inspect`로 특정 deployment의 정보를 확인하며, production domain/alias는 promote·rollback 또는 alias assignment에 의해 다른 deployment를 가리킬 수 있다고 설명한다. citeturn6search11turn6search1turn6search0turn6search9 즉 **“main SHA를 안다”**, **“deployment ID를 안다”**, **“production alias가 응답한다”**는 서로 다른 증거이며 한 가지가 나머지를 자동 증명하지 않는다. Vercel도 alias URL은 현재 가리키는 deployment로 resolve되며 promote/rollback 상태에서는 최신 시간순 deployment와 다를 수 있다고 명시한다. citeturn6search10

| 결함 / 증거 단절 | W/ADR | Formal/evidence derivation | Evidence | Severity | 판단 |
|---|---|---|---|---|---|
| **W003-F1: 기존 production identity는 후보 9228의 릴리스 증거가 아니다** | W003 / ADR-03 | MASTER: prod main=`2e5630...`; candidate=`9228...`; candidate “승격/배포 전”. 따라서 `prodSHA ≠ candidateSHA`. | `SOURCE_OBSERVED + CONTRADICTED` for any candidate-production claim | **HIGH** | 후보가 production에 있다고 주장하는 것은 **REJECT**. 실제 릴리스 자체는 증거 완성 전 **DEFER**. |
| **W003-F2: Chromium153 actual-browser 결과의 raw artifact가 없다** | W003 / ADR-03 | viewport·pageerror0·asset hash 등 결과가 서술됐지만 trace/HAR/screenshot/raw console/output이 없음. | `UNVERIFIED` | **HIGH evidence** | HOST_TESTED 표시는 REJECT. raw artifact + exact deployment identity가 있으면 재평가. |
| **W003-F3: synthetic contexts/module/RAF 수치도 raw artifact가 없다** | W002/W003 | MASTER에 수치만 있으며 process-level logs/trace 없음. | `UNVERIFIED` | **MEDIUM–HIGH** | resource reduction 수치 주장은 DEFER. source-level gate 주장만 유지. |
| **W003-F4: strict history marker visibility는 before/after 모두 실패했다고 기록됨** | W003 / ADR-03 | diagnostic detail restore 3/3은 더 엄격한 original-marker visibility predicate와 논리적으로 다른 조건이다. | underlying run `UNVERIFIED`; MASTER 서술은 `SOURCE_OBSERVED` | **MEDIUM** | “history regression 완전 통과”는 REJECT. strict-history가 release gate면 release REJECT; known pre-existing non-blocker로 공식 분리돼 있으면 CONDITIONAL. |
| **W003-F5: CSP nelo/eval 및 announcements/ad_banners 401이 남아 있다** | W003 / ADR-03 | MASTER 스스로 residual console/network 문제를 보존한다. 원시 메시지/response가 없어 원인은 판단 불가. | `UNVERIFIED` result / `SOURCE_OBSERVED` attestation | **MEDIUM** | “clean console/network” 주장은 REJECT. scoped release blocker인지는 raw evidence와 gate policy 없이는 DEFER. |
| **W003-F6: 73.3ms > 60ms sampler failure 후 rerun success를 noise로 소거할 근거가 없다** | W003 / ADR-03 | 실패와 성공 둘 다 동일 평가에 남겨야 하며 공식 retry policy와 raw timing이 없음. | `UNVERIFIED` | **MEDIUM–HIGH** | 60ms가 hard gate면 REJECT. 동일 SHA/host에서 승인된 retry 규칙이 있으면 CONDITIONAL. 임의 wait/threshold 완화는 허용 불가. |
| **W003-F7: MASTER 스냅샷에서 source PR3319 CI가 진행 중이라고 명시됨** | W003 / ADR-03 | merge·protected-main·final CI·candidate deployment chain이 아직 완료되지 않았다는 서술. | `SOURCE_OBSERVED` | **HIGH release** | release는 **DEFER**. 이 보고서 범위를 벗어나 live 상태가 이후 바뀌었다고 추정하지 않는다. |
| **W003-F8: original memory guard, physical device, field 성과 증거가 없음** | W002/W003 | bundle에는 물리 메모리 측정·배터리·FPS·field telemetry/raw device result가 없다. | `UNVERIFIED`; `FIELD_TESTED` 아님 | **HIGH if claimed**, otherwise evidence boundary | 실제 서비스 성능·physical-device gain·field gain 주장은 REJECT. source bug fix/heuristic claim과 분리하면 ACCEPT 가능. |
| **W003-F9: 법적·운영 approval은 readiness literal이나 source code로 증명할 수 없다** | W001/W003 | API response code path와 법적/운영 승인 증거는 서로 다른 evidence class다. | `UNVERIFIED` | **HIGH if claimed** | 법적/운영 승인 주장은 현재 범위에서 DEFER. 코드 literal을 승인 증거로 대체하면 REJECT. |

MASTER의 strict-history 상황은 특히 결과 표현을 분리해야 한다. “before/after 모두 실패”가 사실이라면 그것은 **새 후보가 해당 실패를 새로 만들었다는 differential evidence는 아니다**. 그러나 동시에 absolute release criterion인 “원래 marker visibility가 복구된다”도 만족하지 않는다. diagnostic detail restore 3/3은 더 좁은 다른 predicate가 성공한 것이므로 strict failure를 덮을 수 없다. 이 감사에서는 raw browser result 자체가 없어 `UNVERIFIED`지만, MASTER의 서술을 그대로 받아도 “history 전체 통과”라는 문구는 허용되지 않는다. fileciteturn0file0

CSP/401 역시 동일하다. 정확한 CSP directive, blocked resource, 401 response headers/body가 없으므로 원인이 harmless third-party noise인지 실제 app defect인지 판정하지 않는다. 다만 그 흔적이 있다는 서술을 보존하면서 “pageerror 0이므로 브라우저가 완전히 clean하다”고 넓히는 것은 증거 범위를 넘는다. fileciteturn0file0

타입체커 sampler의 `73.3ms > 60ms` 후 동일 기준 rerun success도 “한 번 성공했으므로 실패 삭제”로 취급할 수 없다. 임계치가 hard gate라면 실패는 실패다. retry가 공식적으로 허용되는 gate라면 동일 SHA, 동일 command, 동일 host constraints, 최초·재실행 원시 결과와 retry policy를 함께 제출해야 한다. 본 감사는 threshold를 높이거나 sleep을 추가하거나 불리한 sample을 버리는 방식을 권고하지 않는다.

Vercel 공식 문서상 production deployment와 promotion은 별도 lifecycle을 가질 수 있고 Deployment Checks가 production domain assignment 전에 적용될 수도 있다. citeturn6search3 따라서 W003에서 요구되는 최소 릴리스 chain은 다음 관계를 동시에 만족해야 한다.

\[
candidate\ source
\rightarrow protected\ merge
\rightarrow exact\ main\ SHA
\rightarrow deployment\ metadata(SHA)
\rightarrow READY
\rightarrow production\ alias
\rightarrow public\ readback
\rightarrow remote\ bytes/hash
\]

이 가운데 하나라도 다른 commit/deployment를 가리키면 end-to-end release identity는 끊긴다.

아래는 필요한 **read-only evidence 수집 형태의 예시**다. 실행했다고 주장하는 것이 아니며, promotion·alias 변경 같은 쓰기 명령은 포함하지 않는다.

```sh
# 1. Exact deployment tied to the exact merged commit
vercel ls -m githubCommitSha=<EXACT_PROTECTED_MAIN_SHA>

# 2. Deployment identity/status/metadata
vercel inspect <DEPLOYMENT_ID_OR_GENERATED_URL>

# 3. Observe current alias assignments; do not mutate them
vercel alias ls

# 4. Read generated deployment URL and production alias independently
curl -fsS -D generated.headers https://<generated-deployment>/ -o generated.html
curl -fsS -D production.headers https://<production-alias>/ -o production.html

# 5. Fetch specifically identified immutable/static assets from both endpoints
#    and retain raw bytes + digest output as artifacts.
```

Vercel은 deployment를 Git SHA로 필터링할 수 있음을 공식 문서화하고, `inspect`는 deployment URL/ID의 정보를 조회하는 read operation이다. citeturn6search11turn6search1 production alias가 현재 어떤 deployment를 가리키는지는 별도 확인이 필요한데, domain은 production deployment에 자동 할당될 수도 있고 promote/rollback으로 바뀔 수도 있기 때문이다. citeturn6search0turn6search2

**W003 최종 판정:** 현재 첨부 범위에서는 후보 9228의 production release를 승인할 수 없어 **DEFER**다. “9228이 현재 production에서 SHA/alias/readback까지 검증됐다”는 주장은 MASTER 자체와 충돌하므로 **REJECT**다. 기존 production 브라우저 결과가 실제로 있었다 하더라도 그것은 해당 기존 deployment의 host evidence일 뿐 후보 9228의 release evidence로 승계되지 않는다.

## 릴리스 증거 계층과 필요한 원시물

각 증거가 주장할 수 있는 범위를 분리하지 않으면 W003에서 가장 쉽게 과잉 결론이 난다.

| 증거 | 현재 첨부에서 말할 수 있는 최대 범위 | 현재 태그 | 그 증거만으로 말할 수 없는 것 |
|---|---|---|---|
| 후보 9228의 9개 source | 해당 source text와 branch logic | `SOURCE_OBSERVED` | 테스트가 실제 실행됨, production 배포됨 |
| unit-test source | regression/test intent가 코드에 존재 | `SOURCE_OBSERVED` | “10 pass / 128 assertions / 0 fail” 실제 결과 |
| MASTER의 test-count 서술 | 작성자가 그 결과를 기록했다 | `SOURCE_OBSERVED` about the statement; result `UNVERIFIED` | synthetic execution provenance |
| synthetic navigator/component | raw artifact가 없으므로 현재 수치 검증 불가 | `UNVERIFIED` | physical device, real RAM, field performance |
| actual Chromium browser | MASTER 서술만 있음 | `UNVERIFIED` | 후보 9228 deployment identity, physical mobile behavior |
| production SHA | 실제 deployment metadata와 결합되면 어떤 commit을 build했는지 증명 가능 | 현재 후보에 대해서 `UNVERIFIED` | alias가 지금 그 deployment를 가리킴 |
| production alias | alias target evidence가 있으면 현재 routing target 증명 가능 | 후보에 대해서 `UNVERIFIED` | 그 target의 source bytes가 특정 SHA와 일치함 |
| HTTP readback | 실제 public endpoint 응답을 증명 | 후보에 대해서 `UNVERIFIED` | 전체 source provenance, physical/field 성능 |
| asset hash/readback | 선택한 원격 asset byte identity | 후보에 대해서 `UNVERIFIED` | server logic 전체, navigation correctness |
| physical device measurement | 실제 기기 특성 | 없음 | field population 성과 |
| field/RUM evidence | 배포 후 population behavior | 없음 | 법적 승인 |
| 법적/운영 승인 문서 | 그 문서가 명시하는 승인 범위 | 없음 | source correctness 자체 |

후보 릴리스에 필요한 최소 원시 evidence는 **최종 protected-main SHA**, 그 SHA를 가리키는 CI 원시 결과, 그 SHA와 결합된 deployment metadata, READY 상태, alias→deployment mapping, generated URL과 production URL의 readback, 후보 변경과 관련된 immutable/static asset의 원격 byte hash다. Vercel Git integration은 production branch merge로 production deployment를 만들 수 있지만, 실제 환경은 deployment checks, manual promotion, rollback 등으로 달라질 수 있으므로 “main에 merge됐다”만으로 public alias 현재 상태를 추론해서는 안 된다. citeturn6search4turn6search3turn6search9

기능 evidence에는 별도로 W001 exact-expiry/fractional/rewind 원시 test output과 W002 fresh-context network/WebGL/RAF trace가 필요하다. strict-history가 release criterion이면 marker visibility의 **원래 strict predicate**를 재실행해야 하며 diagnostic restore를 대체 evidence로 사용하면 안 된다. CSP/401도 raw console/network artifact가 필요하다. `MASTER-PLAN`에 기록된 browser/source test 서술만으로 이들을 `HOST_TESTED`로 상향할 수 없다. fileciteturn0file0

물리 기기·process memory·배터리·FPS·field latency·사용자 population 개선은 현재 자료에 없으므로 계속 `UNVERIFIED`다. 특히 Device Memory API는 정확한 physical RAM sensor가 아니라 coarse capability signal이므로 synthetic `memoryGB` test를 physical-memory validation으로 승격해서는 안 된다. citeturn1search0

기본 3D off와 unpublished cohort는 변경하지 않아야 한다. 현재 `PopularityBadge`의 `experimental3D = false`는 source에서 확인되고, MASTER는 공개 cohort가 unpublished/entries0임을 명시한다. fileciteturn0file1 fileciteturn0file0 본 감사의 수정안은 이를 on으로 전환하거나 cohort를 공개하거나 권한·보안 경계를 완화하지 않는다.

최종 release decision matrix는 다음과 같다.

| 판정 | 충족 시 적용 |
|---|---|
| **ACCEPT — W001 source semantics** | “5분”을 `fl(grantedAt+300000)`이라는 저장 deadline으로 정의하고 W3C monotonic clock을 신뢰하며, raw regression 실행에서 fractional·NaN/Infinity·unsafe·exact-expiry·clone/revoke가 확인될 때 |
| **CONDITIONAL — W001 rewind** | ADR이 conforming `performance.now()`를 trusted primitive로 명시하면 현재 코드 허용. ADR이 mocked/nonconforming 감소도 탐지한다고 주장하면 `lastObservedAt` 같은 강화 전에는 REJECT |
| **ACCEPT — W002 conservative static policy** | mobile/touch memory unknown/intermediate를 static 처리하며 API 미지원 고성능 기기 false-negative를 의도된 trade-off로 인정할 때 |
| **CONDITIONAL — W002 resource reduction** | exact production/build SHA와 결합된 fresh browser raw trace에서 static path의 dynamic-module/WebGL/RAF 부재가 확인될 때만 실제 절감 claim 허용 |
| **REJECT — global device-model accuracy claim** | 현재 OS-version→iPhone-model 추정으로 “실제 모델/물리 성능을 검출한다”고 표현하는 경우 |
| **REJECT — 현재 candidate-in-production claim** | MASTER 기준 candidate 9228이 미배포인데 existing production evidence를 candidate evidence로 재사용하는 경우 |
| **DEFER — W003 release** | protected merge, final CI, exact deployment SHA, READY, alias, public readback, byte/hash chain이 아직 제출되지 않은 현재 상태 |
| **REJECT — field/physical/legal 성과 주장** | 해당 raw evidence 없이 physical-device improvement, field performance gain, 법적/운영 승인을 주장하는 경우 |

## 규범·프레임워크 근거

ECMAScript의 현재 명세는 `Number`를 IEEE-754 binary64로 정의하고 Number addition이 해당 부동소수점 규칙을 따른다고 명시한다. 이것이 W001에서 `e === g + L`과 `e - g === L`이 논리적으로 동일하지 않은 직접적인 근거다. citeturn0search1turn0search11

W3C High Resolution Time 명세는 `performance.now()`가 같은 time origin에서 monotonic해야 하며 시간 차이가 음수가 되어서는 안 된다고 요구한다. 따라서 current implementation이 explicit last-seen state 없이도 실제 브라우저에서는 rewind를 기대하지 않는 설계가 가능한 반면, synthetic clock에 대한 독립 rewind detection까지 증명하는 것은 별개의 주장이다. citeturn0search0

ECMAScript object identity 모델은 Object가 고유 identity를 가진다고 설명한다. WeakMap key를 clone/spread로 다시 기술한다고 동일 identity를 재생성하는 것이 아니므로 현재 capability의 WeakMap-origin binding은 구조적 필드 일치만으로 위조되지 않는다. citeturn1search1

W3C Device Memory API는 `deviceMemory`가 exact physical RAM이 아니라 coarse, power-of-two 계열, implementation-bounded 값임을 규정하고, API 미지원 브라우저를 어떻게 처리할지는 애플리케이션 정책이라고 설명한다. 이것이 W002의 static-on-unknown 선택은 정당화하지만 “6GB 물리 RAM detector”라는 표현은 정당화하지 못하는 이유다. citeturn1search0

HTML Standard는 `hardwareConcurrency`가 user agent에 잠재적으로 이용 가능한 logical processors의 상한 안에서 반환되며, UA-specific limit나 fingerprinting 이유로 실제보다 낮은 값을 노출할 수 있다고 명시한다. 따라서 이 값도 물리 CPU 모델의 인증값이 아니다. citeturn9search2

Next.js 공식 문서는 `next/dynamic`을 Client Component lazy loading에 사용하고, 조건부 component를 필요할 때 load하며 `ssr:false`로 browser-only component의 server prerender를 끌 수 있다고 설명한다. 또한 Client Components는 초기 load에서 server가 HTML로 prerender하고 브라우저에서 hydrate할 수 있다. citeturn0search2turn2search0 이는 W002의 “SSR-safe”와 “conditional dynamic component” 분석의 framework 근거다. 다만 정확한 프로젝트 Next version은 9-source bundle에 없어 version-specific runtime 증거는 별도로 필요하다.

React 공식 문서는 effect가 mount 후 setup되고 dependency change/unmount 때 cleanup된다고 규정한다. 따라서 `Badge3DViewer`가 아예 commit되지 않은 static path에서는 그 component의 `useEffect` WebGL setup이 실행될 이유가 없고, 이미 mount된 viewer가 unmount되면 cleanup이 실행되는 것이 기대되는 lifecycle이다. citeturn3search0

WHATWG HTML의 animation-frame 정의는 `requestAnimationFrame`이 callback handle을 등록하고 `cancelAnimationFrame`이 그 handle을 제거하는 모델을 명시한다. 현재 lifecycle helper가 pending handle을 저장하고 teardown에서 cancel하는 구조는 이 API 모델과 부합하지만, 실제 “RAF count가 0”이라는 결과는 host instrumentation이 별도로 필요하다. citeturn4search0

Three.js 공식 문서는 geometry, material, renderer의 GPU 관련 자원이 자동으로 모두 해제되는 것이 아니며 적절한 `dispose()`가 필요하고, `WebGLRenderer.dispose()`가 GPU 자원을 해제하며 `forceContextLoss()`는 WebGL context loss를 유도한다고 문서화한다. 현재 source가 이 teardown API들을 호출한다는 사실은 확인되지만 실제 GPU/process-memory 회수량은 field나 host 측정 없이 숫자로 주장할 수 없다. citeturn5search0turn5search2

Vercel 공식 문서는 deployment를 Git commit SHA metadata로 찾을 수 있고, 특정 deployment를 `inspect`할 수 있으며, production alias/domain이 promotion·rollback에 의해 다른 deployment로 바뀔 수 있음을 명확히 한다. 그러므로 **source SHA → deployment ID → READY → alias target → public readback → remote bytes**를 한 묶음으로 보존해야 후보 release provenance가 성립한다. citeturn6search11turn6search1turn6search9turn6search2

**독립 최종 결론:** W001의 현재 수정은 subtraction rounding bug를 제거하며 WeakMap 원본성·명시 철회·저장된 exact expiry·expiry 관찰 후 replay 삭제를 훼손하지 않는다. 그러나 binary64 deadline과 수학적으로 정확한 300000ms는 동일 명제가 아니고, expiry 전의 clock decrease는 코드 자체가 기억·탐지하지 않는다. W002의 static gate는 source 구조상 unknown/intermediate mobile memory에서 3D component mount와 그 WebGL/RAF effect를 우회하지만, 실제 module/context/RAF 감소 수치는 원시 host evidence 없이 미검증이다. API 미지원 iPhone의 강제 static은 보수적 정책의 의도된 false-negative이며, global OS→model 추정의 한계는 그대로 남는다. W003은 후보 9228이 MASTER상 아직 production이 아니므로 **release DEFER**가 유일하게 증거에 맞는 판정이고, existing production browser·SHA·alias 결과를 후보 release 증거로 승계하는 것은 **REJECT**다.