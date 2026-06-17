import type { Session } from '../types'

/** 두 선수 짝의 정규화된 키 (순서 무관). */
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

/** 전체 세션에서 두 선수 누적 맞대결 횟수를 집계. */
export function buildMeetCount(sessions: Session[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of sessions) {
    for (const g of s.games) {
      const k = pairKey(g.playerAId, g.playerBId)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return m
}

export interface MatchContext {
  /** 현재 대기 중(쉬는) 선수 id 목록. */
  waitingIds: string[]
  /** 누적 맞대결 횟수 (buildMeetCount 결과). */
  meetCount: Map<string, number>
  /** 오늘 각 선수가 친 경기 수. */
  todayGameCount: Map<string, number>
  /** 테스트 주입용 난수 생성기 (기본 Math.random). */
  rng?: () => number
  /**
   * 라운드 모드 (정기모임 전용):
   *   r1 — 1부: meetCount 우선, 핸디 차 2점 미만 쌍 회피
   *   r2 — 2부: meetCount 우선, 핸디 허용범위 초과 쌍 회피
   *             (상위핸디 ≥25 → 9점, 23~24 → 7점, ≤22 → 5점)
   */
  roundMode?: 'r1' | 'r2'
  /** 선수 id → 현재 핸디 (roundMode 사용 시 필수) */
  handicapOf?: (id: string) => number
}

export interface Pair {
  aId: string
  bId: string
}

type Triple = [number, number, number]

function less(x: Triple, y: Triple): boolean {
  if (x[0] !== y[0]) return x[0] < y[0]
  if (x[1] !== y[1]) return x[1] < y[1]
  return x[2] < y[2]
}

/** 정기 2라운드 허용 최대 핸디 차이 (두 선수 중 높은 핸디 기준) */
function maxAllowedDiff(higherHandicap: number): number {
  if (higherHandicap >= 25) return 9
  if (higherHandicap >= 23) return 7
  return 5
}

/**
 * 대기자 중 한 짝을 추천.
 *
 * 기본 우선순위: ① 누적 맞대결 적은 순 → ② 오늘 적게 친 순 → ③ 랜덤.
 *
 * roundMode 지정 시 (정기모임):
 *   r1 — ① meetCount → ② 핸디 차 2점 미만 쌍 회피(패널티 1) → ③ 랜덤
 *   r2 — ① meetCount → ② 허용범위 초과 쌍 회피(패널티 1) → ③ 랜덤
 */
export function recommendNext(ctx: MatchContext): Pair | null {
  const ids = ctx.waitingIds
  if (ids.length < 2) return null
  const rng = ctx.rng ?? Math.random
  let best: Pair | null = null
  let bestScore: Triple | null = null
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]
      const b = ids[j]
      const meet = ctx.meetCount.get(pairKey(a, b)) ?? 0
      let score: Triple
      if (ctx.roundMode && ctx.handicapOf) {
        const hA = ctx.handicapOf(a)
        const hB = ctx.handicapOf(b)
        const diff = Math.abs(hA - hB)
        let penalty: number
        if (ctx.roundMode === 'r1') {
          // 1부: 핸디 차 2점 미만이면 패널티
          penalty = diff < 2 ? 1 : 0
        } else {
          // 2부: 허용 범위 초과면 패널티
          penalty = diff > maxAllowedDiff(Math.max(hA, hB)) ? 1 : 0
        }
        score = [meet, penalty, rng()]
      } else {
        const today = (ctx.todayGameCount.get(a) ?? 0) + (ctx.todayGameCount.get(b) ?? 0)
        score = [meet, today, rng()]
      }
      if (bestScore === null || less(score, bestScore)) {
        bestScore = score
        best = { aId: a, bId: b }
      }
    }
  }
  return best
}

/** 대기자 전원을 짝지어 채움(그리디). 홀수면 1명 남김. */
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

/** 금지 대진은 사실상 매칭되지 않도록 큰 가중치를 부여. */
const FORBIDDEN_WEIGHT = 1_000_000

/**
 * 정기모임 2라운드 자동매칭.
 * - 홀수 참가자면 sitOutId(이제한)를 제외한 뒤 매칭.
 * - 1라운드(교육): 핸디 차이 큰 순 → 맞대결 적은 순.
 * - 2라운드(승부): 핸디 차이 작은 순 → 맞대결 적은 순 (1라운드 상대 회피).
 * - forbiddenPairs(예: 엄재익↔이제한)는 서로 매칭하지 않음.
 */
export function matchTwoRounds(
  allIds: string[],
  meetCount: Map<string, number>,
  sitOutId: string | null,
  forbiddenPairs?: Set<string>,
  handicapOf?: (id: string) => number,
): { round1: Pair[]; round2: Pair[] } {
  let ids = [...allIds]

  // 홀수면 sitOutId 제외
  if (ids.length % 2 !== 0 && sitOutId && ids.includes(sitOutId)) {
    ids = ids.filter((id) => id !== sitOutId)
  }

  // 금지 대진에 큰 가중치를 부여한 기준 맵
  const base = new Map(meetCount)
  if (forbiddenPairs) {
    for (const k of forbiddenPairs) base.set(k, (base.get(k) ?? 0) + FORBIDDEN_WEIGHT)
  }

  const empty = new Map<string, number>()

  // 1라운드 — meetCount 우선, 핸디 차 2점 미만 쌍 회피
  const round1 = matchAll({
    waitingIds: ids,
    meetCount: base,
    todayGameCount: empty,
    ...(handicapOf ? { roundMode: 'r1' as const, handicapOf } : {}),
  })

  // 2라운드 — 1라운드 상대 회피(+999), meetCount 우선, 허용범위 초과 쌍 회피
  const boosted = new Map(base)
  for (const p of round1) {
    const k = pairKey(p.aId, p.bId)
    boosted.set(k, (boosted.get(k) ?? 0) + 999)
  }
  const round2 = matchAll({
    waitingIds: ids,
    meetCount: boosted,
    todayGameCount: empty,
    ...(handicapOf ? { roundMode: 'r2' as const, handicapOf } : {}),
  })

  return { round1, round2 }
}
