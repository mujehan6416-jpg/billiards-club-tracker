import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const currentAuthUidMock = vi.fn()
const getLinkedMemberIdMock = vi.fn()
const fetchNoticesMock = vi.fn()
const fetchMyReadNoticeIdsMock = vi.fn()
const markNoticeReadMock = vi.fn()
const createNoticeMock = vi.fn()
const setNoticePinnedMock = vi.fn()
const updateNoticeTextMock = vi.fn()
const deleteNoticeMock = vi.fn()

vi.mock('../src/lib/appAuth', () => ({
  currentAuthUid: () => currentAuthUidMock(),
  ensureAppAuth: vi.fn(),
  keepAppAuthAlive: vi.fn(() => () => {}),
}))
vi.mock('../src/lib/memberLink', () => ({
  getLinkedMemberId: (...a: unknown[]) => getLinkedMemberIdMock(...a),
}))
vi.mock('../src/lib/noticeFirestore', () => ({
  fetchNotices: (...a: unknown[]) => fetchNoticesMock(...a),
  fetchMyReadNoticeIds: (...a: unknown[]) => fetchMyReadNoticeIdsMock(...a),
  markNoticeRead: (...a: unknown[]) => markNoticeReadMock(...a),
  createNotice: (...a: unknown[]) => createNoticeMock(...a),
  setNoticePinned: (...a: unknown[]) => setNoticePinnedMock(...a),
  updateNoticeText: (...a: unknown[]) => updateNoticeTextMock(...a),
  deleteNotice: (...a: unknown[]) => deleteNoticeMock(...a),
}))

import { NoticeBoard } from '../src/components/notice/NoticeBoard'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useApp } from '../src/store/appStore'
import type { Notice } from '../src/types/notice'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const MEMBER_ID = 'member-001'
const OTHER_ID = 'member-002'
const UID = 'anon-uid-1'

function member(id: string, name: string): Member {
  return { id, name, handicap: 20, handicapHistory: [], active: true }
}

function notice(over: Partial<Notice> & { id: string }): Notice {
  return {
    title: '제목 ' + over.id,
    body: '내용 ' + over.id,
    pinned: false,
    status: 'published',
    authorMemberId: MEMBER_ID,
    authorName: '테스트회원A',
    createdAt: '2026-09-05T10:00:00+09:00',
    ...over,
  }
}

