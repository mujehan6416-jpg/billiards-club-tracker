import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 실제 Firebase 호출부는 모두 모킹 — 테스트는 네트워크에 접근하지 않는다.
const uploadToCloudMock = vi.fn()
const writeGameMock = vi.fn()
const writeSessionMock = vi.fn()
const deleteSplitSessionMock = vi.fn()
const submitMemberGameResultMock = vi.fn()
const updateFlashSessionAttendeesMock = vi.fn()
const syncSplitChangesMock = vi.fn()
const getLinkedMemberIdMock = vi.fn()
const currentAuthUidMock = vi.fn()

vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  writeGame: (...args: unknown[]) => writeGameMock(...args),
  writeSession: (...args: unknown[]) => writeSessionMock(...args),
  deleteSplitSession: (...args: unknown[]) => deleteSplitSessionMock(...args),
  submitMemberGameResult: (...args: unknown[]) => submitMemberGameResultMock(...args),
  updateFlashSessionAttendees: (...args: unknown[]) => updateFlashSessionAttendeesMock(...args),
  syncSplitChanges: (...args: unknown[]) => syncSplitChangesMock(...args),
  toSessionDoc: (s: unknown) => s,
}))
vi.mock('../src/lib/memberLink', () => ({
  getLinkedMemberId: (...args: unknown[]) => getLinkedMemberIdMock(...args),
}))
vi.mock('../src/lib/appAuth', () => ({
  currentAuthUid: () => currentAuthUidMock(),
}))

import { MeetingTab } from '../src/tabs/MeetingTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import { todayStr } from '../src/lib/date'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '회원B', handicap: 20, handicapHistory: [], active: true },
  { id: 'm3', name: '회원C', handicap: 20, handicapHistory: [], active: true },
  { id: 'm4', name: '회원D', handicap: 20, handicapHistory: [], active: true },
]

const today = todayStr()

function baseGame(over: Partial<Game> = {}): Game {
  return {
    id: 'g1', playerAId: 'm1', playerBId: 'm2',
    handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15,
    endType: 'cleared', playedAt: `${today}T10:00:00.000Z`, round: 1,
    ...over,
  }
}

function flashSession(over: Partial<Session> = {}): Session {
  return {
    id: 'flash-1', date: today, type: 'flash', approved: false,
    attendeeIds: ['m1', 'm2', 'm3', 'm4'], games: [], ...over,
  }
}

function setSessions(sessions: Session[]) {
  useApp.setState({ members, sessions, settings: { lastBackupAt: null }, ledger: [] })
}

