import { rate, validateGameResult } from './game'
import type {
  TournamentFinalPlacements, TournamentMatch, TournamentMatchSlot, TournamentPromotion,
  TournamentRecord, TournamentResult,
} from '../types/tournament'

// 토너먼트 경기 1건의 결과 입력 → 상대 확인 → 관리자 최종 승인 흐름과, 승인 이후의
// 다음 라운드 진출·최종 순위를 계산하는 순수 로직.
//
// 이 파일의 모든 함수는 넘겨받은 경기 객체를 **바꾸지 않고** 새 객체를 돌려준다.
// Firestore 저장은 다음 단계(lib/tournamentSync.ts)에서 이 결과를 그대로 쓰면 된다.
//
// 신원 기준: 회원은 memberId로, 관리자는 Firebase UID로 판정한다.
// 회원 한 명이 폰·PC 등 여러 Firebase UID를 가질 수 있으므로(types/memberLink.ts 참고)
// "입력한 사람과 확인한 사람이 같은지"를 UID로 비교하면 기기만 바꿔 혼자 다 해버릴 수 있다.

/** 점수와 적용 핸디로 계산한 결과. 공식 기록이 아니라 "계산상 이렇다"는 값이다. */
export interface TournamentMatchOutcome {
  rateA: number
  rateB: number
  /** 달성률이 높은 쪽의 participantId. 완전히 같으면 null. */
  winnerParticipantId: string | null
  /** 달성률이 완전히 같은 상태. 토너먼트는 무승부로 끝낼 수 없으므로 관리자가 승자를 지정해야 한다. */
  isTie: boolean
}

/** approveTournamentMatch·declareTournamentForfeit의 결과. */
export interface TournamentApproval {
  match: TournamentMatch
  /** 다음 라운드로 올릴 승자 정보. 결승이면 null. */
  promotion: TournamentPromotion | null
}

function nowLog(match: TournamentMatch) {
  return { ...(match.resultLog ?? {}) }
}

function isPlayer(match: TournamentMatch, memberId: string): boolean {
  return memberId === match.playerAMemberId || memberId === match.playerBMemberId
}

/**
 * 점수·적용 핸디로 달성률과 승자를 계산한다.
 *
 * 달성률은 기존 logic/game.ts의 rate()를 **그대로 재사용**한다 — 토너먼트 전용 공식을
 * 새로 만들지 않는다. 비교 방식도 game.ts의 winnerId()와 같다: 반올림하지 않은 원래 값을
 * 그대로 비교하고, 완전히 같을 때만 승자가 없다.
 *
 * game.ts의 winnerId()를 직접 부르지 않는 이유는 반환값의 의미가 다르기 때문이다.
 * 일반 경기에서 null은 "무승부 확정"이지만 토너먼트에서는 "관리자가 승자를 정해야 함"이다.
 * 두 계산이 어긋나지 않는지는 tests/tournamentMatch.test.ts가 winnerId()와 교차 검증한다.
 */
export function tournamentMatchOutcome(match: TournamentMatch): TournamentResult<TournamentMatchOutcome> {
  const { playerAParticipantId, playerBParticipantId, scoreA, scoreB } = match
  const handicapA = match.playerAHandicapSnapshot
  const handicapB = match.playerBHandicapSnapshot
  if (!playerAParticipantId || !playerBParticipantId) {
    return { ok: false, message: '두 선수가 모두 정해진 경기에서만 결과를 계산할 수 있습니다.' }
  }
  if (scoreA === null || scoreB === null || handicapA === null || handicapB === null) {
    return { ok: false, message: '아직 점수가 입력되지 않았습니다.' }
  }
  const rateA = rate(scoreA, handicapA)
  const rateB = rate(scoreB, handicapB)
  if (rateA > rateB) return { ok: true, value: { rateA, rateB, winnerParticipantId: playerAParticipantId, isTie: false } }
  if (rateB > rateA) return { ok: true, value: { rateA, rateB, winnerParticipantId: playerBParticipantId, isTie: false } }
  return { ok: true, value: { rateA, rateB, winnerParticipantId: null, isTie: true } }
}

