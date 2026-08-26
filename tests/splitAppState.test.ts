import { describe, it, expect } from 'vitest'
import { splitLegacyAppState, validateSplit, mergeSplitToAppState } from '../src/logic/splitAppState'
import { makeLegacyAppState, withoutPassword } from './fixtures/legacyAppState'
import type { AppState } from '../src/types'

// 전부 가상 fixture 기준이다. 실제 운영 Firestore 데이터는 읽지 않는다.

const legacy = () => makeLegacyAppState()
const legacyGameCount = (s: AppState) => s.sessions.reduce((n, x) => n + x.games.length, 0)

describe('splitLegacyAppState — 개수와 ID 보존', () => {
  it('회원 수와 ID가 그대로 유지된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    expect(split.members).toHaveLength(state.members.length)
    expect(split.members.map((m) => m.id)).toEqual(state.members.map((m) => m.id))
  })

  it('세션 수와 ID가 그대로 유지된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    expect(split.sessions).toHaveLength(state.sessions.length)
    expect(split.sessions.map((s) => s.id)).toEqual(state.sessions.map((s) => s.id))
  })

  it('경기 수와 ID가 그대로 유지되고 각 경기가 속한 모임이 기록된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    expect(split.games).toHaveLength(legacyGameCount(state))
    for (const session of state.sessions) {
      const mine = split.games.filter((g) => g.sessionId === session.id)
      expect(mine.map((g) => g.game.id)).toEqual(session.games.map((g) => g.id))
    }
  })

  it('회계 건수와 ID가 그대로 유지된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    expect(split.ledger).toHaveLength(state.ledger.length)
    expect(split.ledger.map((r) => r.id)).toEqual(state.ledger.map((r) => r.id))
  })

  it('설정값이 config로 옮겨진다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    expect(split.config.lastBackupAt).toBe(state.settings.lastBackupAt)
  })

  it('관리자 전용 자리(memberPrivate)가 회원 수만큼 준비된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    expect(split.memberPrivate).toHaveLength(state.members.length)
    expect(split.memberPrivate.map((p) => p.memberId)).toEqual(state.members.map((m) => m.id))
    // 지금은 실제 개인정보를 넣지 않는다
    for (const p of split.memberPrivate) expect(Object.keys(p)).toEqual(['memberId'])
  })
})

describe('splitLegacyAppState — 값 보존', () => {
  it('핸디와 핸디 이력이 그대로 보존된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    for (const original of state.members) {
      const moved = split.members.find((m) => m.id === original.id)!
      expect(moved.handicap).toBe(original.handicap)
      expect(moved.handicapHistory).toEqual(original.handicapHistory)
    }
  })

  it('displayTag가 있으면 보존하고, 없으면 필드를 만들지 않는다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    const tagged = split.members.find((m) => m.id === 'member-6')!
    expect(tagged.displayTag).toBe('90학번 · 경영')

    const untagged = split.members.find((m) => m.id === 'member-1')!
    expect('displayTag' in untagged).toBe(false)
  })

  it('경기의 적용 핸디·점수·승자·상태가 모두 보존된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    for (const session of state.sessions) {
      for (const original of session.games) {
        const moved = split.games.find((g) => g.game.id === original.id)!.game
        expect(moved).toEqual(original)
      }
    }
  })

  it('명시적 승자(winnerId)와 무승부(null)가 구분되어 보존된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    const explicit = split.games.find((g) => g.game.id === 'game-s1-0')!.game
    expect(explicit.winnerId).toBe('member-1')

    const draw = split.games.find((g) => g.game.id === 'game-s1-1')!.game
    expect(draw.winnerId).toBeNull()
  })

  it('승인 대기·수정 요청 상태가 보존된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    const pending = split.games.find((g) => g.game.id === 'game-s2-0')!.game
    expect(pending.pending).toBe(true)

    const revision = split.games.find((g) => g.game.id === 'game-s2-1')!.game
    expect(revision.pending).toBe(true)
    expect(revision.revisionRequested).toBe(true)
  })

  it('세션의 대진표·라운드 참가자 정보가 보존된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    for (const original of state.sessions) {
      const moved = split.sessions.find((s) => s.id === original.id)!
      expect(moved.attendeeIds).toEqual(original.attendeeIds)
      expect(moved.lineup).toEqual(original.lineup)
      expect(moved.round1ParticipantIds).toEqual(original.round1ParticipantIds)
      expect(moved.round2ParticipantIds).toEqual(original.round2ParticipantIds)
      expect(moved.type).toBe(original.type)
      expect(moved.date).toBe(original.date)
    }
  })
})

describe('splitLegacyAppState — 비밀번호는 새 구조로 넘어가지 않는다', () => {
  it('공개 회원정보에 password가 없다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    for (const m of split.members) {
      expect('password' in m).toBe(false)
    }
  })

  it('관리자 전용 회원정보에도 password가 없다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)

    for (const p of split.memberPrivate) {
      expect('password' in p).toBe(false)
    }
  })

  it('나눈 결과 전체를 문자열로 만들어도 비밀번호 값이 나타나지 않는다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    const dumped = JSON.stringify(split)

    for (const m of state.members) {
      if (m.password) expect(dumped).not.toContain(m.password)
    }
  })
})

