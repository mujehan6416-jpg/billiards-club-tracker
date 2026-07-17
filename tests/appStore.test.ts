import { describe, it, expect, beforeEach } from 'vitest'
import { useApp } from '../src/store/appStore'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

beforeEach(() => {
  useApp.setState({
    members: [],
    sessions: [],
    settings: { lastBackupAt: null },
    ledger: [],
  })
})

describe('approveSession — 번개모임 승인 시 회원 입력 경기의 pending도 함께 해제', () => {
  it('회원이 입력한(pending) 경기가 있는 번개모임을 승인하면 세션 approved와 게임 pending이 모두 해제된다', () => {
    const sessionId = useApp.getState().createSession('2026-07-01', ['m1', 'm2'], 'flash')
    // 관리자가 아닌 회원이 저장한 경기 결과 (MeetingTab.save()의 isPending 로직과 동일하게 pending:true로 저장됨을 가정)
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2',
      handicapA: 20, handicapB: 20,
      scoreA: 20, scoreB: 15,
      endType: 'cleared',
      pending: true,
    })

    const before = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(before.approved).toBe(false) // 번개모임 생성 직후는 미승인 상태
    expect(before.games[0].pending).toBe(true)

    useApp.getState().approveSession(sessionId)

    const after = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(after.approved).toBe(true)
    expect(after.games[0].pending).toBe(false)

    // MeetingTab의 회원 노출 필터(isAdmin || !g.pending)를 그대로 재현 — 관리자가 아니어도 이제 보여야 한다
    const visibleToMember = after.games.filter((g) => !g.pending)
    expect(visibleToMember).toHaveLength(1)
  })

  it('관리자가 직접 입력해 pending이 없던 경기는 승인 후에도 그대로 유지된다(부작용 없음)', () => {
    const sessionId = useApp.getState().createSession('2026-07-02', ['m1', 'm2'], 'flash')
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2',
      handicapA: 20, handicapB: 20,
      scoreA: 20, scoreB: 10,
      endType: 'cleared',
      // pending 필드 없음 — 관리자가 직접 입력한 경우
    })
    useApp.getState().approveSession(sessionId)
    const after = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(after.approved).toBe(true)
    expect(after.games[0].pending).toBeUndefined()
  })

  it('정기모임(regular)은 생성 시 이미 approved:true이며, 승인 동작과 무관하게 pending 게임이 없다', () => {
    const sessionId = useApp.getState().createSession('2026-07-03', ['m1', 'm2'], 'regular')
    const session = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(session.approved).toBe(true)
  })
})

describe('requestGameRevision / resubmitGameResult / confirmGame — 일반회원 경기결과 관리자 확인·수정요청 흐름', () => {
  function seedPendingGame(overrides: { round?: number } = {}) {
    const sessionId = useApp.getState().createSession('2026-07-10', ['m1', 'm2'], 'regular')
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2',
      handicapA: 20, handicapB: 20,
      scoreA: 15, scoreB: 10,
      endType: 'time',
      round: overrides.round ?? 1,
      pending: true,
    })
    const gameId = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0].id
    return { sessionId, gameId }
  }

  it('requestGameRevision: pending은 유지하고 revisionRequested만 true로 저장한다', () => {
    const { sessionId, gameId } = seedPendingGame()
    useApp.getState().requestGameRevision(sessionId, gameId)
    const game = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(game.pending).toBe(true)
    expect(game.revisionRequested).toBe(true)
  })

  it('resubmitGameResult: 점수를 갱신하고 revisionRequested를 해제하며, pending은 계속 true로 남는다(다시 관리자 확인 대기)', () => {
    const { sessionId, gameId } = seedPendingGame()
    useApp.getState().requestGameRevision(sessionId, gameId)
    useApp.getState().resubmitGameResult(sessionId, gameId, { scoreA: 18, scoreB: 12, endType: 'time' })
    const game = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(game.scoreA).toBe(18)
    expect(game.scoreB).toBe(12)
    expect(game.pending).toBe(true)
    expect(game.revisionRequested).toBe(false)
  })

  it('confirmGame: pending과 revisionRequested를 모두 false로 저장한다(확인 완료)', () => {
    const { sessionId, gameId } = seedPendingGame()
    useApp.getState().requestGameRevision(sessionId, gameId)
    useApp.getState().confirmGame(sessionId, gameId)
    const game = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(game.pending).toBe(false)
    expect(game.revisionRequested).toBe(false)
  })

  it('resultStatus 필드가 없는 기존 경기 결과(pending 없음)는 관리자 입력 결과(확인 완료 상태)로 그대로 취급된다', () => {
    const sessionId = useApp.getState().createSession('2026-07-11', ['m1', 'm2'], 'regular')
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 18, endType: 'cleared',
      // pending, revisionRequested 모두 없음 — 관리자가 직접 입력한 기존 데이터를 그대로 재현
    })
    const game = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(game.pending).toBeUndefined()
    expect(game.revisionRequested).toBeUndefined()
  })
})

describe('setRoundParticipants — 라운드별 참가자 명단 저장', () => {
  it('round1과 round2를 각각 독립적으로 저장한다(한쪽을 바꿔도 다른 쪽은 그대로)', () => {
    const sessionId = useApp.getState().createSession('2026-07-04', ['m1', 'm2', 'm3'], 'regular')
    useApp.getState().setRoundParticipants(sessionId, 1, ['m1', 'm2'])
    useApp.getState().setRoundParticipants(sessionId, 2, ['m1', 'm3'])
    const session = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(session.round1ParticipantIds).toEqual(['m1', 'm2'])
    expect(session.round2ParticipantIds).toEqual(['m1', 'm3'])
  })

  it('round1을 다시 저장해도 이미 저장된 round2는 바뀌지 않는다', () => {
    const sessionId = useApp.getState().createSession('2026-07-05', ['m1', 'm2', 'm3'], 'regular')
    useApp.getState().setRoundParticipants(sessionId, 2, ['m1', 'm3'])
    useApp.getState().setRoundParticipants(sessionId, 1, ['m2', 'm3'])
    const session = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(session.round1ParticipantIds).toEqual(['m2', 'm3'])
    expect(session.round2ParticipantIds).toEqual(['m1', 'm3']) // 1라운드 저장으로 영향받지 않음
  })

  it('필드가 없는 기존 세션은 undefined로 남아 attendeeIds 전체를 기본값으로 쓸 수 있다', () => {
    const sessionId = useApp.getState().createSession('2026-07-06', ['m1', 'm2'], 'regular')
    const session = useApp.getState().sessions.find((s) => s.id === sessionId)!
    expect(session.round1ParticipantIds).toBeUndefined()
    expect(session.round2ParticipantIds).toBeUndefined()
  })
})
