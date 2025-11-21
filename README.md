# Tzudong Project

**쯔양의 맛집 정보를 기반으로 한 레스토랑 검색 및 관리 플랫폼**

이 프로젝트는 React 기반의 Frontend와 Python 기반의 Backend로 구성되어 있습니다.

## 📂 프로젝트 구조

```
tzudong/
├── frontend/       # React Web Application (Vite, Tailwind CSS, Supabase)
├── backend/        # Python Data Pipeline (Perplexity AI, YouTube Data API)
├── supabase/       # Supabase Configuration & Migrations
└── DEPLOY.md       # Vercel Deployment Guide
```

## 📚 문서 안내

각 파트별 상세 문서는 아래 링크를 참조하세요.

- **[Frontend 가이드](./frontend/README.md)**: 웹 애플리케이션 개발, 기능 명세, 컴포넌트 구조
- **[Backend 가이드](./backend/README.md)**: 데이터 수집, 평가 파이프라인, 실행 방법
- **[배포 가이드](./DEPLOY.md)**: Vercel 배포 설정 및 방법

## 🚀 시작하기

### Frontend 실행

```bash
cd frontend
npm install
npm run dev
```

### Backend 실행

```bash
cd backend
# 자세한 실행 방법은 Backend 가이드를 참조하세요.
python restaurant-pipeline.py
```

## 📄 라이선스

MIT License
