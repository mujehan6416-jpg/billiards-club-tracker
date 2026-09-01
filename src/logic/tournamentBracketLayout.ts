import type { TournamentMatch } from '../types/tournament'

// 전체 대진표 시각화(TournamentBracketVisual)에서 경기 카드를 어디에 그릴지 미리 계산하는
// 순수 로직. React·DOM에 전혀 의존하지 않는다 — 그래서 항상 같은 입력에 같은 좌표가
// 나오고(deterministic), 화면 크기·리사이즈와 무관하다. 예전에는 카드를 먼저 그린 뒤
// getBoundingClientRect로 위치를 "측정"해서 선을 그렸지만, 이번에는 반대로 이 계산 결과대로
// 카드 자체를 배치한다 — 그래서 선이 카드 위치에 맞춰지는 게 아니라 카드가 계산된 자리에
// 놓이고 선은 그 좌표를 그대로 따라간다.

export const BRACKET_LAYOUT = {
  /** 선수 칸 2개(각 26px)를 쌓은 경기 카드 하나의 세로 높이(56 → 52, 추가로 약 7% 축소). */
  CARD_HEIGHT: 52,
  /** 경기 카드 하나의 가로 폭(152 → 140, 추가로 약 8% 축소). */
  CARD_WIDTH: 140,
  /** 같은 라운드 안에서 인접한 경기 카드 사이의 세로 여백(박스가 작아진 만큼만 전체 간격이
   * 자연스럽게 줄어들도록, 이 값 자체는 건드리지 않는다). */
  ROW_GAP: 16,
  /** 라운드(열)와 라운드 사이의 가로 여백(연결선 포함) — 기존과 비슷하게 유지한다. */
  COLUMN_GAP: 64,
} as const

const ROUND1_STEP = BRACKET_LAYOUT.CARD_HEIGHT + BRACKET_LAYOUT.ROW_GAP
const COLUMN_WIDTH = BRACKET_LAYOUT.CARD_WIDTH + BRACKET_LAYOUT.COLUMN_GAP

export interface BracketCardPosition {
  round: number
  /** 이 라운드(열)의 왼쪽 x좌표. */
  x: number
  /** 이 경기 카드의 세로 중앙 y좌표. */
  centerY: number
}

/**
 * 각 경기의 표시 좌표(라운드별 x, 카드 세로 중앙 y)를 match 데이터만으로 계산한다.
 *
 * 1라운드는 일정한 간격으로 순서대로 세로 배치한다. 그 다음 라운드부터는, nextMatchId로
 * 이 경기를 가리키는 이전 라운드 경기들의 centerY **평균**을 그대로 이 경기의 centerY로
 * 쓴다 — 그래서 "다음 라운드 카드가 이전 두 경기 카드의 정확한 중간에 있어야 한다"는
 * 요구를 좌표 계산 단계에서부터 만족한다(나중에 선으로 보정하지 않는다).
 *
 * 부전승도 여느 경기와 똑같은 TournamentMatch이므로 별도 분기가 필요 없다 — 대진 생성
 * 시점에 이미 존재하는 하나의 실제 경기로서 그대로 소스가 된다.
 *
 * bracketSize(8/16/32강 등)에 대한 하드코딩이 없다 — 몇 라운드든 이 재귀적 평균 규칙만
 * 그대로 적용된다.
 */
export function calculateBracketLayout(matches: TournamentMatch[]): Map<string, BracketCardPosition> {
  const byRound = new Map<number, TournamentMatch[]>()
  for (const m of matches) {
    if (!byRound.has(m.roundNumber)) byRound.set(m.roundNumber, [])
    byRound.get(m.roundNumber)!.push(m)
  }
  const roundNumbers = [...byRound.keys()].sort((a, b) => a - b)

  const positions = new Map<string, BracketCardPosition>()

  roundNumbers.forEach((roundNumber, roundIndex) => {
    const roundMatches = [...byRound.get(roundNumber)!].sort((a, b) => a.matchNumber - b.matchNumber)
    const x = roundIndex * COLUMN_WIDTH

    if (roundIndex === 0) {
      roundMatches.forEach((m, i) => {
        positions.set(m.id, { round: roundNumber, x, centerY: BRACKET_LAYOUT.CARD_HEIGHT / 2 + i * ROUND1_STEP })
      })
      return
    }

    for (const m of roundMatches) {
      const sourceYs = matches
        .filter((s) => s.nextMatchId === m.id)
        .map((s) => positions.get(s.id)?.centerY)
        .filter((y): y is number => y !== undefined)
      // 소스가 없는 경우는 정상적인 대진 데이터에서는 나오지 않는다(모든 비1라운드 경기는
      // 반드시 이전 라운드 경기 1~2개가 가리킨다) — 단 3·4위전은 예외라 아래에서 따로 덮어쓴다.
      const centerY = sourceYs.length > 0
        ? sourceYs.reduce((a, b) => a + b, 0) / sourceYs.length
        : BRACKET_LAYOUT.CARD_HEIGHT / 2
      positions.set(m.id, { round: roundNumber, x, centerY })
    }
  })

  // 3·4위전(playerCountInRound === 3) 특수 처리 — 위 일반 규칙은 nextMatchId로 가리키는
  // 이전 경기가 있어야 위치를 구할 수 있는데, 3·4위전은 "승자 진출"이 아니라 "준결승 패자
  // 둘이 만나는" 경기라 어느 경기도 nextMatchId로 이 경기를 가리키지 않는다(그 필드의 의미를
  // 바꾸지 않기 위해 그대로 둔다). 그래서 여기서만 따로 위치를 정한다 — 결승과 **같은 컬럼
  // (x)** 에서, 결승 카드 바로 아래에 별도 카드로 둔다(결승 진출선처럼 보이지 않도록 결승과는
  // 세로로만 떨어뜨리고, 두 준결승 경기와는 어떤 연결선도 그리지 않는다 — TournamentBracketVisual이
  // nextMatchId 그래프로만 선을 그리므로 이 경기는 애초에 선의 대상이 아니다).
  const thirdPlaceMatch = matches.find((m) => m.playerCountInRound === 3)
  if (thirdPlaceMatch) {
    const withoutThirdPlace = matches.filter((m) => m.playerCountInRound !== 3)
    const final = withoutThirdPlace.find((m) => m.nextMatchId === null)
    const finalPos = final ? positions.get(final.id) : undefined
    if (finalPos) {
      positions.set(thirdPlaceMatch.id, {
        round: thirdPlaceMatch.roundNumber,
        x: finalPos.x,
        centerY: finalPos.centerY + BRACKET_LAYOUT.CARD_HEIGHT + BRACKET_LAYOUT.ROW_GAP * 2,
      })
    }
  }

  return positions
}