/** 새 대진을 만들고 점수를 입력해 저장한다(번개모임 ➕ 경기 추가 경로). */
async function addAndSaveGame(aName: string, bName: string, scoreA = '20', scoreB = '15') {
  fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))
  const panel = screen.getByText('경기할 두 명을 선택하세요').closest('.card') as HTMLElement
  fireEvent.click(within(panel).getByRole('button', { name: new RegExp(`^(✓ )?${aName}$`) }))
  fireEvent.click(within(panel).getByRole('button', { name: new RegExp(`^(✓ )?${bName}$`) }))
  const scores = screen.getAllByPlaceholderText('득점')
  fireEvent.change(scores[0], { target: { value: scoreA } })
  fireEvent.change(scores[1], { target: { value: scoreB } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
}

/** 완료 경기 목록(.result-list)으로 범위를 좁힌다 — 화면 위쪽 모임 배지에도 "승인 대기"가 있어서 이름만으로 찾으면 섞인다. */
function resultList() {
  const ul = document.querySelector('.result-list')
  if (!ul) throw new Error('완료 경기 목록을 찾지 못했습니다')
  return within(ul as HTMLElement)
}

beforeEach(() => {
  useAdmin.setState({ isAdmin: true })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  for (const m of [uploadToCloudMock, writeGameMock, writeSessionMock, deleteSplitSessionMock,
    submitMemberGameResultMock, updateFlashSessionAttendeesMock, syncSplitChangesMock]) {
    m.mockReset()
    m.mockResolvedValue(undefined)
  }
  getLinkedMemberIdMock.mockReset()
  getLinkedMemberIdMock.mockResolvedValue(null)
  currentAuthUidMock.mockReset()
  currentAuthUidMock.mockReturnValue('uid-device-1')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

describe('입력자 저장 — 관리자 입력', () => {
  it('관리자 모드로 저장한 경기는 submittedByRole이 admin이고 memberId는 남기지 않는다', async () => {
    useAdmin.setState({ isAdmin: true })
    setSessions([flashSession()])
    render(<MeetingTab />)

    await addAndSaveGame('회원A', '회원B')

    await waitFor(() => expect(useApp.getState().sessions[0].games).toHaveLength(1))
    const g = useApp.getState().sessions[0].games[0]
    expect(g.submittedByRole).toBe('admin')
    expect(g.submittedByMemberId).toBeUndefined()
    // 관리자 경로는 제한 없는 writeGame으로 이 경기 하나만 서버에 쓴다
    expect(writeGameMock).toHaveBeenCalledTimes(1)
  })
})

describe('입력자 저장 — 회원 입력', () => {
  it('회원이 저장한 경기는 기기 연결(memberLinks) 기준 memberId를 입력자로 남긴다', async () => {
    useAdmin.setState({ isAdmin: false })
    // 앱에서 고른 이름은 m4지만, 기기 연결은 m3 — 신뢰 기준은 연결(m3)이어야 한다.
    useAuth.setState({ memberId: 'm4', memberName: '회원D', isGuest: false })
    getLinkedMemberIdMock.mockResolvedValue('m3')
    setSessions([flashSession()])
    render(<MeetingTab />)

    await addAndSaveGame('회원A', '회원B')

    await waitFor(() => expect(useApp.getState().sessions[0].games).toHaveLength(1))
    const g = useApp.getState().sessions[0].games[0]
    expect(g.submittedByRole).toBe('member')
    expect(g.submittedByMemberId).toBe('m3') // 로컬 선택(m4)이 아니라 기기 연결(m3)
    expect(g.pending).toBe(true)
    expect(submitMemberGameResultMock).toHaveBeenCalledTimes(1)
    expect(getLinkedMemberIdMock).toHaveBeenCalledWith('uid-device-1')
  })

  it('기기 연결을 확인하지 못하면 입력자를 추측해서 채우지 않는다', async () => {
    useAdmin.setState({ isAdmin: false })
    useAuth.setState({ memberId: 'm4', memberName: '회원D', isGuest: false })
    getLinkedMemberIdMock.mockResolvedValue(null)
    setSessions([flashSession()])
    render(<MeetingTab />)

    await addAndSaveGame('회원A', '회원B')

    await waitFor(() => expect(useApp.getState().sessions[0].games).toHaveLength(1))
    const g = useApp.getState().sessions[0].games[0]
    expect(g.submittedByRole).toBeUndefined()
    expect(g.submittedByMemberId).toBeUndefined()
  })
})

describe('화면 표시 — 승인 상태 · 입력자', () => {
  it('회원 입력 + 승인 전 → "승인 대기 · 입력: 회원C"', () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ pending: true, submittedByRole: 'member', submittedByMemberId: 'm3' })],
    })])
    render(<MeetingTab />)
    expect(screen.getByText(/승인 대기 · 입력: 회원C/)).toBeInTheDocument()
  })

  it('관리자 입력 + 승인 전 → "승인 대기 · 입력: 관리자"', () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ submittedByRole: 'admin' })],
    })])
    render(<MeetingTab />)
    expect(screen.getByText(/승인 대기 · 입력: 관리자/)).toBeInTheDocument()
  })

  it('승인 후 → "승인 완료"가 보이고 승인 대기는 사라진다', () => {
    setSessions([flashSession({
      approved: true,
      games: [baseGame({ submittedByRole: 'admin' })],
    })])
    render(<MeetingTab />)
    expect(screen.getByText(/승인 완료/)).toBeInTheDocument()
    expect(screen.queryByText(/승인 대기 · 입력/)).toBeNull()
  })

  it('입력자 필드가 없는 기존 경기는 상태만 표시하고 "알 수 없음"을 쓰지 않는다', () => {
    setSessions([flashSession({ approved: false, games: [baseGame()] })])
    render(<MeetingTab />)
    expect(resultList().getByText(/승인 대기/)).toBeInTheDocument()
    expect(resultList().queryByText(/입력:/)).toBeNull()
    expect(screen.queryByText(/알 수 없음/)).toBeNull()
    expect(screen.queryByText(/알수없음/)).toBeNull()
  })

  it('회원 명부에 없는 입력자 ID면 이름 대신 상태만 표시한다', () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ pending: true, submittedByRole: 'member', submittedByMemberId: 'm-deleted' })],
    })])
    render(<MeetingTab />)
    expect(resultList().getByText(/승인 대기/)).toBeInTheDocument()
    expect(resultList().queryByText(/입력:/)).toBeNull()
  })

  it('상태 문구 글씨는 14px 이상이다(고령 사용자 기준)', () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ submittedByRole: 'admin' })],
    })])
    render(<MeetingTab />)
    const label = screen.getByText(/승인 대기 · 입력: 관리자/)
    expect(parseInt(label.style.fontSize, 10)).toBeGreaterThanOrEqual(14)
  })

  it('정기모임 확정 경기에는 승인 문구를 붙이지 않는다(기존 화면 유지)', () => {
    setSessions([{
      id: 'regular-1', date: today, type: 'regular',
      attendeeIds: ['m1', 'm2'], games: [baseGame()],
    }])
    render(<MeetingTab />)
    expect(screen.queryByText(/승인 대기/)).toBeNull()
    expect(screen.queryByText(/승인 완료/)).toBeNull()
  })
})

