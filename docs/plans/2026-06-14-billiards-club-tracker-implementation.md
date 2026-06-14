# 당구 동호회 기록 PWA 구현 계획

> 작성일: 2026-06-14
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 3구 1:1 경기 결과를 기록하고, 코트 그리드 기반 자동매칭과 대시보드를 제공하며, 폰에 설치되는 오프라인 PWA를 만든다.

**Architecture:** 서버 없는 단일 클라이언트 SPA. 모든 데이터는 `AppState` 하나로 zustand + persist(localStorage)에 저장. 순수 로직(승패·매칭·통계)은 부수효과 없는 함수로 분리해 Vitest로 TDD. UI는 React 함수형 컴포넌트 4탭. 백업은 JSON/CSV 파일 내보내기·가져오기, 공유는 이미지/텍스트 export.

**Tech Stack:** React 18, TypeScript, Vite, vite-plugin-pwa, zustand(persist), Vitest, html-to-image. 차트/라우터 등 무거운 의존성은 도입하지 않음(YAGNI).

---

## 프로젝트 정책 (중요)

- **테스트/빌드 명령은 Claude가 자동 실행하지 않는다.** 각 "Run" 단계는 사용자에게 실행을 요청하고, 사용자가 결과를 확인해준 뒤 다음 단계로 진행한다.
- **커밋은 사용자 확인 후에만 한다.** 각 Task 끝의 commit 단계는 사용자가 변경을 리뷰하고 승인하면 수행한다.
- 시간 추정치는 작성하지 않는다.

---

## 디렉터리 구조 (목표)

```
jehan/
├─ public/                 아이콘, manifest 보조
├─ src/
│  ├─ types.ts             도메인 타입
│  ├─ logic/
│  │  ├─ game.ts           승패/달성률 계산
│  │  ├─ matching.ts       매칭 엔진
│  │  └─ stats.ts          대시보드 통계 파생
│  ├─ store/
│  │  └─ appStore.ts       zustand + persist
│  ├─ lib/
│  │  ├─ backup.ts         JSON/CSV export·import
│  │  └─ share.ts          이미지/텍스트 export
│  ├─ components/          공용 UI
│  ├─ tabs/
│  │  ├─ MembersTab.tsx
│  │  ├─ MeetingTab.tsx    코트 그리드
│  │  ├─ DashboardTab.tsx
│  │  └─ SettingsTab.tsx
│  ├─ App.tsx              하단 탭 네비
│  └─ main.tsx
├─ tests/                  Vitest (logic 미러링)
└─ vite.config.ts
```

---

## Phase 0: 프로젝트 셋업

### Task 0.1: Vite + React + TS 스캐폴딩

**Files:**
- Create: 프로젝트 전체 (`package.json`, `vite.config.ts`, `src/main.tsx`, `index.html` 등)

**Step 1:** 작업 디렉터리 `/Users/choeeun-u/project/cc/jehan`에서 스캐폴딩.
Run (사용자 실행): `npm create vite@latest . -- --template react-ts`
Expected: 현재 폴더에 Vite React-TS 템플릿 생성 (기존 `docs/`는 보존).

**Step 2:** 의존성 설치.
Run (사용자 실행): `npm install`
Expected: 설치 완료, `npm run dev`로 기본 페이지 확인 가능.

**Step 3:** git 저장소 초기화 (아직 repo 아님).
Run (사용자 실행): `git init && git add -A`
Expected: 인덱스에 파일 스테이징.

**Step 4 (commit, 사용자 승인 후):**
```bash
git commit -m "chore: scaffold vite react-ts project"
```

### Task 0.2: 추가 의존성 + Vitest 설정

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts` (또는 `vite.config.ts`에 test 설정)

**Step 1:** 런타임/개발 의존성 설치.
Run (사용자 실행):
```bash
npm install zustand html-to-image
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom vite-plugin-pwa
```

**Step 2:** `vite.config.ts`에 Vitest + PWA 설정 추가.
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '당구 동호회 기록',
        short_name: '당구기록',
        theme_color: '#1d9e75',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  test: { environment: 'jsdom', globals: true, setupFiles: './tests/setup.ts' },
})
```

**Step 3:** `tests/setup.ts` 생성.
```ts
import '@testing-library/jest-dom'
```

**Step 4:** `package.json` scripts에 `"test": "vitest"` 추가.

**Step 5 (commit, 사용자 승인 후):**
```bash
git add -A && git commit -m "chore: add zustand, vitest, vite-plugin-pwa"
```

