import type { TournamentMatch, TournamentMatchSlot, TournamentResult } from '../types/tournament'
import { calculateBracketSize, generateByeSlots, shuffleWithRng, tournamentMatchId } from './tournamentBracket'
import { roundLabel } from '../components/tournament/tournamentDisplay'

// "추후 합류 슬롯을 가진 자동 리스타트 대진" — 순수 로직(React·Firebase 의존 없음).
//
// 본선 대회와 리스타트 대회는 별개의 대회(Tournament)로 유지한다. 리스타트 대진은 이렇게 생긴다.
//
//   본선(16명)                    리스타트(별도 대회)
//   1차(16강) 패자 8명  ───────▶  1차전 4경기(8명)
//                                   │ 승자 4명
//   2차(8강)  패자 4명  ─(합류)─▶  다음 단계 4경기 = 1차전 승자 1명 + 본선 2차 탈락자 1명
//                                   ▼
//                                  4강 → 결승
//
// - 1차전 대진은 프로그램이 한 번 무작위로 정해 저장한다(다시 섞지 않는다).
// - 다음 단계의 B 자리는 "본선 2차 경기 i의 패자" 자리로 미리 예약된다(playerBJoinFrom). 본선 2차 경기
//   번호 순서가 곧 합류 자리 번호라서 운영진이 고르지 않아도 결과가 항상 같다.
// - 예약 자리는 부전승이 아니다. 합류자가 정해질 때까지 그 경기는 "대기"이고 상대를 자동 진출시키지 않는다.
// - 라운드 이름을 박아 두지 않는다: "본선의 첫 번째 실제 라운드 / 두 번째 라운드"를 구조에서 찾는다.
//
// 부전승: 리스타트 1차전도 일반 대회와 같은 원칙으로 만든다 — 대상 N명이면 N 이상인 가장 작은 2의
// 거듭제곱 자리(calculateBracketSize)를 만들고, 모자란 만큼 부전승을 추첨으로 배정한다(generateByeSlots,
// 한 경기에 부전승 하나). 부전승은 기존과 같은 모양(resultType 'bye', 바로 공식 처리, 다음 자리 자동 채움).
// 본선 부전승 선수는 어떤 경우에도 리스타트 대상(탈락자)이 아니다.
//
// 지원 범위(인원 특례 없이 구조로 판정): 본선 n명, 본선 대진 규모 P라 하면
//   본선 1차 실제 패자 = n − P/2,  본선 2차 탈락자(합류 자리) = P/4,
//   리스타트 1차 생존자 = (리스타트 대진 규모)/2.
// 생존자 수가 합류 자리 수와 같아야 "생존자 1 + 합류자 1"로 다음 단계가 맞게 짜인다 → n > 3P/4 일 때만
// 성립한다(예: 16칸 대진은 13~16명, 32칸은 25~32명, 8칸은 7~8명). 그 밖의 인원은 이유를 돌려주고 만들지 않는다.

export interface RestartSourceAnalysis {
  /** 본선 첫 번째 라운드 경기(경기 번호 순). */
  firstRound: TournamentMatch[]
  /** 본선 두 번째 라운드 경기(경기 번호 순) — 이 경기들의 패자가 합류자가 된다. */
  secondRound: TournamentMatch[]
  /** 리스타트 1차전 경기 수(부전승 포함) = 리스타트 1차 생존자 수 = 합류 자리 수 = 다음 단계 경기 수. */
  w: number
  /** 리스타트 1차전에 들어갈 사람 수 = 본선 1차 실제 경기 수(= 실제 패자 수). */
  entrantCount: number
  /** 리스타트 1차전 부전승 수 = 2w − entrantCount. */
  restartByeCount: number
}