describe('승인 서버 동기화 — 모임 화면 승인 버튼', () => {
  it('승인하면 서버 동기화 함수가 호출된다', async () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ pending: true, submittedByRole: 'member', submittedByMemberId: 'm3' })],
    })])
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    await waitFor(() => expect(syncSplitChangesMock).toHaveBeenCalledTimes(1))
  })

  it('승인 전/후 상태가 서버에 넘어간다 — 세션 approved와 경기 pending 해제가 모두 반영된다', async () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ pending: true, submittedByRole: 'member', submittedByMemberId: 'm3' })],
    })])
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    await waitFor(() => expect(syncSplitChangesMock).toHaveBeenCalledTimes(1))

    const [previous, next] = syncSplitChangesMock.mock.calls[0] as [
      { sessions: Session[] }, { sessions: Session[] },
    ]
    // 변경 전 스냅샷은 아직 미승인, 변경 후 스냅샷은 승인 + pending 해제
    expect(previous.sessions[0].approved).toBe(false)
    expect(previous.sessions[0].games[0].pending).toBe(true)
    expect(next.sessions[0].approved).toBe(true)
    expect(next.sessions[0].games[0].pending).toBe(false)
    // 입력자 정보는 승인 후에도 그대로 남는다
    expect(next.sessions[0].games[0].submittedByMemberId).toBe('m3')
    expect(next.sessions[0].games[0].submittedByRole).toBe('member')
  })

  it('승인 후 화면이 "승인 완료"로 바뀐다(재로드 없이도 동일 상태)', async () => {
    setSessions([flashSession({
      approved: false,
      games: [baseGame({ pending: true, submittedByRole: 'member', submittedByMemberId: 'm3' })],
    })])
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    await waitFor(() => expect(screen.getByText(/승인 완료 · 입력: 회원C/)).toBeInTheDocument())
  })

  it('서버 반영에 실패해도 로컬 승인은 유지하고 안내만 띄운다', async () => {
    syncSplitChangesMock.mockRejectedValue(new Error('network'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSessions([flashSession({ approved: false, games: [baseGame({ submittedByRole: 'admin' })] })])
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '승인' }))

    await waitFor(() => expect(window.alert).toHaveBeenCalled())
    expect(useApp.getState().sessions[0].approved).toBe(true)
  })
})

describe('기존 데이터 호환', () => {
  it('새 필드가 없는 기존 경기도 오류 없이 렌더링되고 결과가 그대로 보인다', () => {
    setSessions([{
      id: 'legacy-1', date: today, type: 'regular',
      attendeeIds: ['m1', 'm2'],
      games: [{
        id: 'old-1', playerAId: 'm1', playerBId: 'm2',
        handicapA: 0, handicapB: 0, scoreA: 30, scoreB: 25,
        endType: 'time', playedAt: '2020-01-01T00:00:00.000Z',
      }],
    }])
    expect(() => render(<MeetingTab />)).not.toThrow()
    expect(resultList().getByText(/회원A/)).toBeInTheDocument()
    expect(resultList().queryByText(/입력:/)).toBeNull()
  })
})
