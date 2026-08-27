import { describe, it, expect } from 'vitest'
import {
  calculateBracketSize, buildEmptyBracket, generateByeSlots, buildTournamentMatches, tournamentMatchId,
} from '../src/logic/tournamentBracket'
import type { TournamentSeat } from '../src/types/tournament'

// 이 파일은 가상 데이터만 쓴다 — 실제 회원 이름·회원 ID·운영 데이터를 전혀 사용하지 않는다.

/** 테스트마다 같은 결과가 나오도록 고정된 난수원(선형 합동 생성기). */
function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function seat(participantId: string, slotNumber: number, handicap = 20): TournamentSeat {
  return { participantId, memberId: `m-${participantId}`, handicap, slotNumber }
}

/** ok:true를 전제로 값만 꺼낸다(실패면 테스트가 여기서 멈춘다). */
function unwrap<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`실패로 끝났습니다: ${result.message}`)
  return result.value
}

describe('calculateBracketSize', () => {
  it('2명이면 대진 규모 2, 부전승 없음', () => {
    expect(unwrap(calculateBracketSize(2))).toEqual({ bracketSize: 2, byeCount: 0 })
  })
  it('3명이면 대진 규모 4', () => {
    expect(unwrap(calculateBracketSize(3)).bracketSize).toBe(4)
  })
  it('4명이면 대진 규모 4', () => {
    expect(unwrap(calculateBracketSize(4)).bracketSize).toBe(4)
  })
  it('5명이면 대진 규모 8', () => {
    expect(unwrap(calculateBracketSize(5)).bracketSize).toBe(8)
  })
  it('8명이면 대진 규모 8', () => {
    expect(unwrap(calculateBracketSize(8)).bracketSize).toBe(8)
  })
  it('11명이면 대진 규모 16', () => {
    expect(unwrap(calculateBracketSize(11)).bracketSize).toBe(16)
  })
  it('16명이면 대진 규모 16', () => {
    expect(unwrap(calculateBracketSize(16)).bracketSize).toBe(16)
  })
  it('17명이면 대진 규모 32', () => {
    expect(unwrap(calculateBracketSize(17)).bracketSize).toBe(32)
  })
  it('상한을 두지 않는다 — 33명이면 64', () => {
    expect(unwrap(calculateBracketSize(33)).bracketSize).toBe(64)
  })

  it('1명 이하는 대진을 만들 수 없다', () => {
    for (const count of [1, 0, -3]) {
      const result = calculateBracketSize(count)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('2명 이상')
    }
  })
  it('정수가 아니면 거부한다', () => {
    expect(calculateBracketSize(4.5).ok).toBe(false)
  })
})

describe('generateByeSlots', () => {
  it('11명(16강)이면 부전승은 5자리', () => {
    const { bracketSize, byeCount } = unwrap(calculateBracketSize(11))
    expect(byeCount).toBe(5)
    expect(unwrap(generateByeSlots(bracketSize, byeCount, seededRng(42)))).toHaveLength(5)
  })

  it('부전승이 0이면 빈 목록', () => {
    expect(unwrap(generateByeSlots(8, 0, seededRng(1)))).toEqual([])
  })

  it('한 경기의 두 자리가 모두 비지 않는다 (아무도 없는 경기 방지)', () => {
    // 여러 seed로 반복해도 성질이 깨지지 않아야 한다.
    for (let seed = 1; seed <= 30; seed++) {
      const slots = unwrap(generateByeSlots(16, 5, seededRng(seed)))
      const matchNumbers = slots.map((slot) => Math.ceil(slot / 2))
      expect(new Set(matchNumbers).size).toBe(slots.length)
      expect(new Set(slots).size).toBe(slots.length)
      for (const slot of slots) expect(slot).toBeGreaterThanOrEqual(1)
      for (const slot of slots) expect(slot).toBeLessThanOrEqual(16)
    }
  })

  it('참가자 정보를 전혀 받지 않는다 — 인원 수와 난수원만으로 결정된다', () => {
    // 부전승 배치가 특정 회원·특정 핸디에게 유리해질 수 없다는 것을 인자 구조로 보장한다.
    // 이 함수에는 참가자를 넘길 방법 자체가 없고, 같은 인원·같은 난수원이면 결과가 항상 같다.
    const a = unwrap(generateByeSlots(16, 5, seededRng(7)))
    const b = unwrap(generateByeSlots(16, 5, seededRng(7)))
    expect(a).toEqual(b)
  })

  it('같은 seed면 항상 같은 결과 (테스트가 흔들리지 않는다)', () => {
    const first = unwrap(generateByeSlots(32, 7, seededRng(2026)))
    const second = unwrap(generateByeSlots(32, 7, seededRng(2026)))
    expect(first).toEqual(second)
  })

  it('다른 seed면 결과가 달라질 수 있다 (고정 배치가 아니다)', () => {
    const results = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => unwrap(generateByeSlots(16, 5, seededRng(seed))).join(',')),
    )
    expect(results.size).toBeGreaterThan(1)
  })

  it('2의 거듭제곱이 아닌 대진 규모는 거부한다', () => {
    expect(generateByeSlots(6, 1, seededRng(1)).ok).toBe(false)
  })
})

