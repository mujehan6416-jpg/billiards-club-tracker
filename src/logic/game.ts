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

/** 경기 결과(적용 핸디·득점) 입력값 검증 결과. */
export type GameResultValidation =
  | { ok: true; values: { handicapA: number; scoreA: number; handicapB: number; scoreB: number } }
  | { ok: false; message: string }

/** 화면 입력칸은 문자열이므로 문자열·숫자를 모두 받아 정수로 바꾼다. 정수가 아니면 null. */
function toInt(v: string | number): number | null {
  const s = String(v).trim()
  if (!/^-?\d+$/.test(s)) return null
  return parseInt(s, 10)
}

/**
 * 경기 결과 입력값을 검증한다. 새 경기 저장(MeetingTab의 save)과 완전히 같은 규칙을 쓴다 —
 * 적용 핸디는 1 이상, 득점은 0 이상, 득점은 그 선수의 적용 핸디를 넘을 수 없다.
 * 실패 메시지는 그대로 화면에 보여줄 수 있는 쉬운 한국어 문장이다.
 */
export function validateGameResult(input: {
  handicapA: string | number
  scoreA: string | number
  handicapB: string | number
  scoreB: string | number
}): GameResultValidation {
  const handicapA = toInt(input.handicapA)
  const handicapB = toInt(input.handicapB)
  const scoreA = toInt(input.scoreA)
  const scoreB = toInt(input.scoreB)
  if (handicapA === null || handicapB === null) return { ok: false, message: '적용 핸디를 숫자로 입력해 주세요.' }
  if (scoreA === null || scoreB === null) return { ok: false, message: '득점을 숫자로 입력해 주세요.' }
  if (handicapA < 1 || handicapB < 1) return { ok: false, message: '적용 핸디는 1 이상이어야 합니다.' }
  if (scoreA < 0 || scoreB < 0) return { ok: false, message: '득점은 0보다 작을 수 없습니다.' }
  if (scoreA > handicapA || scoreB > handicapB) return { ok: false, message: '득점은 적용 핸디보다 클 수 없습니다.' }
  return { ok: true, values: { handicapA, scoreA, handicapB, scoreB } }
}
