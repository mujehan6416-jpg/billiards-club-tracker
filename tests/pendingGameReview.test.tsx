import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
  markSynced: vi.fn(),
  getLastSyncedAt: () => null,
  downloadFromCloud: vi.fn(),
}))

import { PendingGameRow } from '../src/tabs/SettingsTab'
import { useApp } from '../src/store/appStore'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const name = (id: string) => ({ m1: '테스트회원A', m2: '테스트회원B' }[id] ?? id)

beforeEach(() => {
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

function seedPendingGame() {
  const sessionId = useApp.getState().createSession('2026-07-10', ['m1', 'm2'], 'regular')
  useApp.getState().addGame(sessionId, {
    playerAId: 'm1', playerBId: 'm2', handicapA: 20, handicapB: 20, scoreA: 15, scoreB: 10, endType: 'time', round: 1, pending: true,
  })
  const game = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
  return { sessionId, game }
}

describe('PendingGameRow — 관리자 확인 완료 / 수정 요청', () => {
  it('pending 결과에 "확인 완료"와 "수정 요청" 버튼이 보인다', () => {
    const { sessionId, game } = seedPendingGame()
    render(<PendingGameRow game={game} sessionId={sessionId} sessionDate="2026-07-10" name={name} />)
    expect(screen.getByText('확인 완료')).toBeInTheDocument()
    expect(screen.getByText('수정 요청')).toBeInTheDocument()
  })

  it('확인 완료를 누르면 게임 상태가 confirmed(pending:false)로 저장된다', async () => {
    const { sessionId, game } = seedPendingGame()
    render(<PendingGameRow game={game} sessionId={sessionId} sessionDate="2026-07-10" name={name} />)
    fireEvent.click(screen.getByText('확인 완료'))
    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    const saved = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(saved.pending).toBe(false)
  })

  it('수정 요청을 누르면 pending은 유지되고 revisionRequested가 true로 저장된다(점수는 그대로)', async () => {
    const { sessionId, game } = seedPendingGame()
    render(<PendingGameRow game={game} sessionId={sessionId} sessionDate="2026-07-10" name={name} />)
    fireEvent.click(screen.getByText('수정 요청'))
    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    const saved = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    expect(saved.pending).toBe(true)
    expect(saved.revisionRequested).toBe(true)
    expect(saved.scoreA).toBe(15)
    expect(saved.scoreB).toBe(10)
  })

  it('수정 요청 후에는 "수정 요청됨" 배지가 표시되고 버튼이 비활성화된다', async () => {
    const { sessionId, game } = seedPendingGame()
    const { rerender } = render(<PendingGameRow game={game} sessionId={sessionId} sessionDate="2026-07-10" name={name} />)
    fireEvent.click(screen.getByText('수정 요청'))
    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))

    const updatedGame = useApp.getState().sessions.find((s) => s.id === sessionId)!.games[0]
    rerender(<PendingGameRow game={updatedGame} sessionId={sessionId} sessionDate="2026-07-10" name={name} />)
    expect(screen.getByText('수정 요청됨 — 참가자 재제출 대기')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수정 요청됨' })).toBeDisabled()
  })
})
