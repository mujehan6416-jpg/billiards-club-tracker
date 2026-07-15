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