/** 입력된 점수가 이 경기의 적용 핸디 기준으로 올바른지 — 일반 경기와 완전히 같은 규칙을 쓴다. */
function checkScores(
  match: TournamentMatch,
  scoreA: number | string,
  scoreB: number | string,
): TournamentResult<{ scoreA: number; scoreB: number }> {
  const handicapA = match.playerAHandicapSnapshot
  const handicapB = match.playerBHandicapSnapshot
  if (handicapA === null || handicapB === null) {
    return { ok: false, message: '이 경기의 적용 핸디가 정해지지 않았습니다.' }
  }
  const checked = validateGameResult({ handicapA, handicapB, scoreA, scoreB })
  if (!checked.ok) return { ok: false, message: checked.message }
  return { ok: true, value: { scoreA: checked.values.scoreA, scoreB: checked.values.scoreB } }
}

/**
 * 참가자 한 명이 두 선수의 점수를 입력한다(누가 먼저 입력해도 된다).
 *
 * 입력만으로는 공식 결과가 되지 않는다 — 상대 확인과 관리자 최종 승인이 남는다.
 * 그래서 여기서는 officialWinner를 절대 만들지 않고 calculatedWinner만 계산해 둔다.
 */
export function submitTournamentMatchResult(
  match: TournamentMatch,
  input: { byMemberId: string; scoreA: number | string; scoreB: number | string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.resultType !== 'normal') {
    return { ok: false, message: '부전승·기권 경기에는 점수를 입력하지 않습니다.' }
  }
  if (match.status !== 'awaitingResult') {
    return { ok: false, message: '이미 결과가 입력된 경기입니다.' }
  }
  if (!match.playerAParticipantId || !match.playerBParticipantId) {
    return { ok: false, message: '아직 두 선수가 모두 정해지지 않았습니다.' }
  }
  if (!isPlayer(match, input.byMemberId)) {
    return { ok: false, message: '이 경기에 나온 두 사람만 결과를 입력할 수 있습니다.' }
  }
  const scores = checkScores(match, input.scoreA, input.scoreB)
  if (!scores.ok) return scores

  const withScores: TournamentMatch = {
    ...match,
    scoreA: scores.value.scoreA,
    scoreB: scores.value.scoreB,
  }
  const outcome = tournamentMatchOutcome(withScores)
  if (!outcome.ok) return outcome

  return {
    ok: true,
    value: {
      ...withScores,
      calculatedWinnerParticipantId: outcome.value.winnerParticipantId,
      status: 'awaitingVerification',
      resultLog: {
        ...nowLog(match),
        submittedByMemberId: input.byMemberId,
        submittedAt: input.at,
        correctionRequested: false,
      },
    },
  }
}

/**
 * 관리자가 현장에서 두 선수 대신 점수를 직접 입력한다(현장 편의용).
 *
 * ⚠ 관리자가 입력해도 **곧바로 공식 확정되지 않는다** — 회원 입력과 똑같이 "상대 확인 대기"
 * 상태로만 간다. 입력자 기록은 resultLog가 아니라 최상위 enteredByAdminUid/enteredAt에
 * 남긴다(이유는 types/tournament.ts의 주석 참고 — Rules를 건드리지 않기 위해서다). resultLog에
 * submittedByMemberId를 남기지 않으므로, 이후 verifyTournamentMatchResult에서
 * "입력자 본인은 확인 불가" 조건이 두 참가자 모두에게 적용되지 않는다 — 즉 둘 중 아무나
 * 확인할 수 있다(관리자가 입력했으니 "상대가 입력했다"는 전제 자체가 없다).
 */
export function adminEntersMatchResult(
  match: TournamentMatch,
  input: { adminUid: string; scoreA: number | string; scoreB: number | string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.resultType !== 'normal') {
    return { ok: false, message: '부전승·기권 경기에는 점수를 입력하지 않습니다.' }
  }
  if (match.status !== 'awaitingResult') {
    return { ok: false, message: '이미 결과가 입력된 경기입니다.' }
  }
  if (!match.playerAParticipantId || !match.playerBParticipantId) {
    return { ok: false, message: '아직 두 선수가 모두 정해지지 않았습니다.' }
  }
  const scores = checkScores(match, input.scoreA, input.scoreB)
  if (!scores.ok) return scores

  const withScores: TournamentMatch = { ...match, scoreA: scores.value.scoreA, scoreB: scores.value.scoreB }
  const outcome = tournamentMatchOutcome(withScores)
  if (!outcome.ok) return outcome

  return {
    ok: true,
    value: {
      ...withScores,
      calculatedWinnerParticipantId: outcome.value.winnerParticipantId,
      status: 'awaitingVerification',
      enteredByAdminUid: input.adminUid,
      enteredAt: input.at,
      resultLog: {
        ...nowLog(match),
        correctionRequested: false,
      },
    },
  }
}

