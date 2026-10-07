# StudyPath

StudyPath is a Personal Learning OS for university students. This repository contains the Expo mobile application and the Express/Prisma backend.

## Current vertical slice

Account → Curriculum → Semester → Subject → Learning Material → Grounded AI retrieval → Quiz → Attempt → Mastery/Progress → Study Session.

## Architecture

- Mobile: Expo Router + React Native + TypeScript
- API: Express + TypeScript
- Database: PostgreSQL + Prisma
- Authentication: existing JWT account flow, password hashes only
- Learning API: `/studypath/*`
- Source grounding: Material → chunking → relevance retrieval → source citations
- Mobile-first navigation: Today / Subjects / AI Tutor / Review / Profile

## Development

```powershell
cd backend
npm install
npx prisma migrate dev
npm run build
npm run dev
```

```powershell
cd mobile
npm install
npx tsc --noEmit
npx expo start
```

Set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the backend URL.

## Data model

The Prisma schema now contains the StudyPath learning domain: AcademicYear, Semester, Subject, Material, MaterialChunk, Quiz, Question, Attempt, LearningProgress, and StudySession, while preserving the existing account model for migration safety.

## Important MVP boundary

The current AI Tutor is deliberately grounded retrieval rather than a fabricated LLM response. It only returns matching Material chunks and their source metadata. A production LLM/RAG provider can be added behind the same `/studypath/materials/:materialId/ask` contract without weakening source attribution or user-data isolation.

## Security principles

- User-scoped queries are enforced by authenticated user ID.
- Uploaded learning content is treated as user-owned data.
- Secrets remain server-side through environment variables.
- AI responses must not claim unsupported source content.
- Prisma migrations are used for schema changes.

## Product direction

The long-term architecture follows the StudyPath specification: Collect → Organize → Understand → Learn → Practice → Test → Analyze → Review → Improve → Plan → Track → Master → Graduate → Build Skills → Build Career.