beforeEach(() => {
  currentAuthUidMock.mockReset(); currentAuthUidMock.mockReturnValue(UID)
  getLinkedMemberIdMock.mockReset(); getLinkedMemberIdMock.mockResolvedValue(MEMBER_ID)
  fetchNoticesMock.mockReset(); fetchNoticesMock.mockResolvedValue([])
  fetchMyReadNoticeIdsMock.mockReset(); fetchMyReadNoticeIdsMock.mockResolvedValue([])
  markNoticeReadMock.mockReset(); markNoticeReadMock.mockResolvedValue(['n1'])
  createNoticeMock.mockReset(); createNoticeMock.mockResolvedValue(undefined)
  setNoticePinnedMock.mockReset(); setNoticePinnedMock.mockResolvedValue(undefined)
  updateNoticeTextMock.mockReset(); updateNoticeTextMock.mockResolvedValue(undefined)
  deleteNoticeMock.mockReset(); deleteNoticeMock.mockResolvedValue(undefined)

  useAuth.setState({ memberId: MEMBER_ID, memberName: '테스트회원A', isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useApp.setState({ members: [member(MEMBER_ID, '테스트회원A'), member(OTHER_ID, '테스트회원B')] })
})

describe('NoticeBoard — 회원 화면(읽기 전용)', () => {
  it('공지를 불러와 홈에 5개까지만 보여준다', async () => {
    fetchNoticesMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) =>
        notice({ id: 'n' + i, title: '공지' + i, createdAt: '2026-09-' + String(10 + i) + 'T10:00:00+09:00' }),
      ),
    )
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('공지7')).toBeInTheDocument())
    expect(screen.queryByText('공지2')).not.toBeInTheDocument()
  })

  it('회원에게는 글 작성·수정·고정·삭제 버튼이 전혀 없다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1' })])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('제목 n1')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '글 작성' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '맨 위 고정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  it('승인 대기 목록과 승인 버튼은 어디에도 없다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1' })])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('제목 n1')).toBeInTheDocument())
    expect(screen.queryByText(/승인 대기/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '승인해서 올리기' })).not.toBeInTheDocument()
  })

  it('안 읽은 글에는 새 글 표시가 붙고, 펼치면 읽음으로 기록한다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1', title: '새 공지' })])
    markNoticeReadMock.mockResolvedValue(['n1'])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('새 글')).toBeInTheDocument())

    fireEvent.click(screen.getByText('새 공지'))
    await waitFor(() => expect(markNoticeReadMock).toHaveBeenCalledWith(MEMBER_ID, 'n1', []))
    await waitFor(() => expect(screen.queryByText('새 글')).not.toBeInTheDocument())
    expect(screen.getByText('내용 n1')).toBeInTheDocument()
  })

  it('이미 읽은 글에는 새 글 표시가 없고 다시 읽음 기록을 보내지 않는다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1', title: '읽은 공지' })])
    fetchMyReadNoticeIdsMock.mockResolvedValue(['n1'])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('읽은 공지')).toBeInTheDocument())
    expect(screen.queryByText('새 글')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('읽은 공지'))
    await waitFor(() => expect(screen.getByText('내용 n1')).toBeInTheDocument())
    expect(markNoticeReadMock).not.toHaveBeenCalled()
  })

  it('안 읽은 새 글이 읽은 고정글보다 위에 보인다', async () => {
    fetchNoticesMock.mockResolvedValue([
      notice({ id: 'pin', title: '고정 공지', pinned: true, createdAt: '2026-09-01T10:00:00+09:00' }),
      notice({ id: 'fresh', title: '새 공지', createdAt: '2026-09-09T10:00:00+09:00' }),
    ])
    fetchMyReadNoticeIdsMock.mockResolvedValue(['pin'])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('새 공지')).toBeInTheDocument())
    const titles = screen.getAllByRole('button', { expanded: false }).map((b) => b.textContent)
    expect(titles[0]).toContain('새 공지')
    expect(titles[1]).toContain('고정 공지')
  })

  it('기기가 회원으로 연결되지 않아도 공지는 읽을 수 있다', async () => {
    getLinkedMemberIdMock.mockResolvedValue(null)
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1', title: '공개 공지' })])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('공개 공지')).toBeInTheDocument())
    fireEvent.click(screen.getByText('공개 공지'))
    await waitFor(() => expect(screen.getByText('내용 n1')).toBeInTheDocument())
    // 연결이 없으면 읽음 기록을 남길 곳이 없으므로 서버에 보내지 않는다
    expect(markNoticeReadMock).not.toHaveBeenCalled()
  })

  it('작성자 이름이 바뀌면 회원 목록의 현재 이름으로 보여준다', async () => {
    fetchNoticesMock.mockResolvedValue([
      notice({ id: 'n1', authorMemberId: OTHER_ID, authorName: '옛이름' }),
    ])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText(/테스트회원B/)).toBeInTheDocument())
    expect(screen.queryByText(/옛이름/)).not.toBeInTheDocument()
  })

  it('회원으로 확인되지 않은 관리자가 쓴 글은 저장된 표기를 그대로 보여준다', async () => {
    fetchNoticesMock.mockResolvedValue([
      notice({ id: 'n1', authorMemberId: null, authorName: '관리자' }),
    ])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText(/관리자/)).toBeInTheDocument())
  })
})

