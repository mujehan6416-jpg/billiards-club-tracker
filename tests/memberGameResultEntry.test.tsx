import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

import { MemberGameResultEntry } from '../src/components/meeting/MemberGameResultEntry'
import { useApp } from '../src/store/appStore'
import type { Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 20, handicapHistory: [], active: true },
  { id: 'm3', name: '테스트회원C', handicap: 20, handicapHistory: [], active: true },
]

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1', date: '2026-07-10', type: 'regular',
    attendeeIds: ['m1', 'm2'],
    lineup: [{ round: 1, aId: 'm1', bId: 'm2', handicapA: 20, handicapB: 20 }],
    games: [],
    ...overrides,
  }
}

beforeEach(() => {
  useApp.setState({ members: [], sessions: [fakeSession()], settings: { lastBackupAt: null }, ledger: [] })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

describe('MemberGameResultEntry — 경기 참가자 본인 결과 입력', () => {
  it('경기 참가자면 결과 입력 폼이 보인다', () => {
    render(<MemberGameResultEntry session={fakeSession()} members={members} memberId="m1" />)
    expect(screen.getByText('결과 제출')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('내 득점')).toBeInTheDocument()
  })

  it('비참가자에게는 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<MemberGameResultEntry session={fakeSession()} members={members} memberId="m3" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('결과를 제출하면 pending:true인 게임이 store에 저장되고 Firestore 업로드가 호출된다', async () => {
    const session = fakeSession()
    render(<MemberGameResultEntry session={session} members={members} memberId="m1" />)
    fireEvent.change(screen.getByPlaceholderText('내 득점'), { target: { value: '18' } })
    fireEvent.change(screen.getByPlaceholderText('상대 득점'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('결과 제출'))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    const saved = useApp.getState().sessions.find((s) => s.id === 'session-1')!.games[0]
    expect(saved.pending).toBe(true)
    expect(saved.scoreA).toBe(18)
    expect(saved.scoreB).toBe(12)
  })

  it('제출 후에는 "관리자 확인 필요" 상태가 표시되고 다시 제출할 수 없다(입력폼 사라짐)', async () => {
    const sessionId = useApp.getState().createSession('2026-07-10', ['m1', 'm2'], 'regular')
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 18, scoreB: 12, endType: 'time', round: 1, pending: true,
    })
    const session = useApp.getState().sessions.find((s) => s.id === sessionId)!
    render(<MemberGameResultEntry session={{ ...session, lineup: [{ round: 1, aId: 'm1', bId: 'm2', handicapA: 20, handicapB: 20 }] }} members={members} memberId="m1" />)

    expect(screen.getByText(/관리자 확인 필요/)).toBeInTheDocument()
    expect(screen.queryByText('결과 제출')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('내 득점')).not.toBeInTheDocument()
  })

  it('확인 완료(pending:false)된 결과는 확정 표시만 하고 수정할 수 없다', () => {
    const session = fakeSession({
      games: [{ id: 'g1', playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15, endType: 'cleared', playedAt: '2026-07-10T00:00:00.000Z', round: 1 }],
    })
    render(<MemberGameResultEntry session={session} members={members} memberId="m1" />)
    expect(screen.getByText(/확정됨/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('내 득점')).not.toBeInTheDocument()
  })

  it('수정 요청(revisionRequested)된 결과는 안내 문구와 함께 다시 입력할 수 있다', async () => {
    const session = fakeSession({
      games: [{ id: 'g1', playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 10, scoreB: 8, endType: 'time', playedAt: '2026-07-10T00:00:00.000Z', round: 1, pending: true, revisionRequested: true }],
    })
    useApp.setState({ sessions: [session] })
    render(<MemberGameResultEntry session={session} members={members} memberId="m1" />)

    expect(screen.getByText(/수정을 요청했습니다/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('내 득점'), { target: { value: '20' } })
    fireEvent.change(screen.getByPlaceholderText('상대 득점'), { target: { value: '16' } })
    fireEvent.click(screen.getByText('결과 다시 제출'))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    const saved = useApp.getState().sessions.find((s) => s.id === 'session-1')!.games[0]
    expect(saved.scoreA).toBe(20)
    expect(saved.pending).toBe(true)
    expect(saved.revisionRequested).toBe(false)
  })

  it('재조회(store 재적재) 후에도 pending 상태가 유지된다', () => {
    const sessionId = useApp.getState().createSession('2026-07-10', ['m1', 'm2'], 'regular')
    useApp.getState().addGame(sessionId, {
      playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 18, scoreB: 12, endType: 'time', round: 1, pending: true,
    })
    const persisted = useApp.getState().sessions.find((s) => s.id === sessionId)!
    useApp.setState({ sessions: [] })
    useApp.setState({ sessions: [persisted] })
    const restored = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(restored.pending).toBe(true)
  })

  it('핸디보다 큰 점수를 입력하면 저장을 막고 store에 게임이 추가되지 않는다', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<MemberGameResultEntry session={fakeSession()} members={members} memberId="m1" />)
    fireEvent.change(screen.getByPlaceholderText('내 득점'), { target: { value: '25' } })
    fireEvent.click(screen.getByText('결과 제출'))

    expect(alertSpy).toHaveBeenCalledWith('오류: 핸디보다 많은 점수 입력')
    expect(useApp.getState().sessions.find((s) => s.id === 'session-1')!.games).toHaveLength(0)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