---

## Phase 1: 도메인 타입 & 핵심 로직 (TDD)

### Task 1.1: 도메인 타입 정의

**Files:**
- Create: `src/types.ts`

**Step 1:** 타입 작성.
```ts
export interface HandicapChange {
  value: number
  changedAt: string // ISO datetime
}

export interface Member {
  id: string
  name: string
  handicap: number            // 현재 핸디(=목표 개수)
  handicapHistory: HandicapChange[]
  active: boolean
}

export type GameEndType = 'cleared' | 'time'

export interface Game {
  id: string
  playerAId: string
  playerBId: string
  handicapA: number           // 경기 시점 스냅샷
  handicapB: number
  scoreA: number              // 실제 친 개수
  scoreB: number
  endType: GameEndType
  playedAt: string            // ISO datetime
}

export interface Session {
  id: string
  date: string                // YYYY-MM-DD
  attendeeIds: string[]
  games: Game[]
}

export interface AppState {
  members: Member[]
  sessions: Session[]
  settings: { lastBackupAt: string | null }
}
```

**Step 2 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: domain types"`

### Task 1.2: 승패/달성률 계산 (TDD)

**Files:**
- Create: `src/logic/game.ts`
- Test: `tests/game.test.ts`

**Step 1: 실패 테스트 작성** — `tests/game.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { rate, winnerId } from '../src/logic/game'
import type { Game } from '../src/types'

const base: Omit<Game, 'scoreA' | 'scoreB' | 'handicapA' | 'handicapB'> = {
  id: 'g1', playerAId: 'A', playerBId: 'B', endType: 'time', playedAt: '2026-06-14T10:00:00Z',
}

describe('rate', () => {
  it('점수/핸디 비율', () => {
    expect(rate(20, 25)).toBeCloseTo(0.8)
    expect(rate(15, 20)).toBeCloseTo(0.75)
  })
  it('핸디 0이면 0', () => expect(rate(5, 0)).toBe(0))
})

describe('winnerId', () => {
  it('달성률 높은 쪽 승 (A 80% vs B 75%)', () => {
    const g: Game = { ...base, handicapA: 25, handicapB: 20, scoreA: 20, scoreB: 15 }
    expect(winnerId(g)).toBe('A')
  })
  it('핸디 먼저 달성한 쪽 승 (A 25/25)', () => {
    const g: Game = { ...base, endType: 'cleared', handicapA: 25, handicapB: 20, scoreA: 25, scoreB: 18 }
    expect(winnerId(g)).toBe('A')
  })
  it('달성률 동일하면 무승부(null)', () => {
    const g: Game = { ...base, handicapA: 20, handicapB: 10, scoreA: 10, scoreB: 5 }
    expect(winnerId(g)).toBeNull()
  })
})
```

**Step 2: 테스트 실패 확인**
Run (사용자 실행): `npx vitest run tests/game.test.ts`
Expected: FAIL — `rate`/`winnerId` 미정의.

**Step 3: 최소 구현** — `src/logic/game.ts`
```ts
import type { Game } from '../types'

export function rate(score: number, handicap: number): number {
  if (handicap <= 0) return 0
  return score / handicap
}

export function winnerId(game: Game): string | null {
  const rA = rate(game.scoreA, game.handicapA)
  const rB = rate(game.scoreB, game.handicapB)
  if (rA > rB) return game.playerAId
  if (rB > rA) return game.playerBId
  return null
}
```

**Step 4: 테스트 통과 확인**
Run (사용자 실행): `npx vitest run tests/game.test.ts`
Expected: PASS (전체 케이스).

**Step 5 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: 달성률 기반 승패 계산"`

### Task 1.3: 매칭 엔진 (TDD)

**Files:**
- Create: `src/logic/matching.ts`
- Test: `tests/matching.test.ts`