/**
 * 입력하지 않은 상대 참가자가 결과를 확인한다.
 *
 * 한 사람이 입력과 확인을 모두 할 수 없다 — 입력자와 같은 memberId면 거부한다.
 * 향후 Firestore 규칙에서도 같은 조건(resultLog.submittedByMemberId != 이 기기의 memberId)으로
 * 서버가 직접 막을 예정이다.
 */
export function verifyTournamentMatchResult(
  match: TournamentMatch,
  input: { byMemberId: string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.status !== 'awaitingVerification') {
    return { ok: false, message: '지금은 결과를 확인할 수 있는 상태가 아닙니다.' }
  }
  if (match.resultLog?.correctionRequested) {
    return { ok: false, message: '수정 요청이 접수된 경기입니다. 관리자 확인을 기다려 주세요.' }
  }
  if (!isPlayer(match, input.byMemberId)) {
    return { ok: false, message: '이 경기에 나온 두 사람만 결과를 확인할 수 있습니다.' }
  }
  if (input.byMemberId === match.resultLog?.submittedByMemberId) {
    return { ok: false, message: '결과를 입력한 사람은 같은 경기를 확인할 수 없습니다. 상대에게 확인을 부탁해 주세요.' }
  }
  return {
    ok: true,
    value: {
      ...match,
      status: 'awaitingApproval',
      resultLog: {
        ...nowLog(match),
        verificationType: 'player',
        verifiedByMemberId: input.byMemberId,
        verifiedAt: input.at,
      },
    },
  }
}

/**
 * 상대가 확인하지 않을 때 관리자가 직권으로 확인한다.
 * 회원 확인과 데이터상 반드시 구분한다(verificationType) — 누가 확인했는지가 나중에 근거가 된다.
 */
export function adminVerifyTournamentMatchResult(
  match: TournamentMatch,
  input: { adminUid: string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.status !== 'awaitingVerification') {
    return { ok: false, message: '지금은 결과를 확인할 수 있는 상태가 아닙니다.' }
  }
  return {
    ok: true,
    value: {
      ...match,
      status: 'awaitingApproval',
      resultLog: {
        ...nowLog(match),
        verificationType: 'adminOverride',
        verifiedByAdminUid: input.adminUid,
        verifiedAt: input.at,
        correctionRequested: false,
      },
    },
  }
}

/**
 * 상대 참가자가 "결과가 다르다"고 알린다. 회원이 점수를 직접 고치지는 못한다 —
 * 관리자가 확인하고 고친 뒤 최종 승인하는 것이 유일한 경로다.
 */
export function requestTournamentMatchCorrection(
  match: TournamentMatch,
  input: { byMemberId: string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.status !== 'awaitingVerification') {
    return { ok: false, message: '지금은 수정을 요청할 수 있는 상태가 아닙니다.' }
  }
  if (!isPlayer(match, input.byMemberId)) {
    return { ok: false, message: '이 경기에 나온 두 사람만 수정을 요청할 수 있습니다.' }
  }
  if (input.byMemberId === match.resultLog?.submittedByMemberId) {
    return { ok: false, message: '결과를 입력한 사람은 수정을 요청할 수 없습니다.' }
  }
  return {
    ok: true,
    value: {
      ...match,
      resultLog: {
        ...nowLog(match),
        correctionRequested: true,
        correctionRequestedByMemberId: input.byMemberId,
        correctionRequestedAt: input.at,
      },
    },
  }
}

