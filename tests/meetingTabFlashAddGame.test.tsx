import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

// 실제 Firebase 호출부(cloudSync·splitFirestore)를 모킹 — 테스트는 절대 네트워크에 접근하지 않는다.
// MeetingTab이 import하는 split 함수 전부를 그대로 채워야 모듈 모킹이 성립한다.
const uploadToCloudMock = vi.fn()
const writeGameMock = vi.fn()
const writeSessionMock = vi.fn()
const deleteSplitSessionMock = vi.fn()
const submitMemberGameResultMock = vi.fn()
const updateFlashSessionAttendeesMock = vi.fn()

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
  toSessionDoc: (s: unknown) => s,
}))

import { MeetingTab } from '../src/tabs/MeetingTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import { todayStr } from '../src/lib/date'
import type { Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '회원A', handicap: 20, handicapHistory: [], active: true },
  { id: 'm2', name: '회원B', handicap: 20, handicapHistory: [], active: true },
  { id: 'm3', name: '회원C', handicap: 20, handicapHistory: [], active: true },
  { id: 'm4', name: '회원D', handicap: 20, handicapHistory: [], active: true },
]

const today = todayStr()

/** 번개모임 세션(승인 대기 상태 — 새로 만든 번개모임의 기본값). */
function flashSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'flash-1', date: today, type: 'flash', approved: false,
    attendeeIds: ['m1', 'm2', 'm3', 'm4'],
    games: [],
    ...overrides,
  }
}

function setSessions(sessions: Session[]) {
  useApp.setState({ members, sessions, settings: { lastBackupAt: null }, ledger: [] })
}

/**
 * "➕ 경기 추가" 패널 안으로 범위를 좁힌다.
 *
 * 화면 아래쪽 기존 "(대기)" 카드에도 같은 회원 이름 칩이 뜰 수 있으므로, 이름만으로 찾으면
 * 두 곳이 섞인다. 이 테스트가 검증하려는 건 오직 새 패널의 후보 목록이다.
 */
function addPanel() {
  const card = screen.getByText('경기할 두 명을 선택하세요').closest('.card')
  if (!card) throw new Error('경기 추가 패널을 찾지 못했습니다')
  return within(card as HTMLElement)
}

/** 패널에서 이름 칩을 누른다(선택 표시 ✓가 붙은 상태도 같은 칩으로 찾는다). */
function tapChip(name: string) {
  fireEvent.click(addPanel().getByRole('button', { name: new RegExp(`^(✓ )?${name}$`) }))
}

/** 패널에 보이는 후보 이름 목록. */
function candidateNames(): string[] {
  return addPanel()
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => t !== '닫기')
    .map((t) => t.replace(/^✓ /, ''))
}

/** 지금 열려 있는 대진 카드에 점수를 넣고 저장한다. */
function saveOngoingGame(scoreA: string, scoreB: string) {
  const scores = screen.getAllByPlaceholderText('득점')
  fireEvent.change(scores[0], { target: { value: scoreA } })
  fireEvent.change(scores[1], { target: { value: scoreB } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
}

beforeEach(() => {
  useAdmin.setState({ isAdmin: true })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
  writeGameMock.mockReset()
  writeGameMock.mockResolvedValue(undefined)
  writeSessionMock.mockReset()
  writeSessionMock.mockResolvedValue(undefined)
})

describe('번개모임 ➕ 경기 추가 — 시나리오 1: 첫 경기 후 같은 사람 재선택', () => {
  it('이미 경기를 마친 회원A·회원B가 후보에 다시 나타난다', () => {
    // 회원A-회원B 경기가 이미 완료된 상태의 번개모임
    setSessions([flashSession({
      games: [{
        id: 'g1', playerAId: 'm1', playerBId: 'm2',
        handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15,
        endType: 'cleared', playedAt: `${today}T10:00:00.000Z`, round: 1,
      }],
    })])

    render(<MeetingTab />)
    fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))

    // 이게 이번 수정의 핵심 — 완료된 경기 참가자도 후보로 남아야 한다.
    expect(candidateNames()).toEqual(['회원A', '회원B', '회원C', '회원D'])
  })

  it('완료된 경기 참가자끼리(회원A-회원B) 다시 대진을 만들 수 있다', () => {
    setSessions([flashSession({
      games: [{
        id: 'g1', playerAId: 'm1', playerBId: 'm2',
        handicapA: 20, handicapB: 20, scoreA: 20, scoreB: 15,
        endType: 'cleared', playedAt: `${today}T10:00:00.000Z`, round: 1,
      }],
    })])

    render(<MeetingTab />)
    fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))
    tapChip('회원A')
    tapChip('회원B')

    // 새 대진 카드(테이블 1)가 생기고, 점수 입력칸 2개가 열린다
    expect(screen.getByText('테이블 1')).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('득점')).toHaveLength(2)
    // 기존 완료 경기는 그대로 남아 있다
    expect(useApp.getState().sessions[0].games).toHaveLength(1)
  })
})

