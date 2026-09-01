import type {
  TournamentBracketNode, TournamentMatch, TournamentResult, TournamentSeat,
} from '../types/tournament'

// 단일 탈락 대진표의 뼈대를 만드는 순수 로직.
// React·Firebase에 전혀 의존하지 않는다.
//
// 슬롯 번호 규칙: 1라운드 자리를 왼쪽부터 1..bracketSize로 센다.
// 1라운드 n번째 경기는 항상 슬롯 (2n-1, 2n) 두 자리를 쓴다.
//   경기1 = 슬롯1·슬롯2, 경기2 = 슬롯3·슬롯4, ...
// 2라운드부터는 슬롯이 없다 — 이전 경기 승자가 그 자리를 채우기 때문이다.

/** 경기 id는 라운드·순번으로 정해진다(난수 아님) — 대진을 다시 만들면 같은 id가 나온다. */
export function tournamentMatchId(roundNumber: number, matchNumber: number): string {
  return `r${roundNumber}m${matchNumber}`
}

/** 2의 거듭제곱인지. */
function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0
}

/**
 * 참가자 수를 담을 수 있는 가장 작은 2의 거듭제곱 대진 규모와 부전승 수를 계산한다.
 *
 *   2명 → 2 (부전승 0)   3명 → 4 (부전승 1)   11명 → 16 (부전승 5)   17명 → 32 (부전승 15)
 *
 * 상한을 두지 않는다 — 인원 정책 제한은 화면 단계에서 정한다.
 * 1명 이하는 대진을 만들 수 없으므로 실패로 돌려준다(상대가 없으면 경기가 성립하지 않는다).
 */
export function calculateBracketSize(
  participantCount: number,
): TournamentResult<{ bracketSize: number; byeCount: number }> {
  if (!Number.isInteger(participantCount)) {
    return { ok: false, message: '참가 인원은 정수여야 합니다.' }
  }
  if (participantCount < 2) {
    return { ok: false, message: '대회를 만들려면 참가자가 2명 이상이어야 합니다.' }
  }
  let bracketSize = 2
  while (bracketSize < participantCount) bracketSize *= 2
  return { ok: true, value: { bracketSize, byeCount: bracketSize - participantCount } }
}

/**
 * 주어진 난수원으로 배열을 섞은 **새 배열**을 돌려준다(원본은 건드리지 않는다).
 * rng를 인자로 받는 이유는 기존 logic/matching.ts와 같다 — 테스트가 항상 같은 결과를 내야 한다.
 * 부전승 자리 고르기(이 파일)와 번호↔슬롯 매핑 만들기(tournamentDraw.ts)가 함께 쓴다.
 */
export function shuffleWithRng<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * 부전승으로 비워 둘 자리(슬롯 번호)를 고른다.
 *
 * 공정성 원칙: **참가자 신원·이름·핸디를 전혀 보지 않는다.** 이 함수는 참가자 정보를 인자로
 * 받지도 않으므로, 특정 회원이나 특정 핸디에게 유리하게 배치하는 것이 구조적으로 불가능하다.
 *
 * 한 경기의 두 자리가 모두 비는 일은 없게 한다 — 그러면 아무도 없는 경기가 생긴다.
 * 그래서 서로 다른 경기를 byeCount개 고른 뒤, 각 경기 안에서 두 자리 중 하나를 고른다.
 * (대진 규모 정의상 부전승 수는 언제나 1라운드 경기 수보다 적으므로 항상 가능하다.)
 */
export function generateByeSlots(
  bracketSize: number,
  byeCount: number,
  rng: () => number = Math.random,
): TournamentResult<number[]> {
  if (!isPowerOfTwo(bracketSize) || bracketSize < 2) {
    return { ok: false, message: '대진 규모는 2 이상의 2의 거듭제곱이어야 합니다.' }
  }
  if (!Number.isInteger(byeCount) || byeCount < 0) {
    return { ok: false, message: '부전승 수는 0 이상의 정수여야 합니다.' }
  }
  const matchCount = bracketSize / 2
  if (byeCount > matchCount - 1 && byeCount !== 0) {
    return { ok: false, message: '부전승이 너무 많아 대진을 만들 수 없습니다.' }
  }
  if (byeCount === 0) return { ok: true, value: [] }

  const matchNumbers = shuffleWithRng(
    Array.from({ length: matchCount }, (_, i) => i + 1),
    rng,
  ).slice(0, byeCount)

  const slots = matchNumbers.map((matchNumber) => {
    const first = matchNumber * 2 - 1
    return rng() < 0.5 ? first : first + 1
  })
  return { ok: true, value: slots.sort((a, b) => a - b) }
}