/** 관리자가 점수를 고친다. 고치고 나면 확인 절차 없이 곧바로 최종 승인 대기 상태가 된다. */
export function correctTournamentMatchResult(
  match: TournamentMatch,
  input: { adminUid: string; scoreA: number | string; scoreB: number | string; at: string },
): TournamentResult<TournamentMatch> {
  if (match.status === 'official') {
    return { ok: false, message: '이미 공식 확정된 경기입니다. 공식 결과 정정으로 처리해야 합니다.' }
  }
  if (match.status === 'awaitingResult') {
    return { ok: false, message: '아직 입력된 결과가 없어 수정할 수 없습니다.' }
  }
  const scores = checkScores(match, input.scoreA, input.scoreB)
  if (!scores.ok) return scores

  const withScores: TournamentMatch = { ...match, scoreA: scores.value.scoreA, scoreB: scores.value.scoreB }
  const outcome = tournamentMatchOutcome(withScores)
  if (!outcome.ok) return outcome

  return {
    ok: true,
    value: {
      ...withScores,
      calculatedWinnerParticipantId: outcome.value.winnerParticipantId,
      status: 'awaitingApproval',
      resultLog: {
        ...nowLog(match),
        correctionRequested: false,
        correctedByAdminUid: input.adminUid,
        correctedAt: input.at,
      },
    },
  }
}

/** 공식 확정된 경기의 승자를 다음 경기 어느 자리에 넣어야 하는지. 결승이거나 아직 미확정이면 null. */
export function promotionFor(match: TournamentMatch): TournamentPromotion | null {
  const winnerId = match.officialWinnerParticipantId
  if (match.status !== 'official' || !winnerId) return null
  if (!match.nextMatchId || !match.nextSlot) return null
  const isA = winnerId === match.playerAParticipantId
  const memberId = isA ? match.playerAMemberId : match.playerBMemberId
  const handicap = isA ? match.playerAHandicapSnapshot : match.playerBHandicapSnapshot
  if (!memberId || handicap === null) return null
  return { nextMatchId: match.nextMatchId, nextSlot: match.nextSlot, participantId: winnerId, memberId, handicap }
}

/**
 * 관리자 최종 승인. **여기서만** 공식 승자·패자가 만들어지고 다음 라운드 진출이 생긴다.
 *
 * 참가자 두 명이 입력·확인을 끝냈다고 자동으로 공식 기록이 되지 않는다.
 * 달성률이 같으면 시스템이 임의로 승자를 고르지 않고, 관리자가 현장 규칙에 따라
 * officialWinnerParticipantId를 직접 지정해야 승인된다.
 */
export function approveTournamentMatch(
  match: TournamentMatch,
  input: { adminUid: string; at: string; officialWinnerParticipantId?: string },
): TournamentResult<TournamentApproval> {
  if (match.resultType === 'bye') {
    return { ok: false, message: '부전승은 승인 절차가 없습니다.' }
  }
  if (match.status === 'official') {
    return { ok: false, message: '이미 공식 확정된 경기입니다.' }
  }
  if (match.status !== 'awaitingApproval') {
    return { ok: false, message: '아직 관리자가 승인할 수 있는 상태가 아닙니다. 상대 참가자 확인이 필요합니다.' }
  }
  const { playerAParticipantId: aId, playerBParticipantId: bId } = match
  if (!aId || !bId) {
    return { ok: false, message: '두 선수가 모두 정해진 경기만 승인할 수 있습니다.' }
  }

  let winnerId = input.officialWinnerParticipantId ?? null
  if (winnerId !== null && winnerId !== aId && winnerId !== bId) {
    return { ok: false, message: '이 경기에 나오지 않은 사람을 승자로 지정할 수 없습니다.' }
  }
  if (winnerId === null) {
    const outcome = tournamentMatchOutcome(match)
    if (!outcome.ok) return outcome
    if (outcome.value.isTie) {
      return { ok: false, message: '두 선수의 달성률이 같습니다. 관리자가 승자를 지정해 주세요.' }
    }
    winnerId = outcome.value.winnerParticipantId
  }

  const approved: TournamentMatch = {
    ...match,
    status: 'official',
    officialWinnerParticipantId: winnerId,
    officialLoserParticipantId: winnerId === aId ? bId : aId,
    resultLog: { ...nowLog(match), approvedByAdminUid: input.adminUid, approvedAt: input.at },
  }
  return { ok: true, value: { match: approved, promotion: promotionFor(approved) } }
}