/** 본선 경기 목록에서 리스타트 대진을 만들 수 있는 구조인지 확인한다. */
export function analyzeRestartSource(sourceMatches: TournamentMatch[]): TournamentResult<RestartSourceAnalysis> {
  const main = sourceMatches.filter((m) => m.playerCountInRound !== 3) // 3·4위전 제외
  const rounds = [...new Set(main.map((m) => m.roundNumber))].sort((a, b) => a - b)
  if (rounds.length < 3) {
    return { ok: false, message: '본선이 8명 이상인 대회에서만 자동 리스타트 대진을 만들 수 있습니다.' }
  }
  const byNumber = (a: TournamentMatch, b: TournamentMatch) => a.matchNumber - b.matchNumber
  const firstRound = main.filter((m) => m.roundNumber === rounds[0]).sort(byNumber)
  const secondRound = main.filter((m) => m.roundNumber === rounds[1]).sort(byNumber)
  const entrantCount = firstRound.filter((m) => m.resultType !== 'bye').length
  const w = secondRound.length // 합류 자리 수(본선 2차 경기는 모두 실제 경기다)
  if (w < 2 || firstRound.length !== w * 2) {
    return { ok: false, message: '본선 대진 구조가 맞지 않아 자동 리스타트 대진을 만들 수 없습니다.' }
  }
  // 리스타트 1차전도 일반 대회와 같은 규칙으로 자리 수를 정한다. 그 생존자 수(자리 수 / 2)가 합류 자리 수와
  // 같아야만 다음 단계가 "1차전 생존자 1명 + 합류자 1명" 경기로 맞게 짜인다.
  const size = calculateBracketSize(entrantCount)
  const survivors = size.ok ? size.value.bracketSize / 2 : 0
  if (survivors !== w) {
    return {
      ok: false,
      message: `본선 1차 실제 탈락자가 ${entrantCount}명이라 리스타트 1차 생존자(${survivors}명)와 `
        + `본선 2차 탈락자(${w}명) 수가 맞지 않아 자동 리스타트 대진을 만들 수 없습니다.`,
    }
  }
  return { ok: true, value: { firstRound, secondRound, w, entrantCount, restartByeCount: w * 2 - entrantCount } }
}

export interface RestartFirstRoundStatus {
  /** 최종 승인된 1차 실제 경기 수 / 1차 실제 경기 수(부전승 제외). */
  officialCount: number
  total: number
  /** 최종 승인된 1차 경기의 패자(리스타트 1차전 대상). */
  losers: { participantId: string; memberId: string }[]
  ready: boolean
}

/** 본선 1차 실제 경기가 전부 최종 승인(official)됐는지, 그 패자는 누구인지. 승인 전 경기·부전승은 반영하지 않는다. */
export function restartFirstRoundStatus(analysis: RestartSourceAnalysis): RestartFirstRoundStatus {
  const losers: RestartFirstRoundStatus['losers'] = []
  for (const m of analysis.firstRound) {
    if (m.status !== 'official' || !m.officialLoserParticipantId) continue
    const memberId = m.officialLoserParticipantId === m.playerAParticipantId ? m.playerAMemberId : m.playerBMemberId
    if (memberId) losers.push({ participantId: m.officialLoserParticipantId, memberId })
  }
  return {
    officialCount: losers.length,
    total: analysis.entrantCount,
    losers,
    ready: losers.length === analysis.entrantCount,
  }
}

export interface RestartEntrant {
  /** 리스타트 대회 안에서의 참가자 id. */
  participantId: string
  memberId: string
  /** 리스타트 대회에서 적용할 핸디(참가자 문서의 tournamentHandicap). */
  handicap: number
}

/**
 * 본선 2차 경기 i의 두 선수(후보 합류자)가 본선 1차에서 이긴 상대(= 리스타트 1차전 참가자)의 회원 id.
 * 합류자가 리스타트 1차전 승자와 바로 다시 붙는 "즉시 재대결"을 피하는 데 쓴다.
 */
function previouslyBeatenBy(second: TournamentMatch, source: TournamentMatch[]): Set<string> {
  const beaten = new Set<string>()
  for (const playerId of [second.playerAParticipantId, second.playerBParticipantId]) {
    if (!playerId) continue
    const first = source.find((m) => m.status === 'official' && m.officialWinnerParticipantId === playerId
      && m.roundNumber === second.roundNumber - 1)
    if (!first?.officialLoserParticipantId) continue
    const loserMember = first.officialLoserParticipantId === first.playerAParticipantId
      ? first.playerAMemberId : first.playerBMemberId
    if (loserMember) beaten.add(loserMember)
  }
  return beaten
}

/**
 * 1차전 경기(쌍) k를 다음 단계 경기 슬롯 i에 연결하는 순서를 정한다. 쌍 k의 참가자가 슬롯 i의
 * 후보 합류자에게 본선 1차에서 진 적이 없도록(= 즉시 재대결이 없도록) 순서대로 시도하고,
 * 그런 배정이 없으면 기본 순서(k → k)를 쓴다. 같은 입력이면 항상 같은 결과다.
 */