/** 3·4위전 경기 노드의 id — 결승 다음 라운드 번호를 그대로 써서 다른 라운드와 겹치지 않는다. */
export function thirdPlaceMatchId(bracketSize: number): string {
  const totalRounds = Math.log2(bracketSize)
  return tournamentMatchId(totalRounds + 1, 1)
}

/**
 * 참가자가 아직 배치되지 않은 빈 대진 구조를 만든다.
 *
 * 각 경기가 "다음 경기의 어느 자리로 가는지"(nextMatchId·nextSlot)를 여기서 함께 정한다.
 * 같은 라운드에서 홀수 번째 경기의 승자는 다음 경기의 A 자리, 짝수 번째는 B 자리로 간다 —
 * 그래서 8강 1·2경기 승자가 4강 같은 경기의 서로 다른 자리에서 만난다.
 * 결승은 다음 경기가 없으므로 둘 다 null이다.
 *
 * includeThirdPlace를 true로 주면 결승 바로 다음 라운드 번호로 3·4위전 노드를 하나 더
 * 만든다. 이 노드는 처음부터 두 자리 다 비어 있다(slotA/slotB가 없다 — 준결승 패자 두
 * 명이 나중에 채운다. logic/tournamentMatch.ts의 loserPromotionForThirdPlace 참고).
 * nextMatchId·nextSlot도 없다(3·4위전 자체는 어디로도 이어지지 않는 마지막 경기다).
 * 대진 규모가 2(참가자 2명, 준결승이 없음)면 3·4위전을 만들 수 없어 이 옵션을 무시한다.
 */
export function buildEmptyBracket(
  bracketSize: number,
  options: { includeThirdPlace?: boolean } = {},
): TournamentResult<TournamentBracketNode[]> {
  if (!isPowerOfTwo(bracketSize) || bracketSize < 2) {
    return { ok: false, message: '대진 규모는 2 이상의 2의 거듭제곱이어야 합니다.' }
  }
  const totalRounds = Math.log2(bracketSize)
  const nodes: TournamentBracketNode[] = []

  for (let roundNumber = 1; roundNumber <= totalRounds; roundNumber++) {
    const matchCount = bracketSize / 2 ** roundNumber
    for (let matchNumber = 1; matchNumber <= matchCount; matchNumber++) {
      const isFinal = roundNumber === totalRounds
      nodes.push({
        id: tournamentMatchId(roundNumber, matchNumber),
        roundNumber,
        playerCountInRound: bracketSize / 2 ** (roundNumber - 1),
        matchNumber,
        slotA: roundNumber === 1 ? matchNumber * 2 - 1 : null,
        slotB: roundNumber === 1 ? matchNumber * 2 : null,
        nextMatchId: isFinal ? null : tournamentMatchId(roundNumber + 1, Math.ceil(matchNumber / 2)),
        nextSlot: isFinal ? null : matchNumber % 2 === 1 ? 'playerA' : 'playerB',
      })
    }
  }

  if (options.includeThirdPlace && totalRounds >= 2) {
    nodes.push({
      id: thirdPlaceMatchId(bracketSize),
      roundNumber: totalRounds + 1,
      playerCountInRound: 3,
      matchNumber: 1,
      slotA: null,
      slotB: null,
      nextMatchId: null,
      nextSlot: null,
    })
  }

  return { ok: true, value: nodes }
}

/** 빈 대진 한 칸을 아직 아무도 없는 경기로 바꾼다. */
function emptyMatch(node: TournamentBracketNode): TournamentMatch {
  return {
    id: node.id,
    roundNumber: node.roundNumber,
    playerCountInRound: node.playerCountInRound,
    matchNumber: node.matchNumber,
    playerAParticipantId: null,
    playerBParticipantId: null,
    playerAMemberId: null,
    playerBMemberId: null,
    playerAHandicapSnapshot: null,
    playerBHandicapSnapshot: null,
    scoreA: null,
    scoreB: null,
    resultType: 'normal',
    status: 'awaitingResult',
    nextMatchId: node.nextMatchId,
    nextSlot: node.nextSlot,
  }
}

