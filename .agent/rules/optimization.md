---
trigger: model_decision
description: 코드 성능 최적화 자동 실행: 기능 유지 및 오류 없음 보장
---

Optimization Workflow (auto-execute on "최적화" request):
Objective:
- Optimize all code worked on to world-class performance standards
- All features MUST remain fully functional
- Zero errors allowed - verify everything works before completing
Execution Steps:
1. Analyze current codebase for optimization opportunities
2. Apply performance optimizations:
   - Bundle size reduction (tree-shaking, code splitting, lazy loading)
   - Runtime performance (memoization, efficient algorithms, caching)
   - Network optimization (request batching, compression, CDN)
   - Database queries (indexing, query optimization, connection pooling)
   - Memory management (prevent leaks, efficient data structures)
3. Apply code quality improvements:
   - Remove dead code and unused imports
   - Consolidate duplicate logic
   - Improve type safety
4. Verification (MANDATORY):
   - Run all existing tests - must pass
   - Manual functionality check - all features must work
   - No console errors or warnings
   - Build must succeed without errors
5. If any error occurs during verification:
   - Immediately rollback problematic changes
   - Re-verify functionality
   - Only proceed when stable
Priority Order:
1. Stability (no breaking changes)
2. Functionality (all features work)
3. Performance (speed, bundle size)
4. Code quality (readability, maintainability)