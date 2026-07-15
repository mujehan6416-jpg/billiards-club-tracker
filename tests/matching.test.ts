import { describe, it, expect } from 'vitest'
import {
  pairKey, buildMeetCount, recommendNext, matchAll, matchRoundOne, matchRoundTwo, matchTwoRounds,
  hasRoundResults, canRematchRound, toggleParticipant, replaceRound, applyNewAttendees,
} from '../src/logic/matching'
import type { Game, Session } from '../src/types'

function game(a: string, b: string, overrides: Partial<Game> = {}): Game {
  return {
    id: a + b,
    playerAId: a,
    playerBId: b,
    handicapA: 20,
    handicapB: 20,
    scoreA: 1,
    scoreB: 0,
    endType: 'time',
    playedAt: '',
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    date: '2026-07-01',
    attendeeIds: ['A', 'B', 'C', 'D'],
    games: [],
    ...overrides,
  }
}

describe('pairKey', () => {
  it('순서 무관 동일 키', () => {
    expect(pairKey('A', 'B')).toBe(pairKey('B', 'A'))
  })
})

describe('buildMeetCount', () => {
  it('누적 맞대결 횟수 집계', () => {
    const sessions: Session[] = [
      {
        id: 's1',
        date: '2026-06-01',
        attendeeIds: ['A', 'B', 'C'],
        games: [game('A', 'B'), game('A', 'B'), game('A', 'C')],
      },
    ]
    const m = buildMeetCount(sessions)
    expect(m.get(pairKey('A', 'B'))).toBe(2)
    expect(m.get(pairKey('A', 'C'))).toBe(1)
  })
})