/** 경기의 한쪽 자리에 선수를 앉힌 **새 경기 객체**를 돌려준다(원본은 바꾸지 않는다). */
function withPlayer(
  match: TournamentMatch,
  slot: 'playerA' | 'playerB',
  seat: { participantId: string; memberId: string; handicap: number },
): TournamentMatch {
  return slot === 'playerA'
    ? {
        ...match,
        playerAParticipantId: seat.participantId,
        playerAMemberId: seat.memberId,
        playerAHandicapSnapshot: seat.handicap,
      }
    : {
        ...match,
        playerBParticipantId: seat.participantId,
        playerBMemberId: seat.memberId,
        playerBHandicapSnapshot: seat.handicap,
      }
}

/**
 * 좌석 배정(추첨 결과)을 받아 대회 전체 경기 목록을 만든다.
 *
 * 1라운드에서 한 자리만 채워진 경기는 부전승이다 — 그 자리 선수가 자동으로 다음 라운드에
 * 올라간다. 부전승 경기는 다음을 지킨다.
 *   · resultType 'bye', 상태는 바로 official (관리자 승인 절차를 거치지 않는다)
 *   · scoreA/scoreB는 null (가짜 점수를 만들지 않는다)
 *   · officialWinner는 채우되, 경기수·승수 집계에서는 tournamentRecord()가 제외한다
 *
 * 2라운드 이후 자리는 비워 둔다. **관리자가 최종 승인해야만** 그 자리가 채워진다
 * (logic/tournamentMatch.ts의 approveTournamentMatch → applyPromotion).
 */
export function buildTournamentMatches(
  bracket: TournamentBracketNode[],
  seats: TournamentSeat[],
): TournamentResult<TournamentMatch[]> {
  if (bracket.length === 0) return { ok: false, message: '대진 구조가 비어 있습니다.' }

  const bracketSize = bracket.filter((n) => n.roundNumber === 1).length * 2
  const seatBySlot = new Map<number, TournamentSeat>()
  for (const seat of seats) {
    if (!Number.isInteger(seat.slotNumber) || seat.slotNumber < 1 || seat.slotNumber > bracketSize) {
      return { ok: false, message: `대진에 없는 자리 번호입니다: ${seat.slotNumber}` }
    }
    if (seatBySlot.has(seat.slotNumber)) {
      return { ok: false, message: `같은 자리에 두 명이 배정되었습니다: ${seat.slotNumber}번 자리` }
    }
    seatBySlot.set(seat.slotNumber, seat)
  }

  const matches = new Map(bracket.map((node) => [node.id, emptyMatch(node)]))

  // ── 1라운드 배치 + 부전승 자동 진출 ──
  for (const node of bracket) {
    if (node.roundNumber !== 1 || node.slotA === null || node.slotB === null) continue
    const seatA = seatBySlot.get(node.slotA)
    const seatB = seatBySlot.get(node.slotB)
    if (!seatA && !seatB) {
      return { ok: false, message: `${node.matchNumber}번 경기에 배정된 선수가 없습니다.` }
    }

    let match = matches.get(node.id)!
    if (seatA) match = withPlayer(match, 'playerA', seatA)
    if (seatB) match = withPlayer(match, 'playerB', seatB)

    const soleSeat = seatA && seatB ? null : (seatA ?? seatB)!
    if (soleSeat) {
      // 부전승 — 실제 경기가 아니므로 점수를 만들지 않고 바로 공식 처리한다.
      match = {
        ...match,
        resultType: 'bye',
        status: 'official',
        officialWinnerParticipantId: soleSeat.participantId,
        officialLoserParticipantId: null,
      }
      if (match.nextMatchId && match.nextSlot) {
        const next = matches.get(match.nextMatchId)
        if (next) matches.set(next.id, withPlayer(next, match.nextSlot, soleSeat))
      }
    }
    matches.set(match.id, match)
  }

  return { ok: true, value: bracket.map((node) => matches.get(node.id)!) }
}