function chooseFeederOrder(pairs: RestartEntrant[][], forbidden: Set<string>[]): { order: number[]; avoided: boolean } {
  const w = pairs.length
  const order: number[] = new Array(w).fill(-1)
  const used: boolean[] = new Array(w).fill(false)
  const place = (k: number): boolean => {
    if (k === w) return true
    for (let slot = 0; slot < w; slot++) {
      if (used[slot]) continue
      if (pairs[k].some((e) => forbidden[slot].has(e.memberId))) continue
      used[slot] = true
      order[k] = slot
      if (place(k + 1)) return true
      used[slot] = false
    }
    return false
  }
  // 경기 수가 아주 많으면(방어) 탐색 대신 기본 순서만 쓴다.
  if (w <= 8 && place(0)) return { order, avoided: true }
  return { order: pairs.map((_, k) => k), avoided: false }
}

export interface RestartBracketResult {
  matches: TournamentMatch[]
  /** 즉시 재대결을 피하는 배치를 찾았는지(못 찾으면 기본 순서). */
  rematchAvoided: boolean
}

/**
 * 리스타트 대진 전체(1차전 + 합류 예약 자리가 있는 다음 단계 + 이후 라운드)를 만든다.
 * 같은 rng와 입력이면 항상 같은 결과다 — 한 번 만든 뒤에는 저장된 경기 문서가 기준이라 다시 섞이지 않는다.
 */
export function buildRestartBracket(input: {
  sourceTournamentId: string
  analysis: RestartSourceAnalysis
  sourceMatches: TournamentMatch[]
  entrants: RestartEntrant[]
  rng?: () => number
}): TournamentResult<RestartBracketResult> {
  const { sourceTournamentId, analysis, sourceMatches, entrants, rng = Math.random } = input
  const w = analysis.w
  if (entrants.length !== analysis.entrantCount) {
    return { ok: false, message: `리스타트 1차전 참가자가 ${analysis.entrantCount}명이어야 합니다. (현재 ${entrants.length}명)` }
  }
  if (new Set(entrants.map((e) => e.memberId)).size !== entrants.length) {
    return { ok: false, message: '리스타트 1차전 참가자에 같은 회원이 중복되어 있습니다.' }
  }

  // 사람 순서를 섞고, 부전승 자리는 일반 대회와 같은 함수(generateByeSlots: 한 경기에 하나, 무작위)로 고른 뒤
  // 남은 자리에 섞인 순서대로 앉힌다. 누가 부전승인지는 추첨으로 정해지고 운영진이 고르지 않는다.
  // 부전승이 없으면 이전과 완전히 같은 결과다(generateByeSlots가 난수를 쓰지 않음).
  const shuffled = shuffleWithRng(entrants, rng)
  const byeSlots = generateByeSlots(w * 2, analysis.restartByeCount, rng)
  if (!byeSlots.ok) return byeSlots
  const empty = new Set(byeSlots.value)
  const pairs: RestartEntrant[][] = []
  let cursor = 0
  for (let k = 0; k < w; k++) {
    const pair: RestartEntrant[] = []
    for (const slot of [k * 2 + 1, k * 2 + 2]) {
      if (!empty.has(slot)) pair.push(shuffled[cursor++])
    }
    pairs.push(pair)
  }
  const forbidden = analysis.secondRound.map((m) => previouslyBeatenBy(m, sourceMatches))
  const { order, avoided } = chooseFeederOrder(pairs, forbidden)

  const blank = (id: string, roundNumber: number, playerCountInRound: number, matchNumber: number,
    next: { nextMatchId: string | null; nextSlot: TournamentMatchSlot | null }): TournamentMatch => ({
    id, roundNumber, playerCountInRound, matchNumber,
    playerAParticipantId: null, playerBParticipantId: null, playerAMemberId: null, playerBMemberId: null,
    playerAHandicapSnapshot: null, playerBHandicapSnapshot: null,
    scoreA: null, scoreB: null, resultType: 'normal', status: 'awaitingResult', ...next,
  })

  const matches: TournamentMatch[] = []

  // 1라운드(리스타트 1차전): 승자는 order[k]번째 다음 단계 경기의 A 자리로 간다.
  // 라운드 이름은 일반 대진의 관례(남은 선수 수)를 따라 "다음 단계의 2배"로 둔다(예: 4경기면 16강).
  // 혼자 들어간 경기는 기존 부전승과 같은 모양으로 바로 공식 처리하고, 승자를 다음 단계 A 자리에 올린다.
  const promotedToA = new Map<string, RestartEntrant>()
  pairs.forEach((pair, k) => {
    const m = blank(tournamentMatchId(1, k + 1), 1, w * 4, k + 1, {
      nextMatchId: tournamentMatchId(2, order[k] + 1), nextSlot: 'playerA',
    })
    m.playerAParticipantId = pair[0].participantId
    m.playerAMemberId = pair[0].memberId
    m.playerAHandicapSnapshot = pair[0].handicap
    if (pair.length === 2) {
      m.playerBParticipantId = pair[1].participantId
      m.playerBMemberId = pair[1].memberId
      m.playerBHandicapSnapshot = pair[1].handicap
    } else {
      m.resultType = 'bye'
      m.status = 'official'
      m.officialWinnerParticipantId = pair[0].participantId
      m.officialLoserParticipantId = null
      promotedToA.set(m.nextMatchId!, pair[0])
    }
    matches.push(m)
  })

  // 2라운드(합류 단계): A는 1차전 승자가 채우고, B는 본선 2차 경기 i의 패자 자리로 예약한다.
  analysis.secondRound.forEach((source, i) => {
    const m = blank(tournamentMatchId(2, i + 1), 2, w * 2, i + 1, w === 1
      ? { nextMatchId: null, nextSlot: null }
      : { nextMatchId: tournamentMatchId(3, Math.ceil((i + 1) / 2)), nextSlot: (i + 1) % 2 === 1 ? 'playerA' : 'playerB' })
    m.playerBJoinFrom = { tournamentId: sourceTournamentId, matchId: source.id }
    m.playerBJoinLabel = `본선 ${roundLabel(source.playerCountInRound)} 탈락자 합류 예정`
    const byeWinner = promotedToA.get(m.id)
    if (byeWinner) {
      m.playerAParticipantId = byeWinner.participantId
      m.playerAMemberId = byeWinner.memberId
      m.playerAHandicapSnapshot = byeWinner.handicap
    }
    matches.push(m)
  })

  // 3라운드부터는 일반 토너먼트와 같은 구조(홀수 경기 승자 → 다음 경기 A, 짝수 → B).
  for (let round = 3, count = w / 2; count >= 1; round++, count /= 2) {
    for (let n = 1; n <= count; n++) {
      matches.push(blank(tournamentMatchId(round, n), round, count * 2, n, count === 1
        ? { nextMatchId: null, nextSlot: null }
        : { nextMatchId: tournamentMatchId(round + 1, Math.ceil(n / 2)), nextSlot: n % 2 === 1 ? 'playerA' : 'playerB' }))
    }
  }

  return { ok: true, value: { matches, rematchAvoided: avoided } }
}