describe('buildEmptyBracket', () => {
  it('16강이면 라운드 4개 · 경기 15개', () => {
    const nodes = unwrap(buildEmptyBracket(16))
    expect(nodes).toHaveLength(15)
    expect(nodes.filter((n) => n.roundNumber === 1)).toHaveLength(8)
    expect(nodes.filter((n) => n.roundNumber === 4)).toHaveLength(1)
  })

  it('라운드마다 남은 선수 수를 기록한다 (화면 문구는 도메인에 넣지 않는다)', () => {
    const nodes = unwrap(buildEmptyBracket(16))
    expect(nodes.find((n) => n.id === tournamentMatchId(1, 1))!.playerCountInRound).toBe(16)
    expect(nodes.find((n) => n.id === tournamentMatchId(3, 1))!.playerCountInRound).toBe(4)
    expect(nodes.find((n) => n.id === tournamentMatchId(4, 1))!.playerCountInRound).toBe(2)
  })

  it('1라운드 n번째 경기는 슬롯 (2n-1, 2n)을 쓴다', () => {
    const nodes = unwrap(buildEmptyBracket(8))
    const first = nodes.find((n) => n.id === tournamentMatchId(1, 1))!
    const third = nodes.find((n) => n.id === tournamentMatchId(1, 3))!
    expect([first.slotA, first.slotB]).toEqual([1, 2])
    expect([third.slotA, third.slotB]).toEqual([5, 6])
  })

  it('8강 1·2경기 승자는 같은 4강 경기의 서로 다른 자리로 간다', () => {
    const nodes = unwrap(buildEmptyBracket(8))
    const m1 = nodes.find((n) => n.id === tournamentMatchId(1, 1))!
    const m2 = nodes.find((n) => n.id === tournamentMatchId(1, 2))!
    expect(m1.nextMatchId).toBe(m2.nextMatchId)
    expect(m1.nextSlot).toBe('playerA')
    expect(m2.nextSlot).toBe('playerB')
  })

  it('결승은 다음 경기가 없다', () => {
    const nodes = unwrap(buildEmptyBracket(8))
    const finals = nodes.filter((n) => n.nextMatchId === null)
    expect(finals).toHaveLength(1)
    expect(finals[0].playerCountInRound).toBe(2)
    expect(finals[0].nextSlot).toBeNull()
  })

  it('2명 대진은 결승 한 경기뿐', () => {
    const nodes = unwrap(buildEmptyBracket(2))
    expect(nodes).toHaveLength(1)
    expect(nodes[0].nextMatchId).toBeNull()
  })
})

describe('buildTournamentMatches', () => {
  const bracket4 = () => unwrap(buildEmptyBracket(4))

  it('빈 자리 없이 꽉 찬 대진은 부전승이 생기지 않는다', () => {
    const seats = [seat('p1', 1), seat('p2', 2), seat('p3', 3), seat('p4', 4)]
    const matches = unwrap(buildTournamentMatches(bracket4(), seats))
    expect(matches.filter((m) => m.resultType === 'bye')).toHaveLength(0)
    expect(matches.every((m) => m.scoreA === null && m.scoreB === null)).toBe(true)
  })

  it('부전승 경기는 점수 없이 바로 공식 처리되고 승자가 다음 라운드에 자동으로 올라간다', () => {
    // 3명 → 4강 대진, 4번 자리가 부전승
    const seats = [seat('p1', 1), seat('p2', 2), seat('p3', 3, 17)]
    const matches = unwrap(buildTournamentMatches(bracket4(), seats))

    const byeMatch = matches.find((m) => m.id === tournamentMatchId(1, 2))!
    expect(byeMatch.resultType).toBe('bye')
    expect(byeMatch.status).toBe('official')
    expect(byeMatch.scoreA).toBeNull()
    expect(byeMatch.scoreB).toBeNull()
    expect(byeMatch.officialWinnerParticipantId).toBe('p3')
    expect(byeMatch.officialLoserParticipantId).toBeNull()

    // 1라운드 2번째 경기 → 결승의 B 자리
    const final = matches.find((m) => m.id === tournamentMatchId(2, 1))!
    expect(final.playerBParticipantId).toBe('p3')
    expect(final.playerBHandicapSnapshot).toBe(17)
    // 반대편은 아직 아무도 올라오지 않았다 — 관리자 승인 전에는 비어 있어야 한다.
    expect(final.playerAParticipantId).toBeNull()
  })

  it('부전승 경기에는 달성률 계산에 쓸 핸디 자리도 한쪽만 채워진다', () => {
    const seats = [seat('p1', 1), seat('p2', 2), seat('p3', 3)]
    const matches = unwrap(buildTournamentMatches(bracket4(), seats))
    const byeMatch = matches.find((m) => m.id === tournamentMatchId(1, 2))!
    expect(byeMatch.playerAParticipantId).toBe('p3')
    expect(byeMatch.playerBParticipantId).toBeNull()
    expect(byeMatch.playerBHandicapSnapshot).toBeNull()
  })

  it('규칙에 없는 자리 번호는 거부한다', () => {
    const result = buildTournamentMatches(bracket4(), [seat('p1', 1), seat('p2', 9)])
    expect(result.ok).toBe(false)
  })

  it('같은 자리에 두 명을 넣으면 거부한다', () => {
    const result = buildTournamentMatches(bracket4(), [seat('p1', 1), seat('p2', 1)])
    expect(result.ok).toBe(false)
  })

  it('아무도 없는 경기가 생기면 거부한다', () => {
    // 슬롯 1·2가 모두 비어 1번 경기에 선수가 없다
    const result = buildTournamentMatches(bracket4(), [seat('p1', 3), seat('p2', 4)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('선수가 없습니다')
  })

  it('2라운드 이후 자리는 비워 둔다 (관리자 승인 전 진출 금지)', () => {
    const seats = [seat('p1', 1), seat('p2', 2), seat('p3', 3), seat('p4', 4)]
    const matches = unwrap(buildTournamentMatches(bracket4(), seats))
    const final = matches.find((m) => m.id === tournamentMatchId(2, 1))!
    expect(final.playerAParticipantId).toBeNull()
    expect(final.playerBParticipantId).toBeNull()
    expect(final.status).toBe('awaitingResult')
  })
})