**Step 1: 실패 테스트 작성** — `tests/matching.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { pairKey, buildMeetCount, recommendNext, matchAll } from '../src/logic/matching'
import type { Session } from '../src/types'

function game(a: string, b: string) {
  return { id: a + b, playerAId: a, playerBId: b, handicapA: 20, handicapB: 20, scoreA: 1, scoreB: 0, endType: 'time' as const, playedAt: '' }
}

describe('pairKey', () => {
  it('순서 무관 동일 키', () => expect(pairKey('A', 'B')).toBe(pairKey('B', 'A')))
})

describe('buildMeetCount', () => {
  it('누적 맞대결 횟수 집계', () => {
    const sessions: Session[] = [
      { id: 's1', date: '2026-06-01', attendeeIds: ['A','B','C'], games: [game('A','B'), game('A','B'), game('A','C')] },
    ]
    const m = buildMeetCount(sessions)
    expect(m.get(pairKey('A','B'))).toBe(2)
    expect(m.get(pairKey('A','C'))).toBe(1)
  })
})

describe('recommendNext', () => {
  it('가장 안 만난 짝 우선', () => {
    const meetCount = new Map([[pairKey('A','B'), 3], [pairKey('A','C'), 0]])
    const p = recommendNext({ waitingIds: ['A','B','C'], meetCount, todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('A','C'))
  })
  it('맞대결 같으면 오늘 적게 친 사람 우선', () => {
    const meetCount = new Map<string, number>()
    const today = new Map([['A', 2], ['B', 0], ['C', 0]])
    const p = recommendNext({ waitingIds: ['A','B','C'], meetCount, todayGameCount: today, rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('B','C'))
  })
  it('대기자 1명이면 null', () => {
    expect(recommendNext({ waitingIds: ['A'], meetCount: new Map(), todayGameCount: new Map() })).toBeNull()
  })
})

describe('matchAll', () => {
  it('짝수면 전원 매칭', () => {
    const pairs = matchAll({ waitingIds: ['A','B','C','D'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(2)
  })
  it('홀수면 1명 제외', () => {
    const pairs = matchAll({ waitingIds: ['A','B','C'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(1)
  })
})
```

**Step 2: 실패 확인**
Run (사용자 실행): `npx vitest run tests/matching.test.ts`
Expected: FAIL — 함수 미정의.

**Step 3: 구현** — `src/logic/matching.ts`
```ts
import type { Session } from '../types'

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

export function buildMeetCount(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions)
    for (const g of s.games) {
      const k = pairKey(g.playerAId, g.playerBId)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  return m
}

export interface MatchContext {
  waitingIds: string[]
  meetCount: Map<string, number>
  todayGameCount: Map<string, number>
  rng?: () => number
}

export interface Pair { aId: string; bId: string }

type Triple = [number, number, number]
function less(x: Triple, y: Triple): boolean {
  if (x[0] !== y[0]) return x[0] < y[0]
  if (x[1] !== y[1]) return x[1] < y[1]
  return x[2] < y[2]
}

export function recommendNext(ctx: MatchContext): Pair | null {
  const ids = ctx.waitingIds
  if (ids.length < 2) return null
  const rng = ctx.rng ?? Math.random
  let best: Pair | null = null
  let bestScore: Triple | null = null
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j]
      const meet = ctx.meetCount.get(pairKey(a, b)) ?? 0
      const today = (ctx.todayGameCount.get(a) ?? 0) + (ctx.todayGameCount.get(b) ?? 0)
      const score: Triple = [meet, today, rng()]
      if (bestScore === null || less(score, bestScore)) {
        bestScore = score
        best = { aId: a, bId: b }
      }
    }
  return best
}

export function matchAll(ctx: MatchContext): Pair[] {
  let remaining = [...ctx.waitingIds]
  const today = new Map(ctx.todayGameCount)
  const pairs: Pair[] = []
  while (remaining.length >= 2) {
    const p = recommendNext({ ...ctx, waitingIds: remaining, todayGameCount: today })
    if (!p) break
    pairs.push(p)
    today.set(p.aId, (today.get(p.aId) ?? 0) + 1)
    today.set(p.bId, (today.get(p.bId) ?? 0) + 1)
    remaining = remaining.filter((id) => id !== p.aId && id !== p.bId)
  }
  return pairs
}
```

**Step 4: 통과 확인**
Run (사용자 실행): `npx vitest run tests/matching.test.ts`
Expected: PASS.

**Step 5 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: 매칭 엔진(안 만난 짝 우선)"`

### Task 1.4: 통계 파생 (TDD)

**Files:**
- Create: `src/logic/stats.ts`
- Test: `tests/stats.test.ts`