describe('NoticeBoard — 관리자 화면', () => {
  beforeEach(() => {
    useAdmin.setState({ isAdmin: true })
  })

  it('회원으로 확인되면 그 회원의 실명으로 공지를 올린다', async () => {
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '글 작성' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '글 작성' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '관리자 공지' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '본문' } })
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))

    await waitFor(() => expect(createNoticeMock).toHaveBeenCalledWith({
      authorMemberId: MEMBER_ID, authorName: '테스트회원A', title: '관리자 공지', body: '본문',
    }))
    await waitFor(() => expect(screen.getByText('공지를 올렸습니다.')).toBeInTheDocument())
  })

  it('회원 연결로 실명을 확인할 수 없으면 임의의 실명을 붙이지 않고 관리자로 표기한다', async () => {
    getLinkedMemberIdMock.mockResolvedValue(null)
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '글 작성' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '글 작성' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '공지' } })
    fireEvent.change(screen.getByLabelText('내용'), { target: { value: '본문' } })
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))

    await waitFor(() => expect(createNoticeMock).toHaveBeenCalledWith({
      authorMemberId: null, authorName: '관리자', title: '공지', body: '본문',
    }))
  })

  it('연결된 회원이 회원 목록에 없으면 실명을 지어내지 않는다', async () => {
    getLinkedMemberIdMock.mockResolvedValue('member-unknown')
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '글 작성' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '글 작성' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '공지' } })
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))

    await waitFor(() => expect(createNoticeMock).toHaveBeenCalledWith({
      authorMemberId: null, authorName: '관리자', title: '공지', body: '',
    }))
  })

  it('수정 버튼으로 제목·내용을 고칠 수 있다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1', title: '원래 제목' })])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('원래 제목')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '고친 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))

    await waitFor(() => expect(updateNoticeTextMock).toHaveBeenCalledWith('n1', {
      title: '고친 제목', body: '내용 n1',
    }))
  })

  it('고정과 해제를 보낼 수 있다', async () => {
    fetchNoticesMock.mockResolvedValue([
      notice({ id: 'plain', title: '일반글' }),
      notice({ id: 'pinned', title: '고정글', pinned: true, createdAt: '2026-09-04T10:00:00+09:00' }),
    ])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '고정 해제' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '맨 위 고정' }))
    await waitFor(() => expect(setNoticePinnedMock).toHaveBeenCalledWith('plain', true))

    fireEvent.click(screen.getByRole('button', { name: '고정 해제' }))
    await waitFor(() => expect(setNoticePinnedMock).toHaveBeenCalledWith('pinned', false))
  })

  it('고정은 3개까지만 — 4번째 고정은 막고 서버에 보내지 않는다', async () => {
    fetchNoticesMock.mockResolvedValue([
      notice({ id: 'p1', pinned: true, createdAt: '2026-09-05T10:00:00+09:00' }),
      notice({ id: 'p2', pinned: true, createdAt: '2026-09-04T10:00:00+09:00' }),
      notice({ id: 'p3', pinned: true, createdAt: '2026-09-03T10:00:00+09:00' }),
      notice({ id: 'plain', title: '일반글', createdAt: '2026-09-02T10:00:00+09:00' }),
    ])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByText('일반글')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '맨 위 고정' }))
    await waitFor(() =>
      expect(screen.getByText('고정은 3개까지만 할 수 있습니다. 다른 고정을 먼저 해제해 주세요.')).toBeInTheDocument())
    expect(setNoticePinnedMock).not.toHaveBeenCalled()
  })

  it('삭제를 보낼 수 있다', async () => {
    fetchNoticesMock.mockResolvedValue([notice({ id: 'n1' })])
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deleteNoticeMock).toHaveBeenCalledWith('n1'))
  })

  it('제목이 비면 저장하지 않고 안내한다', async () => {
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '글 작성' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '글 작성' }))
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))
    await waitFor(() => expect(screen.getByText('제목을 입력해 주세요.')).toBeInTheDocument())
    expect(createNoticeMock).not.toHaveBeenCalled()
  })

  it('저장이 서버에서 거부되면 실패를 알려준다', async () => {
    createNoticeMock.mockRejectedValue(new Error('permission-denied'))
    render(<NoticeBoard />)
    await waitFor(() => expect(screen.getByRole('button', { name: '글 작성' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '글 작성' }))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '공지' } })
    fireEvent.click(screen.getByRole('button', { name: '올리기' }))
    await waitFor(() =>
      expect(screen.getByText('저장하지 못했습니다. 관리자 권한과 인터넷 연결을 확인해 주세요.')).toBeInTheDocument())
  })
})