describe('splitLegacyAppState — 원본을 바꾸지 않는다', () => {
  it('입력 AppState가 변형되지 않는다', () => {
    const state = legacy()
    const before = JSON.parse(JSON.stringify(state))

    const split = splitLegacyAppState(state)
    // 결과를 마음대로 고쳐도
    split.members[0].name = '바뀐이름'
    split.members[0].handicapHistory[0].value = 999
    split.sessions[0].attendeeIds.push('member-999')
    split.games[0].game.scoreA = 999

    expect(state).toEqual(before)
  })

  it('세션에서 games를 떼어냈지만 원본 세션에는 games가 그대로 있다', () => {
    const state = legacy()
    splitLegacyAppState(state)
    expect(state.sessions[0].games.length).toBeGreaterThan(0)
  })
})

describe('validateSplit — 검증', () => {
  it('정상 데이터는 통과하고 개수를 보고한다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    const result = validateSplit(state, split)

    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.counts.members).toEqual({ legacy: 24, split: 24 })
    expect(result.counts.sessions).toEqual({ legacy: 18, split: 18 })
    expect(result.counts.games).toEqual({ legacy: legacyGameCount(state), split: legacyGameCount(state) })
    expect(result.counts.ledger).toEqual({ legacy: 32, split: 32 })
  })

  it('회원이 누락되면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    split.members.pop()

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('members 개수가 다릅니다')
  })

  it('경기가 누락되면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    split.games.pop()

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('games 개수가 다릅니다')
  })

  it('회원 ID가 중복되면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    split.members[1].id = split.members[0].id

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('회원 ID가 중복')
  })

  it('같은 모임 안에서 경기 ID가 중복되면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    const first = split.games.find((g) => g.sessionId === 'session-1')!
    const second = split.games.filter((g) => g.sessionId === 'session-1')[1]
    second.game.id = first.game.id

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('경기 ID가 중복')
  })

  it('ID가 비어 있으면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    split.sessions[0].id = ''

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('ID가 비어 있는 모임')
  })

  it('속한 모임이 없는 경기를 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    split.games[0].sessionId = 'session-없음'

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('속한 모임이 없는 경기')
  })

  it('공개 회원정보에 비밀번호가 섞이면 잡아낸다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    ;(split.members[0] as unknown as Record<string, unknown>).password = 'pw'

    const result = validateSplit(state, split)
    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('비밀번호가 들어 있습니다')
  })
})

describe('mergeSplitToAppState — 나눴다 합쳐도 같은 값', () => {
  it('비밀번호를 뺀 나머지가 원본과 완전히 같다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    const merged = mergeSplitToAppState(split)

    const expected: AppState = {
      ...state,
      members: state.members.map(withoutPassword),
    }
    expect(merged).toEqual(expected)
  })

  it('회원별로 핸디·이력·구분정보가 ID 기준으로 일치한다', () => {
    const state = legacy()
    const merged = mergeSplitToAppState(splitLegacyAppState(state))

    for (const original of state.members) {
      const back = merged.members.find((m) => m.id === original.id)!
      expect(back.name).toBe(original.name)
      expect(back.handicap).toBe(original.handicap)
      expect(back.handicapHistory).toEqual(original.handicapHistory)
      expect(back.active).toBe(original.active)
      expect(back.displayTag).toBe(original.displayTag)
    }
  })

  it('경기가 원래 속했던 모임으로 정확히 돌아간다', () => {
    const state = legacy()
    const merged = mergeSplitToAppState(splitLegacyAppState(state))

    for (const original of state.sessions) {
      const back = merged.sessions.find((s) => s.id === original.id)!
      expect(back.games).toEqual(original.games)
    }
  })

  it('합친 결과에는 비밀번호가 없다(새 구조에 없으므로)', () => {
    const state = legacy()
    const merged = mergeSplitToAppState(splitLegacyAppState(state))
    for (const m of merged.members) expect('password' in m).toBe(false)
  })
})

// 최종 보안 마감: 로그인이 더 이상 비밀번호를 쓰지 않으므로(memberLinks 기준 자동 로그인 +
// 미연결 기기는 DeviceConnectScreen), split 쪽에서 legacy 비밀번호를 가져와 합칠 필요 자체가
// 없어졌다. 대신 memberIndex(연결 안 된 기기도 읽을 수 있는 최소 이름 목록)가 새로 생겼다.
describe('splitLegacyAppState — memberIndex(이름 찾기 목록)', () => {
  it('회원 수와 ID가 members와 동일하게 유지된다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    expect(split.memberIndex).toHaveLength(state.members.length)
    expect(split.memberIndex.map((m) => m.id).sort()).toEqual(state.members.map((m) => m.id).sort())
  })

  it('이름·활성 여부·구분정보만 담고, 실적 데이터(핸디)나 비밀번호는 절대 담지 않는다', () => {
    const state = legacy()
    const split = splitLegacyAppState(state)
    for (const entry of split.memberIndex) {
      expect('password' in entry).toBe(false)
      expect('handicap' in entry).toBe(false)
      expect('handicapHistory' in entry).toBe(false)
    }
    const original = state.members.find((m) => m.id === split.memberIndex[0].id)!
    expect(split.memberIndex[0]).toEqual({
      id: original.id,
      name: original.name,
      active: original.active,
      ...(original.displayTag ? { displayTag: original.displayTag } : {}),
    })
  })
})