export interface RestartJoin {
  /** 리스타트 대회의 경기 id(B 자리를 채울 경기). */
  restartMatchId: string
  /** 본선 경기의 패자 — 본선 대회 안에서의 참가자 id와 회원 id. */
  sourceParticipantId: string
  memberId: string
}

/**
 * 지금 채울 수 있는 합류 자리를 계산한다. 조건은 전부 "본선 경기가 최종 승인(official)된 실제 경기"일 때뿐이고,
 * 이미 채워진 자리는 절대 다시 건드리지 않는다(중복 배치·덮어쓰기 없음). 승인 대기 결과는 반영하지 않는다.
 * 결과 순서는 리스타트 경기 번호 순이라 항상 같다.
 */
export function pendingRestartJoins(
  restartMatches: TournamentMatch[],
  sourceMatches: TournamentMatch[],
): RestartJoin[] {
  const joins: RestartJoin[] = []
  const used = new Set<string>()
  for (const m of [...restartMatches].sort((a, b) => a.roundNumber - b.roundNumber || a.matchNumber - b.matchNumber)) {
    if (!m.playerBJoinFrom || m.playerBParticipantId) continue
    const source = sourceMatches.find((s) => s.id === m.playerBJoinFrom!.matchId)
    if (!source || source.status !== 'official' || source.resultType === 'bye' || !source.officialLoserParticipantId) continue
    const loserId = source.officialLoserParticipantId
    const memberId = loserId === source.playerAParticipantId ? source.playerAMemberId : source.playerBMemberId
    if (!memberId || used.has(memberId)) continue
    used.add(memberId)
    joins.push({ restartMatchId: m.id, sourceParticipantId: loserId, memberId })
  }
  return joins
}

/** 합류 예약 자리 현황 — 화면 안내용. */
export function restartJoinProgress(restartMatches: TournamentMatch[]): { filled: number; total: number } {
  const slots = restartMatches.filter((m) => m.playerBJoinFrom)
  return { filled: slots.filter((m) => m.playerBParticipantId).length, total: slots.length }
}
