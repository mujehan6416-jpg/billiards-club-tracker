import { describe, it, expect } from 'vitest'
import {
  createDrawMapping, validateDrawEntries, resolveSlotNumber, buildSeatsFromDraw,
} from '../src/logic/tournamentDraw'
import type { TournamentDrawEntry, TournamentParticipant } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·회원 ID·운영 데이터를 쓰지 않는다.

function seededRng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`실패로 끝났습니다: ${result.message}`)
  return result.value
}

function participant(n: number, overrides: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    id: `p${n}`,
    memberId: `m${n}`,
    displayNameSnapshot: `가상참가자${n}`,
    baseHandicapSnapshot: 20,
    tournamentHandicap: 20,
    entryStatus: 'entered',
    ...overrides,
  }
}

function entries(pairs: [string, number][]): TournamentDrawEntry[] {
  return pairs.map(([participantId, drawNumber]) => ({ participantId, drawNumber }))
}

describe('createDrawMapping', () => {
  it('11명이면 16강 대진에 부전승 5자리, 번호 11개가 각각 다른 자리로 간다', () => {
    const mapping = unwrap(createDrawMapping(11, seededRng(42)))
    expect(mapping.bracketSize).toBe(16)
    expect(mapping.byeSlots).toHaveLength(5)

    const slots = Object.values(mapping.numberToSlot)
    expect(slots).toHaveLength(11)
    expect(new Set(slots).size).toBe(11)

    // 번호가 가는 자리와 부전승 자리는 절대 겹치지 않고, 둘을 합치면 16자리를 모두 채운다.
    const byeSet = new Set(mapping.byeSlots)
    expect(slots.some((slot) => byeSet.has(slot))).toBe(false)
    expect(new Set([...slots, ...mapping.byeSlots]).size).toBe(16)
  })

  it('번호는 1번부터 참가자 수까지만 만들어진다', () => {
    const mapping = unwrap(createDrawMapping(5, seededRng(1)))
    expect(Object.keys(mapping.numberToSlot).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('번호 순서와 자리 번호가 그대로 이어지지 않는다 (2번이 2번 자리라고 짐작할 수 없다)', () => {
    // 여러 seed 중 하나라도 "번호 = 자리"가 아니면 매핑이 실제로 섞이고 있다는 뜻이다.
    const straightThrough = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      const mapping = unwrap(createDrawMapping(11, seededRng(seed)))
      return Object.entries(mapping.numberToSlot).every(([n, slot]) => Number(n) === slot)
    })
    expect(straightThrough.some((same) => same)).toBe(false)
  })

  it('같은 seed면 항상 같은 매핑이 나온다', () => {
    expect(unwrap(createDrawMapping(11, seededRng(99)))).toEqual(unwrap(createDrawMapping(11, seededRng(99))))
  })

  it('참가자가 2명 미만이면 만들 수 없다', () => {
    expect(createDrawMapping(1, seededRng(1)).ok).toBe(false)
  })
})

describe('validateDrawEntries', () => {
  const ids = ['p1', 'p2', 'p3']

  it('정상 추첨 결과를 통과시킨다', () => {
    const result = validateDrawEntries(ids, entries([['p1', 3], ['p2', 1], ['p3', 2]]))
    expect(result.ok).toBe(true)
  })

  it('같은 번호를 두 사람이 가지면 실패', () => {
    const result = validateDrawEntries(ids, entries([['p1', 2], ['p2', 2], ['p3', 3]]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('두 사람')
  })

  it('같은 참가자에게 번호가 두 번 배정되면 실패', () => {
    const result = validateDrawEntries(ids, entries([['p1', 1], ['p1', 2], ['p3', 3]]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('두 번')
  })

  it('범위 밖 번호는 실패', () => {
    expect(validateDrawEntries(ids, entries([['p1', 0], ['p2', 1], ['p3', 2]])).ok).toBe(false)
    expect(validateDrawEntries(ids, entries([['p1', 4], ['p2', 1], ['p3', 2]])).ok).toBe(false)
  })

  it('정수가 아닌 번호는 실패', () => {
    expect(validateDrawEntries(ids, entries([['p1', 1.5], ['p2', 1], ['p3', 2]])).ok).toBe(false)
  })

  it('번호를 못 받은 참가자가 있으면 실패', () => {
    const result = validateDrawEntries(ids, entries([['p1', 1], ['p2', 2]]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('1명')
  })

  it('이 대회 참가자가 아닌 사람이 들어 있으면 실패', () => {
    const result = validateDrawEntries(ids, entries([['p1', 1], ['p2', 2], ['pX', 3]]))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('참가자가 아닌')
  })

  it('참가자 수보다 많은 항목이 들어와도 실패한다', () => {
    const result = validateDrawEntries(ids, entries([['p1', 1], ['p2', 2], ['p3', 3], ['pX', 1]]))
    expect(result.ok).toBe(false)
  })

  it('실패하면 아무것도 반영하지 않는다 — 넘겨준 배열이 그대로 남는다', () => {
    const input = entries([['p1', 2], ['p2', 2], ['p3', 3]])
    const snapshot = JSON.stringify(input)
    validateDrawEntries(ids, input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('resolveSlotNumber · buildSeatsFromDraw', () => {
  it('추첨번호를 비공개 매핑으로 실제 자리로 바꾼다', () => {
    const mapping = unwrap(createDrawMapping(4, seededRng(5)))
    for (let n = 1; n <= 4; n++) {
      expect(resolveSlotNumber(mapping, n)).toBe(mapping.numberToSlot[n])
    }
    expect(resolveSlotNumber(mapping, 99)).toBeNull()
  })

  it('검증을 통과한 추첨 결과를 좌석 배정으로 바꾼다', () => {
    const participants = [participant(1), participant(2), participant(3)]
    const mapping = unwrap(createDrawMapping(3, seededRng(11)))
    const seats = unwrap(
      buildSeatsFromDraw(participants, entries([['p1', 1], ['p2', 2], ['p3', 3]]), mapping),
    )

    expect(seats).toHaveLength(3)
    expect(new Set(seats.map((s) => s.slotNumber)).size).toBe(3)
    expect(seats.find((s) => s.participantId === 'p1')!.slotNumber).toBe(mapping.numberToSlot[1])
    expect(seats.every((s) => !mapping.byeSlots.includes(s.slotNumber))).toBe(true)
  })

  it('좌석에는 대회 적용 핸디가 복사된다 (회원 기본 핸디가 아니다)', () => {
    const participants = [
      participant(1, { baseHandicapSnapshot: 25, tournamentHandicap: 22 }),
      participant(2),
    ]
    const mapping = unwrap(createDrawMapping(2, seededRng(3)))
    const seats = unwrap(buildSeatsFromDraw(participants, entries([['p1', 1], ['p2', 2]]), mapping))
    expect(seats.find((s) => s.participantId === 'p1')!.handicap).toBe(22)
  })

  it('검증에 실패하면 좌석을 하나도 만들지 않는다', () => {
    const participants = [participant(1), participant(2), participant(3)]
    const mapping = unwrap(createDrawMapping(3, seededRng(11)))
    const result = buildSeatsFromDraw(participants, entries([['p1', 1], ['p2', 1], ['p3', 3]]), mapping)
    expect(result.ok).toBe(false)
  })

  it('대회 적용 핸디가 1 미만이면 거부한다', () => {
    const participants = [participant(1, { tournamentHandicap: 0 }), participant(2)]
    const mapping = unwrap(createDrawMapping(2, seededRng(3)))
    const result = buildSeatsFromDraw(participants, entries([['p1', 1], ['p2', 2]]), mapping)
    expect(result.ok).toBe(false)
  })
})