describe('recommendNext', () => {
  it('가장 안 만난 짝 우선', () => {
    const meetCount = new Map([
      [pairKey('A', 'B'), 3],
      [pairKey('A', 'C'), 0],
    ])
    const p = recommendNext({ waitingIds: ['A', 'B', 'C'], meetCount, todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('A', 'C'))
  })
  it('맞대결 같으면 오늘 적게 친 사람 우선', () => {
    const meetCount = new Map<string, number>()
    const today = new Map([
      ['A', 2],
      ['B', 0],
      ['C', 0],
    ])
    const p = recommendNext({ waitingIds: ['A', 'B', 'C'], meetCount, todayGameCount: today, rng: () => 0.5 })
    expect(pairKey(p!.aId, p!.bId)).toBe(pairKey('B', 'C'))
  })
  it('대기자 1명이면 null', () => {
    expect(recommendNext({ waitingIds: ['A'], meetCount: new Map(), todayGameCount: new Map() })).toBeNull()
  })
})

describe('matchAll', () => {
  it('짝수면 전원 매칭', () => {
    const pairs = matchAll({ waitingIds: ['A', 'B', 'C', 'D'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(2)
  })
  it('홀수면 1명 제외', () => {
    const pairs = matchAll({ waitingIds: ['A', 'B', 'C'], meetCount: new Map(), todayGameCount: new Map(), rng: () => 0.5 })
    expect(pairs).toHaveLength(1)
  })
})

describe('matchRoundOne', () => {
  it('넘겨받은 참가자 명단만 매칭한다 — 미대진자 지정은 호출부 책임', () => {
    // D를 관리자가 이번 라운드 미대진자로 지정했다고 가정하고 애초에 넘기지 않는다.
    const pairs = matchRoundOne(['A', 'B', 'C'], new Map(), undefined, undefined)
    const matched = new Set(pairs.flatMap((p) => [p.aId, p.bId]))
    expect(matched.has('D')).toBe(false)
    expect(pairs).toHaveLength(1)
  })

  it('금지 대진(forbiddenPairs)은 서로 매칭되지 않는다', () => {
    // A-C가 확실히 최우선으로 뽑히도록 나머지 조합에 서로 다른 가중치를 줘 무작위 동점을 없앤다
    // (동점이면 A,B가 우연히 마지막 2명으로 남아 금지 대진임에도 강제로 짝지어질 수 있다)
    const forbidden = new Set([pairKey('A', 'B')])
    const meetCount = new Map([
      [pairKey('A', 'C'), 0],
      [pairKey('A', 'D'), 1],
      [pairKey('B', 'C'), 2],
      [pairKey('B', 'D'), 3],
      [pairKey('C', 'D'), 4],
    ])
    const pairs = matchRoundOne(['A', 'B', 'C', 'D'], meetCount, forbidden)
    expect(pairs).toHaveLength(2)
    const forbiddenMatched = pairs.some((p) => pairKey(p.aId, p.bId) === pairKey('A', 'B'))
    expect(forbiddenMatched).toBe(false)
  })
})

describe('matchRoundTwo', () => {
  it('1라운드 대진(round1Pairs)과 겹치지 않게 회피한다', () => {
    const round1Pairs = [{ aId: 'A', bId: 'B' }, { aId: 'C', bId: 'D' }]
    const pairs = matchRoundTwo(['A', 'B', 'C', 'D'], new Map(), round1Pairs)
    const repeated = pairs.some((p) =>
      round1Pairs.some((r1) => pairKey(r1.aId, r1.bId) === pairKey(p.aId, p.bId)),
    )
    expect(repeated).toBe(false)
  })

  it('2라운드 참가자가 1라운드와 달라도(늦참·중도귀가) 그 명단만 매칭한다', () => {
    // C는 1라운드 후 늦게 온 참가자, B는 중도 귀가로 2라운드에서 빠졌다고 가정
    const round1Pairs = [{ aId: 'A', bId: 'B' }]
    const pairs = matchRoundTwo(['A', 'C'], new Map(), round1Pairs)
    expect(pairs).toHaveLength(1)
    expect(new Set([pairs[0].aId, pairs[0].bId])).toEqual(new Set(['A', 'C']))
  })

  it('1라운드를 다시 계산하지 않는다 — round1Pairs를 그대로 신뢰한다', () => {
    // X-Z가 확실히 최우선으로 뽑히도록 나머지 조합에 서로 다른 가중치를 줘 무작위 동점을 없앤다
    // (X-Z 먼저 뽑히면 남는 Y-W가 짝지어지고, X-Y로 강제로 몰릴 여지가 없다)
    const round1Pairs = [{ aId: 'X', bId: 'Y' }]
    const meetCount = new Map([
      [pairKey('X', 'Z'), 0],
      [pairKey('X', 'W'), 1],
      [pairKey('Y', 'Z'), 2],
      [pairKey('Y', 'W'), 3],
      [pairKey('Z', 'W'), 4],
    ])
    const pairs = matchRoundTwo(['X', 'Y', 'Z', 'W'], meetCount, round1Pairs)
    expect(pairs).toHaveLength(2)
    // X-Y 재대진만 피하면 되고, round1Pairs 자체는 반환값에 포함되지 않는다(2라운드 결과만 반환)
    expect(pairs.every((p) => pairKey(p.aId, p.bId) !== pairKey('X', 'Y'))).toBe(true)
  })
})

describe('matchTwoRounds — 라운드별 독립 참가자 명단', () => {
  it('round1Ids와 round2Ids가 같으면 기존 동작과 동일하게 2라운드가 1라운드 상대를 회피한다', () => {
    const ids = ['A', 'B', 'C', 'D']
    const { round1, round2 } = matchTwoRounds(ids, ids, new Map())
    const r1Keys = new Set(round1.map((p) => pairKey(p.aId, p.bId)))
    const overlap = round2.some((p) => r1Keys.has(pairKey(p.aId, p.bId)))
    expect(overlap).toBe(false)
  })

  it('round1Ids와 round2Ids가 다르면(늦참/중도귀가) 각 라운드가 지정된 명단만 매칭한다', () => {
    const { round1, round2 } = matchTwoRounds(['A', 'B'], ['A', 'B', 'C', 'D'], new Map())
    expect(round1).toHaveLength(1)
    const round2Ids = new Set(round2.flatMap((p) => [p.aId, p.bId]))
    expect(round2Ids.has('C')).toBe(true)
    expect(round2Ids.has('D')).toBe(true)
  })
})

describe('hasRoundResults / canRematchRound — 실제 저장된 결과 기준 재매칭 판정', () => {
  it('1) 2라운드 대진만 생성되고(lineup에만 있음) games에는 없으면 재매칭을 허용한다', () => {
    const s = session({
      games: [],
      lineup: [{ round: 2, aId: 'A', bId: 'B', handicapA: 20, handicapB: 20 }],
    })
    expect(hasRoundResults(s, 2)).toBe(false)
    expect(canRematchRound(s, 2)).toBe(true)
  })

  it('2) 2라운드 점수가 하나라도 저장되면(session.games에 round:2 항목) 재매칭을 차단한다', () => {
    const s = session({ games: [game('A', 'B', { round: 2, scoreA: 15, scoreB: 10 })] })
    expect(hasRoundResults(s, 2)).toBe(true)
    expect(canRematchRound(s, 2)).toBe(false)
  })

  it('3) 과거 임포트처럼 winnerId가 명시된 경기도(scoreA/scoreB/endType이 항상 함께 저장되므로) 결과로 인정해 차단한다', () => {
    const s = session({ games: [game('A', 'B', { round: 2, winnerId: 'A' })] })
    expect(canRematchRound(s, 2)).toBe(false)
  })

  it('1라운드 결과는 2라운드 재매칭 가능 여부에 영향을 주지 않는다', () => {
    const s = session({ games: [game('A', 'B', { round: 1, scoreA: 20, scoreB: 5 })] })
    expect(canRematchRound(s, 2)).toBe(true)
  })

  it('10) round1/round2ParticipantIds 같은 옵션 필드가 없는 기존 세션에서도 정상 판정한다', () => {
    const s = session({ games: [game('A', 'B', { round: 2, scoreA: 3, scoreB: 4 })] })
    expect(s.round1ParticipantIds).toBeUndefined()
    expect(s.round2ParticipantIds).toBeUndefined()
    expect(canRematchRound(s, 2)).toBe(false)
  })

  it('판정 함수는 session 객체를 변형하지 않는다(다른 모임 데이터 보존 확인)', () => {
    const s = session({ games: [game('A', 'B', { round: 1, scoreA: 20, scoreB: 3 })] })
    const before = JSON.parse(JSON.stringify(s))
    canRematchRound(s, 2)
    hasRoundResults(s, 2)
    expect(s).toEqual(before)
  })
})

describe('replaceRound — 특정 라운드 항목만 교체, 나머지 라운드는 보존', () => {
  it('4) 2라운드만 교체해도 1라운드 항목은 참조까지 그대로 유지된다(=1라운드 대진 보존)', () => {
    const round1Item = { round: 1, aId: 'A', bId: 'B' }
    const list = [round1Item, { round: 2, aId: 'C', bId: 'D' }]
    const next = replaceRound(list, 2, [{ round: 2, aId: 'E', bId: 'F' }])
    expect(next).toHaveLength(2)
    expect(next[0]).toBe(round1Item)
    expect(next.find((o) => o.round === 2)).toEqual({ round: 2, aId: 'E', bId: 'F' })
  })

  it('1라운드만 교체해도 2라운드 항목은 그대로 남는다', () => {
    const round2Item = { round: 2, aId: 'C', bId: 'D' }
    const list = [{ round: 1, aId: 'A', bId: 'B' }, round2Item]
    const next = replaceRound(list, 1, [{ round: 1, aId: 'G', bId: 'H' }])
    expect(next.find((o) => o.round === 2)).toBe(round2Item)
  })

  it('6) 결과가 있어 재매칭이 차단된 상태에서는 애초에 이 함수(및 matchRoundTwo)를 호출하지 않아야 한다', () => {
    // MeetingTab.autoMatchRoundTwo는 canRematchRound(session, 2)가 false면 즉시 return하고
    // matchRoundTwo/replaceRound를 아예 호출하지 않는다 — 즉 저장된 2라운드 결과(session.games)는
    // 이 흐름에서 건드릴 방법이 없다(삭제는 별도의 개별 삭제(deleteGame) 버튼으로만 가능).
    const s = session({ games: [game('A', 'B', { round: 2, scoreA: 3, scoreB: 4 })] })
    expect(canRematchRound(s, 2)).toBe(false)
  })
})

describe('applyNewAttendees — 늦참 시 라운드별 기본 선택 상태', () => {
  it('7) 1라운드 시작 후 추가된 참석자는 1라운드 선택에 자동 추가되지 않는다', () => {
    const next = applyNewAttendees(['A', 'B'], ['A', 'B', 'C'], new Set(['A', 'B']), new Set(['A', 'B']), true)
    expect(next.round1Sel.has('C')).toBe(false)
  })

  it('8) 추가된 참석자는 2라운드 참가 후보(기본 선택 상태)에는 항상 포함된다', () => {
    const next = applyNewAttendees(['A', 'B'], ['A', 'B', 'C'], new Set(['A', 'B']), new Set(['A', 'B']), true)
    expect(next.round2Sel.has('C')).toBe(true)
  })

  it('1라운드 시작 전에 추가된 참석자는 1·2라운드 선택 모두에 기본 포함된다', () => {
    const next = applyNewAttendees(['A', 'B'], ['A', 'B', 'C'], new Set(['A', 'B']), new Set(['A', 'B']), false)
    expect(next.round1Sel.has('C')).toBe(true)
    expect(next.round2Sel.has('C')).toBe(true)
  })

  it('9) 관리자가 toggleParticipant로 늦참자를 2라운드에서 다시 뺄 수 있다(중도 미참가로 처리)', () => {
    const afterAdd = applyNewAttendees(['A', 'B'], ['A', 'B', 'C'], new Set(['A', 'B']), new Set(['A', 'B']), true)
    expect(afterAdd.round2Sel.has('C')).toBe(true)
    const afterRemove = toggleParticipant(afterAdd.round2Sel, 'C')
    expect(afterRemove.has('C')).toBe(false)
  })

  it('추가된 참석자가 없으면 원래 Set 참조를 그대로 반환한다(불필요한 상태 갱신 방지)', () => {
    const round1Sel = new Set(['A', 'B'])
    const round2Sel = new Set(['A', 'B'])
    const next = applyNewAttendees(['A', 'B'], ['A', 'B'], round1Sel, round2Sel, true)
    expect(next.round1Sel).toBe(round1Sel)
    expect(next.round2Sel).toBe(round2Sel)
  })
})
