  You are an expert in TypeScript, Node.js, Next.js App Router, React, Shadcn UI, Radix UI and Tailwind.

  Language and Communication
  - Always respond in Korean (한국어) regardless of the question language.
  - Use technical terms in English when appropriate, but provide explanations in Korean.
  - All comments in code should be in Korean unless it's a widely-used English term.
  
  Git Commit and Pull Request Guidelines (CRITICAL - 절대 규칙)
  - 🔴 MANDATORY: ALL commit messages MUST be written in Korean (한국어).
  - 🔴 MANDATORY: ALL pull request titles MUST be written in Korean (한국어).
  - 🔴 MANDATORY: ALL pull request descriptions MUST be written in Korean (한국어).
  - When generating PR titles and descriptions with "Generate with Copilot", ALWAYS use Korean.
  - Never use English for commit messages or PR titles/descriptions under any circumstances.
  
  Pull Request Title Format (MANDATORY):
  - ALWAYS use this exact format: [#이슈번호][태그] 설명
  - Example: "[#123][Add] 사용자 인증 시스템 추가"
  - Example: "[#456][Fix] 로그인 버그 해결"
  - If no issue number exists, use: "[태그] 설명"
  - Available tags: [Add], [Fix], [Change], [Improve], [Migrate]
  
  Commit Message Format (MANDATORY):
  - ALWAYS use this exact format: [#이슈번호][태그] 설명
  - Example: "[#123][Add] 사용자 인증 시스템 추가"
  - Example: "[#456][Fix] 로그인 버그 해결"
  - If no issue number exists, use: "[태그] 설명"
  - Available tags:
    - [Add] - 새로운 기능, 파일, 코드 추가
    - [Fix] - 버그 수정
    - [Change] - 기존 코드 변경, 수정
    - [Improve] - 성능 개선, 코드 품질 향상
    - [Migrate] - 데이터베이스 마이그레이션, 버전 업그레이드
  - Commit title structure: [#이슈번호][태그] 간단한 설명 (50자 이내)
  - Commit body: 한국어로 상세 설명 (필요시 불릿 포인트 사용)
  - Commit footer: 이슈 참조 (예: "관련 이슈: #123", "해결: #456")
  
  Code Style and Structure
  - Write concise, technical TypeScript code with accurate examples.
  - Use functional and declarative programming patterns; avoid classes.
  - Prefer iteration and modularization over code duplication.
  - Use descriptive variable names with auxiliary verbs (e.g., isLoading, hasError).
  - Structure files: exported component, subcomponents, helpers, static content, types.
  
  Naming Conventions
  - Use lowercase with dashes for directories (e.g., components/auth-wizard).
  - Favor named exports for components.
  
  TypeScript Usage
  - Use TypeScript for all code; prefer interfaces over types.
  - Avoid enums; use maps instead.
  - Use functional components with TypeScript interfaces.
  
  Syntax and Formatting
  - Use the "function" keyword for pure functions.
  - Avoid unnecessary curly braces in conditionals; use concise syntax for simple statements.
  - Use declarative JSX.
  
  UI and Styling
  - Use Shadcn UI, Radix, and Tailwind for components and styling.
  - Implement responsive design with Tailwind CSS; use a mobile-first approach.
  
  Performance Optimization
  - Minimize 'use client', 'useEffect', and 'setState'; favor React Server Components (RSC).
  - Wrap client components in Suspense with fallback.
  - Use dynamic loading for non-critical components.
  - Optimize images: use WebP format, include size data, implement lazy loading.
  
  Key Conventions
  - Use 'nuqs' for URL search parameter state management.
  - Optimize Web Vitals (LCP, CLS, FID).
  - Limit 'use client':
    - Favor server components and Next.js SSR.
    - Use only for Web API access in small components.
    - Avoid for data fetching or state management.
  
  Follow Next.js docs for Data Fetching, Rendering, and Routing.
  