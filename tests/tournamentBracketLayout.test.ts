import { describe, it, expect } from 'vitest'
import { calculateBracketLayout, BRACKET_LAYOUT } from '../src/logic/tournamentBracketLayout'
import { buildEmptyBracket, buildTournamentMatches, tournamentMatchId } from '../src/logic/tournamentBracket'
import { createDrawMapping, buildSeatsFromDraw } from '../src/logic/tournamentDraw'
import type { TournamentDrawEntry, TournamentParticipant, TournamentSeat } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.
// 좌표 계산은 픽셀 스냅샷이 아니라 "다음 라운드 카드가 이전 두 경기의 정확한 중간에
// 있는가"라는 수학적 관계로 검증한다.

function seatsFor(bracketSize: number): TournamentSeat[] {
  return Array.from({ length: bracketSize }, (_, i) => ({
    participantId: `p-${i + 1}`, memberId: `m-${i + 1}`, handicap: 20, slotNumber: i + 1,
  }))
}

function bracket(bracketSize: number) {
  const nodes = buildEmptyBracket(bracketSize)
  if (!nodes.ok) throw new Error(nodes.message)
  const built = buildTournamentMatches(nodes.value, seatsFor(bracketSize))
  if (!built.ok) throw new Error(built.message)
  return built.value
}

describe('calculateBracketLayout — 8강', () => {
  const matches = bracket(8)
  const layout = calculateBracketLayout(matches)

  it('1라운드는 일정한 간격으로 순서대로 배치된다', () => {
    const step = BRACKET_LAYOUT.CARD_HEIGHT + BRACKET_LAYOUT.ROW_GAP
    for (let i = 1; i <= 4; i++) {
      const y = layout.get(tournamentMatchId(1, i))!.centerY
      expect(y).toBeCloseTo(BRACKET_LAYOUT.CARD_HEIGHT / 2 + (i - 1) * step, 6)
    }
  })

  it('CASE 1 — r1경기1·2의 평균이 r2경기1의 center다', () => {
    const yA = layout.get(tournamentMatchId(1, 1))!.centerY
    const yB = layout.get(tournamentMatchId(1, 2))!.centerY
    const target = layout.get(tournamentMatchId(2, 1))!.centerY
    expect(target).toBeCloseTo((yA + yB) / 2, 6)
  })

  it('CASE 2 — r1경기3·4의 평균이 r2경기2의 center다', () => {
    const yA = layout.get(tournamentMatchId(1, 3))!.centerY
    const yB = layout.get(tournamentMatchId(1, 4))!.centerY
    const target = layout.get(tournamentMatchId(2, 2))!.centerY
    expect(target).toBeCloseTo((yA + yB) / 2, 6)
  })

  it('CASE 3 — r2경기1·2의 평균이 결승의 center다', () => {
    const yA = layout.get(tournamentMatchId(2, 1))!.centerY
    const yB = layout.get(tournamentMatchId(2, 2))!.centerY
    const target = layout.get(tournamentMatchId(3, 1))!.centerY
    expect(target).toBeCloseTo((yA + yB) / 2, 6)
  })

  it('라운드가 다르면 x가 라운드마다 일정하게 증가한다(같은 라운드는 x가 같다)', () => {
    const columnWidth = BRACKET_LAYOUT.CARD_WIDTH + BRACKET_LAYOUT.COLUMN_GAP
    expect(layout.get(tournamentMatchId(1, 1))!.x).toBe(0)
    expect(layout.get(tournamentMatchId(1, 2))!.x).toBe(0)
    expect(layout.get(tournamentMatchId(2, 1))!.x).toBe(columnWidth)
    expect(layout.get(tournamentMatchId(3, 1))!.x).toBe(columnWidth * 2)
  })
})

describe('calculateBracketLayout — 16강/32강 일반화(하드코딩 없이 모든 라운드에 재귀적 평균 적용)', () => {
  function assertEveryNonFirstRoundIsAverageOfSources(bracketSize: number) {
    const matches = bracket(bracketSize)
    const layout = calculateBracketLayout(matches)
    const firstRound = Math.min(...matches.map((m) => m.roundNumber))

    for (const m of matches) {
      if (m.roundNumber === firstRound) continue
      const sources = matches.filter((s) => s.nextMatchId === m.id)
      expect(sources.length).toBeGreaterThan(0)
      const expected = sources.reduce((sum, s) => sum + layout.get(s.id)!.centerY, 0) / sources.length
      expect(layout.get(m.id)!.centerY).toBeCloseTo(expected, 6)
    }
  }

  it('16강 전체에서 성립한다', () => {
    assertEveryNonFirstRoundIsAverageOfSources(16)
  })

  it('32강 전체에서 성립한다', () => {
    assertEveryNonFirstRoundIsAverageOfSources(32)
  })

  it('8강에서도 성립한다(회귀 방지)', () => {
    assertEveryNonFirstRoundIsAverageOfSources(8)
  })
})

