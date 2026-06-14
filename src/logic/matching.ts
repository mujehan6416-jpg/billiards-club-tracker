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

/**
 * 대기자 중 한 짝을 추천.
 * 우선순위: ① 누적 맞대결 적은 순 → ② 오늘 적게 친 순 → ③ 랜덤.
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
      const today = (ctx.todayGameCount.get(a) ?? 0) + (ctx.todayGameCount.get(b) ?? 0)
      const score: Triple = [meet, today, rng()]
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
