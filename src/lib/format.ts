import { rate } from '../logic/game'

/** 핸디가 있으면 "20/25 (80%)", 없으면(과거 임포트) "20". */
export function fmtScore(score: number, handicap: number): string {
  if (handicap > 0) return `${score}/${handicap} (${Math.round(rate(score, handicap) * 100)}%)`
  return `${score}`
}