describe('번개모임 ➕ 경기 추가 — 시나리오 2: 입력 중인 선수 중복 방지', () => {
  it('점수 입력 중인 회원A·회원B는 후보에서 빠지고 회원C·회원D만 남는다', () => {
    setSessions([flashSession()])

    render(<MeetingTab />)
    fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))
    tapChip('회원A')
    tapChip('회원B')

    // 아직 저장하지 않은 대진 카드에 들어간 두 명은 후보에서 제외된다
    expect(candidateNames()).toEqual(['회원C', '회원D'])
  })

  it('같은 칩을 두 번 누르면 선택이 취소되고 대진이 만들어지지 않는다', () => {
    setSessions([flashSession()])

    render(<MeetingTab />)
    fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))
    tapChip('회원A')
    tapChip('회원A')

    expect(screen.queryByText('테이블 1')).toBeNull()
    expect(candidateNames()).toEqual(['회원A', '회원B', '회원C', '회원D'])
  })
})

describe('번개모임 ➕ 경기 추가 — 시나리오 3: 연속 3경기', () => {
  it('경기 추가 → 저장을 3번 반복하면 3경기가 각각 남고, 앞 경기 참가자를 계속 다시 쓸 수 있다', () => {
    setSessions([flashSession()])
    render(<MeetingTab />)

    fireEvent.click(screen.getByRole('button', { name: '➕ 경기 추가' }))

    // 1경기: 회원A - 회원B
    tapChip('회원A')
    tapChip('회원B')
    saveOngoingGame('20', '15')
    expect(useApp.getState().sessions[0].games).toHaveLength(1)

    // 저장하고 나면 두 사람이 다시 후보로 돌아온다
    expect(candidateNames()).toEqual(['회원A', '회원B', '회원C', '회원D'])

    // 2경기: 회원A - 회원C (1경기 참가자인 회원A를 다시 사용)
    tapChip('회원A')
    tapChip('회원C')
    saveOngoingGame('18', '20')
    expect(useApp.getState().sessions[0].games).toHaveLength(2)

    // 3경기: 회원B - 회원C (둘 다 앞 경기 참가자)
    tapChip('회원B')
    tapChip('회원C')
    saveOngoingGame('20', '12')

    const games = useApp.getState().sessions[0].games
    expect(games).toHaveLength(3)
    // 각 경기가 독립적으로 남는다(덮어쓰기 없음)
    expect(new Set(games.map((g) => g.id)).size).toBe(3)
    expect(games.map((g) => [g.playerAId, g.playerBId])).toEqual([
      ['m1', 'm2'],
      ['m1', 'm3'],
      ['m2', 'm3'],
    ])
    // 첫 경기 점수가 뒤 경기 저장으로 바뀌지 않았다
    expect(games[0].scoreA).toBe(20)
    expect(games[0].scoreB).toBe(15)
  })
})

describe('번개모임 ➕ 경기 추가 — 시나리오 4: 정기모임 영향 없음', () => {
  it('정기모임 화면에는 ➕ 경기 추가 버튼이 나타나지 않는다', () => {
    setSessions([{
      id: 'regular-1', date: today, type: 'regular',
      attendeeIds: ['m1', 'm2', 'm3', 'm4'], games: [],
    }])

    render(<MeetingTab />)
    expect(screen.queryByRole('button', { name: '➕ 경기 추가' })).toBeNull()
    // 정기모임 고유 흐름(라운드 참가자 선택·2라운드 자동매칭)은 그대로 남아 있다
    expect(screen.getByRole('button', { name: '🔀 1라운드 자동매칭' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '🔀 2라운드 자동매칭' })).toBeInTheDocument()
  })

  it('번개모임 화면에는 ➕ 경기 추가 버튼이 나타난다', () => {
    setSessions([flashSession()])

    render(<MeetingTab />)
    expect(screen.getByRole('button', { name: '➕ 경기 추가' })).toBeInTheDocument()
  })
})
