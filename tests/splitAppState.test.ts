import { describe, it, expect } from 'vitest'
import { splitLegacyAppState, validateSplit, mergeSplitToAppState, mergeLegacyPasswords } from '../src/logic/splitAppState'
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

// 보안 8단계: split을 앱의 기본 read 경로로 쓰기 시작하면 loadSplitAppState()가 비밀번호 없이
// AppState를 돌려준다(위 테스트가 확인한 그대로). 그런데 로그인 화면(LoginScreen)은 회원이 직접
// 정한 Member.password로 본인 확인을 하므로, 이 함수로 legacy 문서의 비밀번호를 회원 ID 기준으로
// 다시 채워 넣지 않으면 모든 회원의 비밀번호가 조용히 기본값('0000')으로 되돌아간 것처럼 보인다.
describe('mergeLegacyPasswords — split에서 사라진 비밀번호를 legacy에서 되찾아온다', () => {
  it('legacy에 있는 비밀번호를 회원 ID 기준으로 split 결과에 채워 넣는다', () => {
    const state = legacy()
    const splitState = mergeSplitToAppState(splitLegacyAppState(state))
    const merged = mergeLegacyPasswords(splitState, state)

    for (const original of state.members) {
      const back = merged.members.find((m) => m.id === original.id)!
      expect(back.password).toBe(original.password)
    }
  })

  it('비밀번호를 뺀 나머지 필드는 split 결과를 그대로 유지한다(legacy 값으로 덮어쓰지 않음)', () => {
    const state = legacy()
    const splitState = mergeSplitToAppState(splitLegacyAppState(state))
    const merged = mergeLegacyPasswords(splitState, state)

    for (const m of merged.members) expect(withoutPassword(m)).toEqual(withoutPassword(splitState.members.find((x) => x.id === m.id)!))
    expect(merged.sessions).toEqual(splitState.sessions)
    expect(merged.ledger).toEqual(splitState.ledger)
  })

  it('legacy 조회 결과가 없으면(null) split 결과를 그대로 돌려준다', () => {
    const state = legacy()
    const splitState = mergeSplitToAppState(splitLegacyAppState(state))
    const merged = mergeLegacyPasswords(splitState, null)
    expect(merged).toEqual(splitState)
  })

  it('legacy에 없는 회원 ID(예: 새 split 전용 회원)는 비밀번호를 채우지 않고 그대로 둔다', () => {
    const splitState: AppState = {
      members: [{ id: 'new-member', name: '새회원', handicap: 20, handicapHistory: [], active: true }],
      sessions: [], settings: { lastBackupAt: null }, ledger: [],
    }
    const merged = mergeLegacyPasswords(splitState, legacy())
    expect(merged.members[0]).toEqual(splitState.members[0])
    expect('password' in merged.members[0]).toBe(false)
  })
})
