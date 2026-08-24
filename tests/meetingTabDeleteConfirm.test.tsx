import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

import { MeetingTab } from '../src/tabs/MeetingTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import { todayStr } from '../src/lib/date'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
]

const game: Game = {
  id: 'g1', playerAId: 'm1', playerBId: 'm2',
  handicapA: 20, handicapB: 25, scoreA: 18, scoreB: 15,
  endType: 'time', playedAt: new Date().toISOString(), round: 1,
}

const session: Session = {
  id: 's1', date: todayStr(), type: 'regular', approved: true,
  attendeeIds: ['m1', 'm2'], games: [game],
}

const gamesOf = () => useApp.getState().sessions.find((s) => s.id === 's1')?.games ?? []

beforeEach(() => {
  useApp.setState({ members, sessions: [session], settings: { lastBackupAt: null }, ledger: [] })
  useAdmin.setState({ isAdmin: true })
  useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MeetingTab — 완료 경기 삭제 확인', () => {
  it('삭제 확인창에서 취소하면 경기가 남는다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MeetingTab />)

    fireEvent.click(screen.getByLabelText('삭제'))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0][0]).toContain('이 경기 기록을 삭제하시겠습니까?')
    expect(gamesOf()).toHaveLength(1)
  })

  it('삭제 확인창에서 확인해야 실제로 삭제된다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MeetingTab />)

    fireEvent.click(screen.getByLabelText('삭제'))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(gamesOf()).toHaveLength(0)
  })

  it('확인창에 어느 경기인지 선수 이름이 함께 나온다', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MeetingTab />)
    fireEvent.click(screen.getByLabelText('삭제'))

    const msg = String(confirmSpy.mock.calls[0][0])
    expect(msg).toContain('테스트회원A')
    expect(msg).toContain('테스트회원B')
  })
})

describe('MeetingTab — 확정 경기 수정 진입', () => {
  it('관리자에게 수정 버튼이 보이고, 눌러도 바로 저장되지 않는다', () => {
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    // 1단계 입력 화면이 뜨고, 저장은 아직 일어나지 않는다
    expect(screen.getByText('다음 (변경 내용 확인)')).toBeInTheDocument()
    expect(gamesOf()[0].scoreA).toBe(18)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })

  it('일반회원에게는 수정 버튼이 보이지 않는다', () => {
    useAdmin.setState({ isAdmin: false })
    render(<MeetingTab />)
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
  })
})
