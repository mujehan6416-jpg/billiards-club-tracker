import type { Session } from '../types'
import { hasRecordedResult } from './game'

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

/** 금지 대진에 큰 가중치를 부여한 기준 맵을 만든다(원본 meetCount는 건드리지 않음). */
function withForbidden(meetCount: Map<string, number>, forbiddenPairs?: Set<string>): Map<string, number> {
  const base = new Map(meetCount)
  if (forbiddenPairs) {
    for (const k of forbiddenPairs) base.set(k, (base.get(k) ?? 0) + FORBIDDEN_WEIGHT)
  }
  return base
}

/**
 * 정기모임 1라운드 자동매칭 — 관리자가 이번 라운드 참가자로 선택한 인원(ids)만 매칭한다.
 * 미대진자 지정은 호출부(관리자 선택)에서 이미 끝난 상태로 ids를 넘겨야 한다.
 * 핸디 차 2점 미만 쌍은 회피(roundMode: 'r1'), meetCount(누적 맞대결) 적은 순 우선.
 */
export function matchRoundOne(
  ids: string[],
  meetCount: Map<string, number>,
  forbiddenPairs?: Set<string>,
  handicapOf?: (id: string) => number,
): Pair[] {
  return matchAll({
    waitingIds: ids,
    meetCount: withForbidden(meetCount, forbiddenPairs),
    todayGameCount: new Map(),
    ...(handicapOf ? { roundMode: 'r1' as const, handicapOf } : {}),
  })
}

/**
 * 정기모임 2라운드 자동매칭 — round1Pairs(이미 확정된 1라운드 대진)와 겹치지 않도록 회피하면서
 * 관리자가 선택한 2라운드 참가자(ids)만 매칭한다. 1라운드를 다시 계산하지 않으므로, 1라운드
 * 대진·결과가 이미 있어도 2라운드만 독립적으로 (재)매칭할 수 있다.
 * 허용 핸디 차 초과 쌍은 회피(roundMode: 'r2'), meetCount 적은 순 우선.
 */
export function matchRoundTwo(
  ids: string[],
  meetCount: Map<string, number>,
  round1Pairs: Pair[],
  forbiddenPairs?: Set<string>,
  handicapOf?: (id: string) => number,
): Pair[] {
  const boosted = withForbidden(meetCount, forbiddenPairs)
  for (const p of round1Pairs) {
    const k = pairKey(p.aId, p.bId)
    boosted.set(k, (boosted.get(k) ?? 0) + 999)
  }
  return matchAll({
    waitingIds: ids,
    meetCount: boosted,
    todayGameCount: new Map(),
    ...(handicapOf ? { roundMode: 'r2' as const, handicapOf } : {}),
  })
}

/**
 * 1·2라운드를 한 번에 자동매칭하는 편의 함수(각 라운드 참가자 명단을 독립적으로 받는다 —
 * 두 라운드 참가자가 같을 필요는 없다. 예: 2라운드에 늦참자가 추가되거나 중도 귀가자가 빠진 경우).
 * 미대진자(홀수 처리 포함) 지정은 호출부에서 round1Ids/round2Ids를 만들 때 이미 끝나 있어야 한다.
 */
export function matchTwoRounds(
  round1Ids: string[],
  round2Ids: string[],
  meetCount: Map<string, number>,
  forbiddenPairs?: Set<string>,
  handicapOf?: (id: string) => number,
): { round1: Pair[]; round2: Pair[] } {
  const round1 = matchRoundOne(round1Ids, meetCount, forbiddenPairs, handicapOf)
  const round2 = matchRoundTwo(round2Ids, meetCount, round1, forbiddenPairs, handicapOf)
  return { round1, round2 }
}

// ────────────────────────────────────────────────────────────
// 라운드 재매칭 가능 여부 / 참가자 선택 상태 — MeetingTab에서 그대로 가져다 쓰는 순수 함수
// ────────────────────────────────────────────────────────────

/** 해당 라운드에 실제로 저장된 경기 결과(hasRecordedResult 기준)가 하나라도 있는지. */
export function hasRoundResults(session: Session, round: number): boolean {
  return session.games.some((g) => g.round === round && hasRecordedResult(g))
}

/**
 * 해당 라운드를 재매칭(자동/수동 대진을 다시 만들기)해도 되는지 — 저장된 결과가 하나도
 * 없어야 true. 대진만 생성되고(ongoing/session.lineup) 점수가 아직 없는 상태는 session.games에
 * 들어가지 않으므로 이 판정에 영향을 주지 않는다(=재매칭 허용).
 */
export function canRematchRound(session: Session, round: number): boolean {
  return !hasRoundResults(session, round)
}

/** Set에서 id 하나를 토글(있으면 제거, 없으면 추가)한 새 Set을 반환한다. */
export function toggleParticipant(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  next.has(id) ? next.delete(id) : next.add(id)
  return next
}

/** round가 일치하는 항목만 replacement로 교체하고, 나머지 라운드 항목은 그대로 보존한다. */
export function replaceRound<T extends { round?: number }>(list: T[], round: number, replacement: T[]): T[] {
  return [...list.filter((item) => item.round !== round), ...replacement]
}

/**
 * 참석자가 새로 추가됐을 때(늦참) 라운드별 참가자 선택 상태를 어떻게 반영할지 계산한다.
 * - 2라운드 선택: 늦참자를 항상 기본 선택 상태로 추가한다(참가 여부는 관리자가 그대로 해제 가능).
 * - 1라운드 선택: 1라운드가 아직 시작 전(round1Started=false)이면 함께 추가하지만,
 *   이미 시작됐으면(대진·결과가 있으면) 절대 건드리지 않는다.
 */
export function applyNewAttendees(
  prevAttendeeIds: string[],
  currentAttendeeIds: string[],
  round1Sel: Set<string>,
  round2Sel: Set<string>,
  round1Started: boolean,
): { round1Sel: Set<string>; round2Sel: Set<string> } {
  const added = currentAttendeeIds.filter((id) => !prevAttendeeIds.includes(id))
  if (added.length === 0) return { round1Sel, round2Sel }
  const nextRound2 = new Set([...round2Sel, ...added])
  const nextRound1 = round1Started ? round1Sel : new Set([...round1Sel, ...added])
  return { round1Sel: nextRound1, round2Sel: nextRound2 }
}