describe('calculateBracketLayout — 부전승', () => {
  it('부전승도 다른 경기와 똑같이 평균 계산에 포함된다(별도 분기 없음)', () => {
    // 11명 참가 → 16강, 부전승 5자리(실제 추첨 매핑을 통해 안전하게 자리를 배정한다).
    const participants: TournamentParticipant[] = Array.from({ length: 11 }, (_, i) => ({
      id: `p-${i + 1}`, memberId: `m-${i + 1}`, displayNameSnapshot: `참가자${i + 1}`,
      baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered',
    }))
    const mapping = createDrawMapping(11, () => 0.42)
    if (!mapping.ok) throw new Error(mapping.message)
    const entries: TournamentDrawEntry[] = participants.map((p, i) => ({ participantId: p.id, drawNumber: i + 1 }))
    const seats = buildSeatsFromDraw(participants, entries, mapping.value)
    if (!seats.ok) throw new Error(seats.message)
    const nodes = buildEmptyBracket(mapping.value.bracketSize)
    if (!nodes.ok) throw new Error(nodes.message)
    const built = buildTournamentMatches(nodes.value, seats.value)
    if (!built.ok) throw new Error(built.message)
    const matches = built.value
    const layout = calculateBracketLayout(matches)

    const byeMatch = matches.find((m) => m.resultType === 'bye')
    expect(byeMatch).toBeTruthy()
    const nextId = byeMatch!.nextMatchId!
    const sources = matches.filter((s) => s.nextMatchId === nextId)
    const expected = sources.reduce((sum, s) => sum + layout.get(s.id)!.centerY, 0) / sources.length
    expect(layout.get(nextId)!.centerY).toBeCloseTo(expected, 6)
  })
})

describe('calculateBracketLayout — 3·4위전', () => {
  /** 4강 대진에 준결승 패자 둘(r1경기1·2)이 맞붙는 3·4위전 하나를 덧붙인다. */
  function bracket4WithThirdPlace() {
    const matches = bracket(4)
    const thirdPlaceMatch = {
      id: 'third-place',
      roundNumber: 3,
      playerCountInRound: 3,
      matchNumber: 1,
      playerAParticipantId: 'p-1',
      playerBParticipantId: 'p-2',
      playerAMemberId: 'm-1',
      playerBMemberId: 'm-2',
      playerAHandicapSnapshot: 20,
      playerBHandicapSnapshot: 20,
      scoreA: 18,
      scoreB: 12,
      resultType: 'normal' as const,
      status: 'official' as const,
      officialWinnerParticipantId: 'p-1',
      officialLoserParticipantId: 'p-2',
      nextMatchId: null,
      nextSlot: null,
    }
    return [...matches, thirdPlaceMatch]
  }

  it('3·4위전의 centerY는 두 준결승(1라운드) 경기 위치의 평균이다', () => {
    const matches = bracket4WithThirdPlace()
    const layout = calculateBracketLayout(matches)
    const yA = layout.get(tournamentMatchId(1, 1))!.centerY
    const yB = layout.get(tournamentMatchId(1, 2))!.centerY
    expect(layout.get('third-place')!.centerY).toBeCloseTo((yA + yB) / 2, 6)
  })

  it('3·4위전은 결승과 x(라운드 컬럼)가 다르다 — 겹치지 않는다', () => {
    const matches = bracket4WithThirdPlace()
    const layout = calculateBracketLayout(matches)
    const finalPos = layout.get(tournamentMatchId(2, 1))!
    const thirdPos = layout.get('third-place')!
    expect(thirdPos.x).not.toBe(finalPos.x)
  })

  it('3·4위전이 있어도 나머지 경기(1라운드·결승) 좌표는 그대로다(회귀 없음)', () => {
    const withThird = calculateBracketLayout(bracket4WithThirdPlace())
    const without = calculateBracketLayout(bracket(4))
    for (const id of [tournamentMatchId(1, 1), tournamentMatchId(1, 2), tournamentMatchId(2, 1)]) {
      expect(withThird.get(id)).toEqual(without.get(id))
    }
  })

  it('3·4위전 위치에 NaN·undefined가 없다', () => {
    const matches = bracket4WithThirdPlace()
    const layout = calculateBracketLayout(matches)
    const pos = layout.get('third-place')!
    expect(pos).toBeTruthy()
    expect(Number.isFinite(pos.x)).toBe(true)
    expect(Number.isFinite(pos.centerY)).toBe(true)
  })
})
