import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 실제 Firebase 호출부는 전부 모킹 — 테스트는 네트워크·운영 데이터에 접근하지 않는다.
const uploadToCloudMock = vi.fn()
const writeGameMock = vi.fn()
const writeSessionMock = vi.fn()
const deleteSplitSessionMock = vi.fn()
const deleteSplitGameMock = vi.fn()
const submitMemberGameResultMock = vi.fn()
const updateFlashSessionAttendeesMock = vi.fn()
const syncSplitChangesMock = vi.fn()

vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  writeGame: (...args: unknown[]) => writeGameMock(...args),
  writeSession: (...args: unknown[]) => writeSessionMock(...args),
  deleteSplitSession: (...args: unknown[]) => deleteSplitSessionMock(...args),
  deleteSplitGame: (...args: unknown[]) => deleteSplitGameMock(...args),
  submitMemberGameResult: (...args: unknown[]) => submitMemberGameResultMock(...args),
  updateFlashSessionAttendees: (...args: unknown[]) => updateFlashSessionAttendeesMock(...args),
  syncSplitChanges: (...args: unknown[]) => syncSplitChangesMock(...args),
  toSessionDoc: (s: unknown) => s,
}))
vi.mock('../src/lib/memberLink', () => ({ getLinkedMemberId: vi.fn().mockResolvedValue(null) }))
vi.mock('../src/lib/appAuth', () => ({ currentAuthUid: () => 'uid-device-1' }))

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
]

const today = todayStr()

function game(id: string): Game {
  return {
    id, playerAId: 'm1', playerBId: 'm2',
    handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15,
    endType: 'cleared', playedAt: `${today}T10:00:00.000Z`, round: 1,
  }
}

/** 경기 3건을 가진 정기모임. */
function sessionWithThreeGames(over: Partial<Session> = {}): Session {
  return {
    id: 's1', date: today, type: 'regular', approved: true,
    attendeeIds: ['m1', 'm2'],
    games: [game('game-1'), game('game-2'), game('game-3')],
    ...over,
  }
}

const gamesOf = (sessionId: string) =>
  useApp.getState().sessions.find((s) => s.id === sessionId)?.games ?? []
const gameIdsOf = (sessionId: string) => gamesOf(sessionId).map((g) => g.id)

function setSessions(sessions: Session[]) {
  useApp.setState({ members, sessions, settings: { lastBackupAt: null }, ledger: [] })
}

/** 완료 경기 목록의 index번째 ✕ 삭제 버튼을 누른다. */
function clickDelete(index: number) {
  fireEvent.click(screen.getAllByLabelText('삭제')[index])
}

beforeEach(() => {
  useAdmin.setState({ isAdmin: true })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  for (const m of [uploadToCloudMock, writeGameMock, writeSessionMock, deleteSplitSessionMock,
    deleteSplitGameMock, submitMemberGameResultMock, updateFlashSessionAttendeesMock, syncSplitChangesMock]) {
    m.mockReset()
    m.mockResolvedValue(undefined)
  }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('A. 선택한 경기 1건만 삭제', () => {
  it('가운데 경기(game-2)를 지우면 game-1·game-3은 그대로 남는다', async () => {
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1) // game-2

    await waitFor(() => expect(gameIdsOf('s1')).toEqual(['game-1', 'game-3']))
  })

  it('세션 자체는 삭제되지 않는다', async () => {
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1)

    await waitFor(() => expect(gameIdsOf('s1')).toHaveLength(2))
    expect(useApp.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(deleteSplitSessionMock).not.toHaveBeenCalled()
  })
})

describe('B. 서버 삭제 호출', () => {
  it('서버 삭제 함수가 (세션 ID, 경기 ID)로 정확히 1회 호출된다', async () => {
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1)

    await waitFor(() => expect(deleteSplitGameMock).toHaveBeenCalledTimes(1))
    expect(deleteSplitGameMock).toHaveBeenCalledWith('s1', 'game-2')
  })

  it('삭제 확인창에서 취소하면 서버 삭제도 로컬 삭제도 일어나지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1)

    await waitFor(() => expect(gameIdsOf('s1')).toHaveLength(3))
    expect(deleteSplitGameMock).not.toHaveBeenCalled()
  })
})

