import { buildEmptyBracket, buildTournamentMatches } from '../../src/logic/tournamentBracket'
import { applyPromotion, loserPromotionForThirdPlace } from '../../src/logic/tournamentMatch'
import type { TournamentMatch } from '../../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, seat } from './restartMain'
import { pendingRestartJoins, analyzeRestartSource, buildRestartBracket } from '../../src/logic/tournamentRestartBracket'
import { seededRng } from './restartMain'

// 결과 공유 테스트용 가상 대회. 선수 n = 참가자 id `p{n}`(본선) / `m{n}`(리스타트), 이름은 `가상선수{n}`.

export const nameOfMain = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

/** 8명 본선(8강→4강→결승, includeThirdPlace면 3·4위전 포함). */
export function main8(includeThirdPlace: boolean): TournamentMatch[] {
  const bracket = buildEmptyBracket(8, { includeThirdPlace })
  if (!bracket.ok) throw new Error(bracket.message)
  const built = buildTournamentMatches(bracket.value, Array.from({ length: 8 }, (_, i) => seat(i + 1)))
  if (!built.ok) throw new Error(built.message)
  return built.value
}

/** 한 경기를 승인하고, 3·4위전이 있으면 준결승 패자를 3·4위전 자리로 올린다(앱의 승인 처리와 같은 결과). */
function approve(matches: TournamentMatch[], id: string, loser: 'A' | 'B' = 'B'): TournamentMatch[] {
  let next = decide(matches, id, loser)
  const done = next.find((m) => m.id === id)!
  const promo = loserPromotionForThirdPlace(done, next)
  if (promo) next = next.map((m) => (m.id === promo.nextMatchId ? applyPromotion(m, promo) : m))
  return next
}

/**
 * 8명 본선을 끝까지 진행한다. 지는 쪽은 항상 B(자리가 더 큰 번호 쪽)이므로
 * 8강 패자 = 2·4·6·8, 4강 패자 = 3·7, 결승 패자 = 5, 우승 = 1.
 * stop: 'before-final' = 4강까지, 'before-third' = 결승까지(3·4위전 미승인), 'all' = 전부.
 */
export function playMain8(
  includeThirdPlace: boolean, stop: 'before-final' | 'before-third' | 'all' = 'all', thirdPlaceLoser: 'A' | 'B' = 'B',
): TournamentMatch[] {
  let m = main8(includeThirdPlace)
  for (const id of ['r1m1', 'r1m2', 'r1m3', 'r1m4']) m = approve(m, id)
  for (const id of ['r2m1', 'r2m2']) m = approve(m, id)
  if (stop === 'before-final') return m
  m = approve(m, 'r3m1')
  if (stop === 'before-third' || !includeThirdPlace) return m
  return approve(m, 'r4m1', thirdPlaceLoser)
}

/** 16명 본선 1·2차를 승인한 상태(리스타트 대진 생성용). */
export function main16AfterRound2(): TournamentMatch[] {
  return decideRound(decideRound(fullMain(16), 1), 2)
}

/** 리스타트 대진을 만들고(1차 패자 8명) 결승까지 진행한 경기 목록. stopBeforeFinal이면 결승 직전까지. */
export function playRestart(stopBeforeFinal = false): TournamentMatch[] {
  const main = main16AfterRound2()
  const mainR1 = decideRound(fullMain(16), 1)
  const analysis = analyzeRestartSource(mainR1)
  if (!analysis.ok) throw new Error(analysis.message)
  const built = buildRestartBracket({
    sourceTournamentId: 'main', analysis: analysis.value, sourceMatches: mainR1, rng: seededRng(5),
    entrants: [2, 4, 6, 8, 10, 12, 14, 16].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
  })
  if (!built.ok) throw new Error(built.message)
  let matches = decideRound(built.value.matches, 1)
  for (const j of pendingRestartJoins(matches, main)) matches = fillJoiner(matches, j.restartMatchId, Number(j.memberId.slice(1)))
  const last = Math.max(...matches.map((m) => m.roundNumber))
  for (let r = 2; r < last; r++) matches = decideRound(matches, r)
  return stopBeforeFinal ? matches : decideRound(matches, last)
}

/** 리스타트 결승의 승자/패자 참가자 id. */
export function restartFinalists(matches: TournamentMatch[]): { champion: string; runnerUp: string } {
  const final = matches.find((m) => m.nextMatchId === null)!
  return { champion: final.officialWinnerParticipantId!, runnerUp: final.officialLoserParticipantId! }
}
