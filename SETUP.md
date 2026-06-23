# 다른 컴퓨터에서 셋업하기 — 명령 모음

> 새 컴퓨터에서 이 프로젝트를 받아 작업하기 위한 복붙용 명령 모음.
> 저장소: https://github.com/mujehan6416-jpg/billiards-club-tracker (기본 브랜치 `main`)

## 0. 사전 설치 (새 컴퓨터에 한 번)
- Git
- Node.js 20 (LTS) — `node -v` 로 확인
- (선택) GitHub CLI `gh` — 인증이 가장 간편함

## 1. 최초 1회 — 클론 & 설치
```bash
# 원하는 위치로 이동 (예: Windows)
cd /c/cc        # 폴더 없으면: mkdir -p /c/cc && cd /c/cc

# 코드 받기
git clone https://github.com/mujehan6416-jpg/billiards-club-tracker.git
cd billiards-club-tracker

# 의존성 설치
npm install
```

### GitHub 인증 (push 하려면 1회 필요)
```bash
# 방법 A) GitHub CLI (가장 쉬움 — 브라우저 로그인)
gh auth login

# 방법 B) 사용자 정보만 설정 (HTTPS + Personal Access Token 사용 시)
git config --global user.name  "내이름"
git config --global user.email "mujehan6416@gmail.com"
```

## 2. 평소 작업 흐름 (양쪽 컴퓨터 공통)
```bash
git pull            # ① 작업 전: 최신 코드 받기 (항상 먼저!)
npm install         # package.json 바뀌었을 때만

npm run dev         # 개발 서버 (작업/확인)

git add -A
git commit -m "변경 내용 설명"
git push            # ② 작업 후: 올리기  (push 시 GitHub Actions가 자동 배포)
```

> 핵심 습관: **시작할 때 `git pull`, 끝낼 때 `git push`.** 순서를 지켜야 두 컴퓨터가 안 꼬임.

## 3. 자주 쓰는 명령
```bash
npm run dev         # 개발 서버
npm test            # 로직 테스트 (Vitest)
npm run build       # 프로덕션 빌드 (tsc + vite build)
npm run preview     # 빌드 결과 미리보기

git status          # 변경 상태 확인
git log --oneline -5  # 최근 커밋 5개
```

## 4. 알아둘 점
- **앱 데이터**(회원·경기·회계)는 Firebase Firestore 클라우드에 있어 어느 기기서든 동일.
- **관리자 PIN / 로그인**은 브라우저별로 따로 (새 기기 기본 PIN `1234`).
- **`node_modules`는 git에 없음** → 새 컴퓨터선 반드시 `npm install`.
- 폴더를 USB로 통째 복사하지 말 것 — 반드시 `git clone`으로 받기.
- 내부 메모 `TROUBLESHOOTING.md`는 .gitignore라 클론으로 안 따라옴 (필요하면 따로 복사).
- Claude Code의 기억(작업 경로 등)은 컴퓨터별로 따로 → 새 컴퓨터선 처음 한 번 알려줘야 함.