**Step 1: 실패 테스트** — `tests/stats.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { memberStats, headToHead } from '../src/logic/stats'
import type { Session } from '../src/types'

function g(a: string, b: string, sA: number, hA: number, sB: number, hB: number): any {
  return { id: a+b+sA, playerAId: a, playerBId: b, handicapA: hA, handicapB: hB, scoreA: sA, scoreB: sB, endType: 'time', playedAt: '2026-06-14T10:00:00Z' }
}

const sessions: Session[] = [
  { id: 's1', date: '2026-06-14', attendeeIds: ['A','B'], games: [
    g('A','B', 20,25, 15,20), // A 80% vs B 75% → A 승
    g('A','B', 10,25, 18,20), // A 40% vs B 90% → B 승
  ] },
]

describe('memberStats', () => {
  it('승/패/승률/평균달성률', () => {
    const s = memberStats(sessions).find(m => m.memberId === 'A')!
    expect(s.games).toBe(2)
    expect(s.wins).toBe(1)
    expect(s.losses).toBe(1)
    expect(s.winRate).toBeCloseTo(0.5)
    expect(s.avgRate).toBeCloseTo((0.8 + 0.4) / 2)
  })
})

describe('headToHead', () => {
  it('A vs B 누적', () => {
    const h = headToHead(sessions, 'A', 'B')
    expect(h.aWins).toBe(1)
    expect(h.bWins).toBe(1)
    expect(h.draws).toBe(0)
  })
})
```

**Step 2: 실패 확인**
Run (사용자 실행): `npx vitest run tests/stats.test.ts` → FAIL.

**Step 3: 구현** — `src/logic/stats.ts`
```ts
import type { Session } from '../types'
import { rate, winnerId } from './game'

export interface MemberStat {
  memberId: string
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number
  avgRate: number
}

export function memberStats(sessions: Session[]): MemberStat[] {
  const acc = new Map<string, { g: number; w: number; l: number; d: number; rateSum: number }>()
  const bump = (id: string) => acc.get(id) ?? acc.set(id, { g: 0, w: 0, l: 0, d: 0, rateSum: 0 }).get(id)!
  for (const s of sessions)
    for (const game of s.games) {
      const win = winnerId(game)
      for (const [id, score, hcap] of [
        [game.playerAId, game.scoreA, game.handicapA],
        [game.playerBId, game.scoreB, game.handicapB],
      ] as const) {
        const a = bump(id)
        a.g++
        a.rateSum += rate(score, hcap)
        if (win === null) a.d++
        else if (win === id) a.w++
        else a.l++
      }
    }
  return [...acc.entries()].map(([memberId, a]) => ({
    memberId, games: a.g, wins: a.w, losses: a.l, draws: a.d,
    winRate: a.g ? a.w / a.g : 0,
    avgRate: a.g ? a.rateSum / a.g : 0,
  }))
}

export interface H2H { aWins: number; bWins: number; draws: number; games: number }

export function headToHead(sessions: Session[], aId: string, bId: string): H2H {
  const r: H2H = { aWins: 0, bWins: 0, draws: 0, games: 0 }
  for (const s of sessions)
    for (const game of s.games) {
      const ids = [game.playerAId, game.playerBId]
      if (!ids.includes(aId) || !ids.includes(bId)) continue
      r.games++
      const win = winnerId(game)
      if (win === null) r.draws++
      else if (win === aId) r.aWins++
      else r.bWins++
    }
  return r
}
```

**Step 4: 통과 확인**
Run (사용자 실행): `npx vitest run tests/stats.test.ts` → PASS.

**Step 5 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: 통계 파생(전적/상대전적)"`

> 참고: 개인 추이/연승은 Phase 5에서 `stats.ts`에 `memberTimeline(sessions, memberId)` 추가(시간순 게임 배열 + 연승 계산). 동일 TDD 패턴 적용.

---

## Phase 2: 상태 저장소

### Task 2.1: zustand 스토어 + persist

**Files:**
- Create: `src/store/appStore.ts`

**Step 1:** 스토어 작성 (액션 포함).
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Member, Session, Game } from '../types'

