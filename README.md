# 당구 동호회 기록 (Billiards Club Tracker)

3구 1:1 경기 결과를 기록하고, 자동매칭과 대시보드를 제공하는 오프라인 PWA.
서버 없이 브라우저(폰)에서만 동작하며, 모든 데이터는 기기의 localStorage에만 저장됩니다.

## 주요 기능

- 회원 명단 / 핸디 관리
- 날짜별 모임 · 참석 체크
- 코트 그리드 기반 1:1 자동매칭 (가장 안 만난 짝 우선)
- 3구 달성률(친 개수 ÷ 핸디) 기반 승패 기록
- 대시보드: 승률 랭킹 · 날짜별 기록 · 상대전적 · 개인 추이/연승
- JSON/CSV 백업 내보내기·가져오기, 결과 텍스트/이미지 공유

## 개발

```bash
npm install
npm run dev      # 개발 서버
npm test         # 로직 테스트 (Vitest)
npm run build    # 프로덕션 빌드
```

## 기술 스택

React · TypeScript · Vite · zustand · vite-plugin-pwa

## 배포

`main` 브랜치에 push하면 GitHub Actions가 빌드해 GitHub Pages로 자동 배포합니다.

## 개인정보

회원 실명 등 개인 데이터(`*.csv`, `billiards-seed-import.json`)는 저장소에 포함되지 않습니다.
데이터는 각자 기기에만 저장되며, 백업 파일은 직접 관리합니다.