/**
 * 기권 처리. 경기 전 기권이면 점수가 없는 상태 그대로, 경기 중 기권이면 이미 입력된 점수를
 * 그대로 둔 채 상대의 기권승으로 확정한다 — **승패 계산용 가짜 점수를 만들지 않는다.**
 * 기권은 달성률로 판정할 수 없으므로 관리자가 승자를 명시 지정한다.
 */
export function declareTournamentForfeit(
  match: TournamentMatch,
  input: { adminUid: string; at: string; winnerParticipantId: string },
): TournamentResult<TournamentApproval> {
  if (match.resultType === 'bye') {
    return { ok: false, message: '부전승 경기는 기권 처리할 수 없습니다.' }
  }
  if (match.status === 'official') {
    return { ok: false, message: '이미 공식 확정된 경기입니다.' }
  }
  const { playerAParticipantId: aId, playerBParticipantId: bId } = match
  if (!aId || !bId) {
    return { ok: false, message: '두 선수가 모두 정해진 경기만 기권 처리할 수 있습니다.' }
  }
  if (input.winnerParticipantId !== aId && input.winnerParticipantId !== bId) {
    return { ok: false, message: '이 경기에 나오지 않은 사람을 승자로 지정할 수 없습니다.' }
  }

  const forfeited: TournamentMatch = {
    ...match,
    resultType: 'forfeit',
    status: 'official',
    officialWinnerParticipantId: input.winnerParticipantId,
    officialLoserParticipantId: input.winnerParticipantId === aId ? bId : aId,
    resultLog: { ...nowLog(match), approvedByAdminUid: input.adminUid, approvedAt: input.at },
  }
  return { ok: true, value: { match: forfeited, promotion: promotionFor(forfeited) } }
}

/** 승인된 승자를 다음 경기 자리에 앉힌 **새 경기 객체**를 돌려준다. */
export function applyPromotion(nextMatch: TournamentMatch, promotion: TournamentPromotion): TournamentMatch {
  const slot: TournamentMatchSlot = promotion.nextSlot
  return slot === 'playerA'
    ? {
        ...nextMatch,
        playerAParticipantId: promotion.participantId,
        playerAMemberId: promotion.memberId,
        playerAHandicapSnapshot: promotion.handicap,
      }
    : {
        ...nextMatch,
        playerBParticipantId: promotion.participantId,
        playerBMemberId: promotion.memberId,
        playerBHandicapSnapshot: promotion.handicap,
      }
}

/**
 * 이미 공식 확정된 경기의 결과를 지금 고쳐도 안전한지 판정한다.
 *
 * 위험한 상황은 하나다: 이 경기 승자가 이미 다음 경기를 치르기 시작한 뒤에 승자를 바꾸면,
 * 다음 경기에 "그 경기에 나가지도 않은 사람"의 결과가 남는다. 대진 전체가 어긋난다.
 *
 * 그래서 다음 경기가 아직 아무 결과도 받지 않은 상태(awaitingResult)일 때만 허용한다.
 * 결승은 뒤에 아무것도 없으므로 언제나 허용한다.
 *
 * ⚠ 자동으로 뒤 경기까지 되돌리는 연쇄 취소는 만들지 않는다 — 관리자가 상황을 보고
 * 직접 판단해야 하는 문제이지, 시스템이 알아서 지워도 되는 문제가 아니다.
 */
export function canCorrectOfficialResult(
  match: TournamentMatch,
  nextMatch: TournamentMatch | null,
): TournamentResult<true> {
  if (match.status !== 'official') {
    return { ok: false, message: '아직 공식 확정되지 않은 경기입니다. 일반 수정으로 처리하세요.' }
  }
  if (!match.nextMatchId) return { ok: true, value: true }
  if (!nextMatch) {
    return { ok: false, message: '다음 경기를 찾을 수 없어 안전한지 확인할 수 없습니다.' }
  }
  if (nextMatch.status === 'official') {
    return { ok: false, message: '다음 경기가 이미 공식 확정되어 이 결과를 고칠 수 없습니다.' }
  }
  if (nextMatch.status !== 'awaitingResult') {
    return { ok: false, message: '다음 경기 결과가 이미 입력되어 이 결과를 고칠 수 없습니다.' }
  }
  return { ok: true, value: true }
}

