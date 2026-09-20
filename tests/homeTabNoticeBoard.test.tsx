import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
vi.mock('../src/lib/appAuth', () => ({
  currentAuthUid: () => null,
  ensureAppAuth: vi.fn(),
  keepAppAuthAlive: vi.fn(() => () => {}),
}))
vi.mock('../src/lib/memberLink', () => ({
  getLinkedMemberId: vi.fn(async () => null),
}))
vi.mock('../src/lib/noticeFirestore', () => ({
  fetchNotices: vi.fn(async () => []),
  fetchMyReadNoticeIds: vi.fn(async () => []),
  markNoticeRead: vi.fn(),
  createNotice: vi.fn(),
  setNoticePinned: vi.fn(),
  updateNoticeText: vi.fn(),
  deleteNotice: vi.fn(),
}))

import { HomeTab } from '../src/tabs/HomeTab'
import { useAdmin } from '../src/store/adminStore'

beforeEach(() => {
  useAdmin.setState({ isAdmin: false })
})

describe('HomeTab — 로고 자리를 공지 게시판으로 바꾼 뒤', () => {
  it('학교 로고 이미지를 더 이상 그리지 않는다', async () => {
    const { container } = render(<HomeTab onNavigate={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('공지 게시판')).toBeInTheDocument())
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByAltText('성균관대학교 로고')).not.toBeInTheDocument()
  })

  it('로고가 있던 자리에 공지 게시판이 있다', async () => {
    render(<HomeTab onNavigate={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('공지 게시판')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '공지' })).toBeInTheDocument()
  })

  it('메뉴 카드 이름이 하단 탭과 같은 "통계"다(예전 "대시보드" 표기를 쓰지 않는다)', async () => {
    render(<HomeTab onNavigate={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('공지 게시판')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /통계/ })).toBeInTheDocument()
    expect(screen.queryByText('대시보드')).not.toBeInTheDocument()
  })

  it('기존 메뉴 네 개는 그대로 남아 있다', async () => {
    render(<HomeTab onNavigate={() => {}} />)
    await waitFor(() => expect(screen.getByLabelText('공지 게시판')).toBeInTheDocument())
    for (const label of ['회원', '모임', '통계', '대회']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('모임 메뉴를 누르면 그 탭으로 이동을 요청한다', async () => {
    const onNavigate = vi.fn()
    render(<HomeTab onNavigate={onNavigate} />)
    await waitFor(() => expect(screen.getByLabelText('공지 게시판')).toBeInTheDocument())
    screen.getByRole('button', { name: /모임/ }).click()
    expect(onNavigate).toHaveBeenCalledWith('meeting')
  })
})