interface Store extends AppState {
  addMember: (name: string, handicap: number) => void
  updateMember: (id: string, patch: Partial<Member>) => void
  setHandicap: (id: string, handicap: number) => void
  setActive: (id: string, active: boolean) => void
  createSession: (date: string, attendeeIds: string[]) => string
  addGame: (sessionId: string, game: Omit<Game, 'id' | 'playedAt'>) => void
  replaceAll: (state: AppState) => void
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export const useApp = create<Store>()(
  persist(
    (set) => ({
      members: [], sessions: [], settings: { lastBackupAt: null },

      addMember: (name, handicap) => set((s) => ({
        members: [...s.members, { id: uid(), name, handicap, active: true,
          handicapHistory: [{ value: handicap, changedAt: now() }] }],
      })),

      updateMember: (id, patch) => set((s) => ({
        members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),

      setHandicap: (id, handicap) => set((s) => ({
        members: s.members.map((m) => m.id === id
          ? { ...m, handicap, handicapHistory: [...m.handicapHistory, { value: handicap, changedAt: now() }] }
          : m),
      })),

      setActive: (id, active) => set((s) => ({
        members: s.members.map((m) => (m.id === id ? { ...m, active } : m)),
      })),

      createSession: (date, attendeeIds) => {
        const id = uid()
        set((s) => ({ sessions: [...s.sessions, { id, date, attendeeIds, games: [] }] }))
        return id
      },

      addGame: (sessionId, game) => set((s) => ({
        sessions: s.sessions.map((ss) => ss.id === sessionId
          ? { ...ss, games: [...ss.games, { ...game, id: uid(), playedAt: now() }] }
          : ss),
      })),

      replaceAll: (state) => set(() => ({ ...state })),
    }),
    { name: 'billiards-club-state' },
  ),
)
```

**Step 2:** 빌드 확인.
Run (사용자 실행): `npm run build`
Expected: 타입 에러 없이 빌드 성공.

**Step 3 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: zustand 스토어(localStorage persist)"`

---

## Phase 3: 회원 탭

### Task 3.1: 회원 목록 + 추가/핸디 수정

**Files:**
- Create: `src/tabs/MembersTab.tsx`
- Modify: `src/App.tsx` (탭 연결)

**Step 1:** `MembersTab` 작성 — 기능: 회원 추가(이름+핸디), 목록 표시(이름·현재핸디·전적요약), 핸디 수정(`setHandicap`), 활성/휴면 토글.
```tsx
import { useState } from 'react'
import { useApp } from '../store/appStore'
import { memberStats } from '../logic/stats'

export function MembersTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const addMember = useApp((s) => s.addMember)
  const setHandicap = useApp((s) => s.setHandicap)
  const setActive = useApp((s) => s.setActive)
  const [name, setName] = useState('')
  const [hcap, setHcap] = useState(20)
  const stats = memberStats(sessions)

  return (
    <div className="tab">
      <h2>회원</h2>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
        <input type="number" value={hcap} onChange={(e) => setHcap(+e.target.value)} />
        <button disabled={!name.trim()} onClick={() => { addMember(name.trim(), hcap); setName('') }}>추가</button>
      </div>
      <ul>
        {members.map((m) => {
          const st = stats.find((s) => s.memberId === m.id)
          return (
            <li key={m.id} style={{ opacity: m.active ? 1 : 0.4 }}>
              <span>{m.name}</span>
              <input type="number" value={m.handicap} onChange={(e) => setHandicap(m.id, +e.target.value)} />
              <span>{st ? `${st.wins}-${st.losses} (${Math.round(st.winRate * 100)}%)` : '기록없음'}</span>
              <button onClick={() => setActive(m.id, !m.active)}>{m.active ? '휴면' : '활성'}</button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

**Step 2:** 사용자가 `npm run dev`로 추가/수정/토글 수기 검증.
Expected: 회원 추가·핸디변경·휴면 토글 동작, 새로고침 후 유지(persist).

**Step 3 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: 회원 탭"`

---

## Phase 4: 모임 탭 (코트 그리드)

### Task 4.1: 모임 생성 + 참석 선택

**Files:**
- Create: `src/tabs/MeetingTab.tsx`

**Step 1:** 오늘 날짜 세션 생성 또는 로드. 회원 체크박스로 참석자 선택 → `createSession(date, attendeeIds)`. 이미 세션 있으면 참석자 편집.

### Task 4.2: 코트 그리드 + 빈 테이블 추천

**Files:**
- Modify: `src/tabs/MeetingTab.tsx`

**Step 1:** 진행중 경기 상태를 로컬 상태로 관리(`ongoing: Pair[]`, `waiting: string[]`). 초기엔 참석자 전원 `waiting`.

**Step 2:** "대기자 전체 매칭" 버튼 → `matchAll` 호출해 `ongoing` 채움. 코트 카드 그리드(2열)로 `ongoing` 표시. 빈 카드는 강조 + "매칭 추천"(`recommendNext`) 버튼. `meetCount`는 `buildMeetCount(sessions)`, `todayGameCount`는 현재 세션 games로 계산.

```tsx
const meetCount = buildMeetCount(sessions)
const todayGameCount = new Map<string, number>()
for (const g of current.games) {
  todayGameCount.set(g.playerAId, (todayGameCount.get(g.playerAId) ?? 0) + 1)
  todayGameCount.set(g.playerBId, (todayGameCount.get(g.playerBId) ?? 0) + 1)
}
```

### Task 4.3: 득점 입력 + 결과 저장

**Files:**
- Modify: `src/tabs/MeetingTab.tsx`

**Step 1:** 코트 카드 탭 → 두 선수 핸디(스냅샷, 회원 현재핸디 기본·수정가능)와 득점 입력. 저장 시 `endType` 판정: `scoreA>=handicapA || scoreB>=handicapB ? 'cleared' : 'time'`. `addGame(sessionId, {...})` 호출 후 두 선수 `waiting` 복귀, 코트 비움.

**Step 2:** 사용자 수기 검증: 전체매칭 → 결과입력 → 두 선수 대기복귀 → 빈 코트 다음추천.

**Step 3 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: 모임 탭(코트 그리드 매칭/득점입력)"`

---

## Phase 5: 대시보드

### Task 5.1: 승률 랭킹
**Files:** Create `src/tabs/DashboardTab.tsx` — `memberStats` 정렬표(경기·승·패·무·승률·평균달성률). 정렬 토글.

### Task 5.2: 날짜별 기록
**Files:** Modify `DashboardTab.tsx` — 세션 선택 → 참석자·경기 결과(달성률·승자) 타임라인.

### Task 5.3: 상대전적
**Files:** Modify `DashboardTab.tsx` — 회원 2명 선택 → `headToHead` 누적 + 경기 리스트.

### Task 5.4: 개인 추이/연승
**Files:** Modify `DashboardTab.tsx`, `src/logic/stats.ts`(`memberTimeline` + 연승 계산, TDD) — 회원 선택 → 시간순 달성률/승패, 최장·현재 연승. 추이는 인라인 SVG 스파크라인(외부 차트 의존성 없이).

**각 Task 끝 (commit, 사용자 승인 후):** 해당 뷰 단위로 커밋.

---

## Phase 6: 백업 & 공유

### Task 6.1: JSON 내보내기/가져오기
**Files:** Create `src/lib/backup.ts`
- `exportJson(state)`: `AppState` → Blob 다운로드(파일명 `billiards-backup-YYYY-MM-DD.json`).
- `importJson(file)`: 파싱·검증(필수 키 존재) → `replaceAll`. 실패 시 사용자 알림.
- 설정 탭에 버튼 연결, 성공 시 `settings.lastBackupAt` 갱신.

### Task 6.2: CSV 내보내기
**Files:** Modify `src/lib/backup.ts`
- `exportCsv(sessions, members)`: 경기 1행 = 날짜, 선수A, 핸디A, 득점A, 선수B, 핸디B, 득점B, 달성률A, 달성률B, 승자. 구글 시트 호환(UTF-8 BOM 포함).

### Task 6.3: 대진표/결과 공유 (이미지/텍스트)
**Files:** Create `src/lib/share.ts`
- `shareImage(domNode)`: `html-to-image`의 `toPng` → 다운로드 또는 `navigator.share`(지원 시).
- `shareText(session)`: 오늘 대진표/결과를 텍스트로 생성 → 클립보드 복사/공유.

**각 Task 끝 (commit, 사용자 승인 후):** 기능 단위 커밋.

---

## Phase 7: PWA 마감

### Task 7.1: 아이콘 & manifest
**Files:** Create `public/icon-192.png`, `public/icon-512.png` — 단색 당구공 모티프. manifest(Task 0.2)와 연결.

### Task 7.2: 설치/오프라인 검증
**Step 1:** 사용자 실행 `npm run build && npm run preview`.
**Step 2:** 폰 브라우저로 접속 → 홈화면 추가 → 비행기모드에서 동작 확인(데이터 유지·매칭·입력).
**Step 3 (commit, 사용자 승인 후):** `git add -A && git commit -m "feat: PWA 아이콘/오프라인"`

---

## 검증 체크포인트

- Phase 1~2 완료 후: `npx vitest run` 전체 통과(사용자 실행). 핵심 로직 신뢰 확보 후 UI 진행.
- 각 탭 완료 후: `npm run dev`로 사용자 수기 검증.
- Phase 7 후: 실제 폰 설치·오프라인 최종 검증.

## 범위 밖 (추후)

구글 시트 API 자동동기화, 멀티유저/로그인, 타 종목(4구·포켓볼), 강제 타이머, 서버/클라우드.
