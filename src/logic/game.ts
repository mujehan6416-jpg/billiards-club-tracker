import type { Game } from '../types'

/** 달성률 = 친 개수 ÷ 핸디(목표). 핸디가 0 이하이면 0. */
export function rate(score: number, handicap: number): number {
  if (handicap <= 0) return 0
  return score / handicap
}

/**
 * 승자 판정. 명시적 winnerId가 있으면 그것을 신뢰(과거 임포트 데이터),
 * 없으면 달성률(rate)이 높은 쪽. 달성률 동일하면 무승부(null).
 */
export function winnerId(game: Game): string | null {
  if (game.winnerId !== undefined) return game.winnerId
  const rA = rate(game.scoreA, game.handicapA)
  const rB = rate(game.scoreB, game.handicapB)
  if (rA > rB) return game.playerAId
  if (rB > rA) return game.playerBId
  return null
}

/**
 * 실제로 점수가 입력·저장된 경기인지 판정한다.
 *
 * Game 객체는 MeetingTab의 save()가 addGame()을 호출할 때만 생성되고, 그 시점에
 * scoreA/scoreB/endType이 항상 함께 계산되어 저장된다 — 매칭만 되고 아직 점수를 안 넣은
 * 상태는 Game이 아니라 화면의 Ongoing(컴포넌트 로컬 상태)으로만 존재하고 session.games에는
 * 들어가지 않는다. CSV 임포트(appStore.ts의 applyGameCsv)도 동일하게 세 필드를 항상 채운다.
 * winnerId는 과거 CSV 임포트 데이터에만 명시적으로 채워지고 일반 저장 경로에서는 항상
 * undefined로 남기 때문에("winnerId 존재 여부"만으로는 UI로 직접 입력한 결과를 판정할 수
 * 없다), 이 함수는 winnerId가 아니라 scoreA/scoreB/endType을 기준으로 판정한다.
 */
export function hasRecordedResult(game: Game): boolean {
  return Number.isFinite(game.scoreA) && Number.isFinite(game.scoreB) && !!game.endType
}