describe('C. 다른 세션 보호', () => {
  it('세션 A의 경기를 지워도 세션 B의 경기는 그대로다', async () => {
    const other: Session = {
      id: 's2', date: today, type: 'flash', approved: true,
      attendeeIds: ['m1', 'm2'], games: [game('other-1'), game('other-2')],
    }
    // 같은 날짜에 두 세션이 있으면 전환 탭이 뜨고 기본은 첫 세션(s1)이다.
    setSessions([sessionWithThreeGames(), other])
    render(<MeetingTab />)

    clickDelete(1)

    await waitFor(() => expect(gameIdsOf('s1')).toEqual(['game-1', 'game-3']))
    expect(gameIdsOf('s2')).toEqual(['other-1', 'other-2'])
    expect(deleteSplitGameMock).toHaveBeenCalledTimes(1)
    expect(deleteSplitGameMock).toHaveBeenCalledWith('s1', 'game-2')
  })
})

describe('D. 서버 삭제 실패 처리 (이번 결함의 핵심)', () => {
  it('서버 삭제가 실패하면 로컬에서도 지우지 않는다 — 화면과 서버가 어긋나지 않는다', async () => {
    deleteSplitGameMock.mockRejectedValue(new Error('permission-denied'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1)

    await waitFor(() => expect(window.alert).toHaveBeenCalled())
    // 예전 동작이라면 여기서 2건으로 줄어든 뒤 재접속 때 되살아났다.
    expect(gameIdsOf('s1')).toEqual(['game-1', 'game-2', 'game-3'])
  })

  it('실패를 조용히 넘기지 않고 사용자에게 안내한다', async () => {
    deleteSplitGameMock.mockRejectedValue(new Error('network'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(0)

    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1))
    const msg = String((window.alert as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
    expect(msg).toContain('삭제하지 못했습니다')
    expect(msg).toContain('그대로 남아 있습니다')
  })
})

describe('E. 재로드 관점 — 서버에서 지워졌으므로 되살아나지 않는다', () => {
  it('가짜 서버에서 삭제된 뒤 다시 내려받아도 그 경기는 복원되지 않는다', async () => {
    // 서버(Firestore games 하위 컬렉션)를 흉내 낸 가짜 저장소. 실제 운영 데이터가 아니다.
    const fakeServerGames = new Map<string, Game>([
      ['game-1', game('game-1')],
      ['game-2', game('game-2')],
      ['game-3', game('game-3')],
    ])
    deleteSplitGameMock.mockImplementation(async (_sessionId: string, gameId: string) => {
      fakeServerGames.delete(gameId)
    })

    setSessions([sessionWithThreeGames()])
    render(<MeetingTab />)

    clickDelete(1) // game-2
    await waitFor(() => expect(gameIdsOf('s1')).toEqual(['game-1', 'game-3']))

    // 서버 문서 자체가 지워졌는지 확인
    expect([...fakeServerGames.keys()]).toEqual(['game-1', 'game-3'])

    // 앱 재실행 = 서버 내용으로 로컬을 통째 교체(App.tsx의 replaceAll)하는 흐름을 흉내 낸다.
    useApp.getState().replaceAll({
      members,
      sessions: [{ ...sessionWithThreeGames(), games: [...fakeServerGames.values()] }],
      settings: { lastBackupAt: null },
      ledger: [],
    })

    expect(gameIdsOf('s1')).toEqual(['game-1', 'game-3'])
    expect(gameIdsOf('s1')).not.toContain('game-2')
  })
})

describe('F. 번개모임·정기모임 공통 경로', () => {
  it('정기모임에서도 서버 삭제가 호출된다', async () => {
    setSessions([sessionWithThreeGames({ type: 'regular' })])
    render(<MeetingTab />)

    clickDelete(0)

    await waitFor(() => expect(deleteSplitGameMock).toHaveBeenCalledWith('s1', 'game-1'))
    expect(gameIdsOf('s1')).toEqual(['game-2', 'game-3'])
  })

  it('번개모임에서도 서버 삭제가 호출된다', async () => {
    setSessions([sessionWithThreeGames({ type: 'flash', approved: true })])
    render(<MeetingTab />)

    clickDelete(0)

    await waitFor(() => expect(deleteSplitGameMock).toHaveBeenCalledWith('s1', 'game-1'))
    expect(gameIdsOf('s1')).toEqual(['game-2', 'game-3'])
  })

  it('번개모임에서 일반회원이 지워도 같은 경로로 서버 삭제가 호출된다', async () => {
    useAdmin.setState({ isAdmin: false })
    useAuth.setState({ memberId: 'm1', memberName: '회원A', isGuest: false })
    setSessions([sessionWithThreeGames({ type: 'flash', approved: true })])
    render(<MeetingTab />)

    clickDelete(0)

    await waitFor(() => expect(deleteSplitGameMock).toHaveBeenCalledWith('s1', 'game-1'))
  })
})
