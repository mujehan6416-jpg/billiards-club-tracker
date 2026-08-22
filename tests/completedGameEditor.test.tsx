import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

import { CompletedGameEditor } from '../src/components/meeting/CompletedGameEditor'
import { useApp } from '../src/store/appStore'
import { winnerId } from '../src/logic/game'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [{ value: 25, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

const savedGame: Game = {
  id: 'g1',
  playerAId: 'm1', playerBId: 'm2',
  handicapA: 20, handicapB: 25,
  scoreA: 10, scoreB: 20,
  endType: 'time',
  playedAt: '2026-07-10T00:00:00.000Z',
  round: 1,
}

const session: Session = {
  id: 's1', date: '2026-07-10', type: 'regular', approved: true,
  attendeeIds: ['m1', 'm2'], games: [savedGame],
}

const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id
const storedGame = () => useApp.getState().sessions.find((s) => s.id === 's1')!.games[0]

beforeEach(() => {
  useApp.setState({ members, sessions: [session], settings: { lastBackupAt: null }, ledger: [] })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

function renderEditor(onDone = vi.fn()) {
  render(<CompletedGameEditor game={savedGame} sessionId="s1" nameOf={nameOf} onDone={onDone} />)
  return { onDone }
}

describe('CompletedGameEditor — 저장된 경기의 적용 핸디·득점 수정', () => {
  it('현재 저장된 적용 핸디와 득점을 입력칸에 채워서 보여준다', () => {
    renderEditor()
    expect(screen.getByLabelText('테스트회원A 적용 핸디')).toHaveValue(20)
    expect(screen.getByLabelText('테스트회원A 득점')).toHaveValue(10)
    expect(screen.getByLabelText('테스트회원B 적용 핸디')).toHaveValue(25)
    expect(screen.getByLabelText('테스트회원B 득점')).toHaveValue(20)
  })

  it('적용 핸디와 득점을 고쳐 저장하면 경기에 반영되고 서버에 올린다', async () => {
    const { onDone } = renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 적용 핸디'), { target: { value: '22' } })
    fireEvent.change(screen.getByLabelText('테스트회원A 득점'), { target: { value: '21' } })
    fireEvent.click(screen.getByText('수정 저장'))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(storedGame().handicapA).toBe(22)
    expect(storedGame().scoreA).toBe(21)
    expect(onDone).toHaveBeenCalled()
  })

  it('수정 후 승패가 새 값 기준으로 바뀐다', async () => {
    // 수정 전: A 10/20(50%) vs B 20/25(80%) → B 승
    expect(winnerId(storedGame())).toBe('m2')
    renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 득점'), { target: { value: '19' } })
    fireEvent.click(screen.getByText('수정 저장'))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(winnerId(storedGame())).toBe('m1')
  })

  it('득점이 적용 핸디보다 크면 저장하지 않고 안내 문구를 보여준다', () => {
    const { onDone } = renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 득점'), { target: { value: '21' } })
    fireEvent.click(screen.getByText('수정 저장'))

    expect(screen.getByText('득점은 적용 핸디보다 클 수 없습니다.')).toBeInTheDocument()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(storedGame().scoreA).toBe(10)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('회원의 현재 핸디는 바뀌지 않는다', async () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 적용 핸디'), { target: { value: '22' } })
    fireEvent.click(screen.getByText('수정 저장'))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(useApp.getState().members.find((m) => m.id === 'm1')!.handicap).toBe(20)
  })

  it('취소를 누르면 아무것도 저장하지 않고 닫는다', () => {
    const { onDone } = renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 득점'), { target: { value: '19' } })
    fireEvent.click(screen.getByText('취소'))

    expect(storedGame().scoreA).toBe(10)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })
})