/**
 * 한 참가자의 대회 내 전적.
 *
 * **부전승은 경기수·승수에 넣지 않는다** — 실제로 친 경기가 아니기 때문이다.
 * 기권승은 실제로 잡혀 있던 대진이므로 경기수에 포함한다.
 * 공식 확정(관리자 최종 승인)된 경기만 센다.
 */
export function tournamentRecord(matches: TournamentMatch[], participantId: string): TournamentRecord {
  let played = 0
  let wins = 0
  let losses = 0
  for (const match of matches) {
    if (match.status !== 'official' || match.resultType === 'bye') continue
    const isPlayerA = match.playerAParticipantId === participantId
    const isPlayerB = match.playerBParticipantId === participantId
    if (!isPlayerA && !isPlayerB) continue
    played++
    if (match.officialWinnerParticipantId === participantId) wins++
    else if (match.officialLoserParticipantId === participantId) losses++
  }
  return { played, wins, losses }
}

/**
 * 그 라운드의 모든 경기가 공식 확정되었는지. 부전승은 대진 생성 시점에 이미 status가
 * 'official'로 만들어져 있으므로(별도 승인 절차가 없다) 여기서 따로 나눠 계산하지 않고
 * 그대로 함께 검사한다. 그 라운드에 경기가 하나도 없으면(아직 다음 라운드가 만들어지지
 * 않았거나 잘못된 라운드 번호) false — "확정됨"을 함부로 주장하지 않는다.
 */
export function isTournamentRoundOfficial(matches: TournamentMatch[], roundNumber: number): boolean {
  const inRound = matches.filter((m) => m.roundNumber === roundNumber)
  if (inRound.length === 0) return false
  return inRound.every((m) => m.status === 'official')
}

/**
 * 최종 순위.
 *
 * 3·4위전이 없는 대회(대부분)는 기존 그대로 준결승에서 진 두 명이 공동 3위다.
 * 대진 규모가 2면 준결승이 없어 공동 3위는 빈 배열이다.
 *
 * 3·4위전이 있는 대회는 playerCountInRound === 3인 경기 하나로 표시된다(새 필드를 두지 않고
 * 기존 숫자 필드의 예약값만 쓴다 — components/tournament/tournamentDisplay.ts의 roundLabel과
 * 같은 규칙). 결승을 찾을 때는 이 경기를 제외해야 한다 — 결승과 3·4위전 둘 다 nextMatchId가
 * null(둘 다 다음 라운드로 이어지지 않는 마지막 경기)이라, 제외하지 않으면 어느 쪽을 결승으로
 * 찾을지 배열 순서에 좌우된다.
 */
export function calculateFinalPlacements(matches: TournamentMatch[]): TournamentFinalPlacements {
  const empty: TournamentFinalPlacements = {
    championParticipantId: null,
    runnerUpParticipantId: null,
    thirdPlaceParticipantIds: [],
  }
  const thirdPlaceMatch = matches.find((m) => m.playerCountInRound === 3) ?? null
  const withoutThirdPlace = matches.filter((m) => m.playerCountInRound !== 3)
  const final = withoutThirdPlace.find((m) => m.nextMatchId === null)
  if (!final) return empty

  const placements: TournamentFinalPlacements = {
    championParticipantId: final.status === 'official' ? final.officialWinnerParticipantId ?? null : null,
    runnerUpParticipantId: final.status === 'official' ? final.officialLoserParticipantId ?? null : null,
    thirdPlaceParticipantIds: [],
  }

  if (thirdPlaceMatch && thirdPlaceMatch.status === 'official' && thirdPlaceMatch.resultType !== 'bye') {
    if (thirdPlaceMatch.officialWinnerParticipantId) {
      placements.thirdPlaceParticipantIds = [thirdPlaceMatch.officialWinnerParticipantId]
    }
    placements.fourthPlaceParticipantId = thirdPlaceMatch.officialLoserParticipantId ?? null
    return placements
  }

  const semiFinals = withoutThirdPlace.filter((m) => m.nextMatchId === final.id)
  placements.thirdPlaceParticipantIds = semiFinals
    .filter((m) => m.status === 'official' && m.resultType !== 'bye')
    .map((m) => m.officialLoserParticipantId)
    .filter((id): id is string => !!id)
  return placements
}
