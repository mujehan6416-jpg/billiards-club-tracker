import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 리스타트 대상 대회 자동 연결(본선 이름 + " 리스타트전") · 1차 탈락자/8강 탈락자 표시 구분 테스트.
// Firestore는 전부 모킹하고, 이름·ID는 가상 데이터만 쓴다.

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const setParticipantEntryStatusMock = vi.fn()
const writeTournamentParticipantMock = vi.fn()
const createRestartBracketMock = vi.fn()
const syncRestartJoinersMock = vi.fn()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: () => () => {},
  setParticipantEntryStatus: (...a: unknown[]) => setParticipantEntryStatusMock(...a),
  writeTournamentParticipant: (...a: unknown[]) => writeTournamentParticipantMock(...a),
  createRestartBracket: (...a: unknown[]) => createRestartBracketMock(...a),
  syncRestartJoiners: (...a: unknown[]) => syncRestartJoinersMock(...a),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Member } from '../src/types'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, seededRng } from './fixtures/restartMain'

const MAIN_ID = 'main'
const RESTART_ID = 'restart'
const members: Member[] = Array.from({ length: 16 }, (_, i) => ({
  id: `m${i + 1}`, name: `가상선수${i + 1}`, handicap: 20,
  handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true,
}))
const person = (n: number, over: Partial<TournamentParticipant> = {}): TournamentParticipant => ({
  id: `m${n}`, memberId: `m${n}`, displayNameSnapshot: `가상선수${n}`,
  baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered', ...over,
})
const mainPeople = Array.from({ length: 16 }, (_, i) => person(i + 1, { id: `p${i + 1}` }))

const mainTournament: Tournament = {
  id: MAIN_ID, name: '가상 본선', date: '2026-10-05', timeLimitMinutes: 50, status: 'bracketFixed', bracketSize: 16,
  createdAt: '2026-10-01T00:00:00.000Z',
}
const restartDraft: Tournament = { ...mainTournament, id: RESTART_ID, name: '가상 본선 리스타트전', status: 'draft', bracketSize: undefined }
const restartFixed: Tournament = { ...restartDraft, status: 'bracketFixed', bracketSize: 16, restartSourceTournamentId: MAIN_ID }

const mainR1 = decideRound(fullMain(16), 1)
const restartMatches = (() => {
  const a = analyzeRestartSource(mainR1)
  if (!a.ok) throw new Error(a.message)
  const built = buildRestartBracket({
    sourceTournamentId: MAIN_ID, analysis: a.value, sourceMatches: mainR1, rng: seededRng(5),
    entrants: [2, 4, 6, 8, 10, 12, 14, 16].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
  })
  if (!built.ok) throw new Error(built.message)
  return built.value.matches
})()

let restartPeople: TournamentParticipant[]

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}

async function openSender(tournaments: Tournament[], mainMatches: TournamentMatch[] = mainR1, restart: TournamentMatch[] = []) {
  asAdmin()
  fetchTournamentsMock.mockResolvedValue(tournaments)
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === MAIN_ID ? mainPeople : restartPeople))
  fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === MAIN_ID ? mainMatches : restart))
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText('가상 본선'))
  await screen.findByText(/경기 완료/)
  fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
}

beforeEach(() => {
  vi.clearAllMocks()
  restartPeople = members.map((m) => person(Number(m.id.slice(1)), { entryStatus: 'noResponse' }))
  setParticipantEntryStatusMock.mockImplementation(async (_t: string, pid: string, status: 'entered') => {
    restartPeople = restartPeople.map((p) => (p.id === pid ? { ...p, entryStatus: status } : p))
  })
  createRestartBracketMock.mockResolvedValue(undefined)
  syncRestartJoinersMock.mockResolvedValue(0)
  useApp.setState({ members })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
})
afterEach(() => { vi.restoreAllMocks() })

describe('리스타트 대회 자동 연결 (이름 규칙: 본선 이름 + " 리스타트전")', () => {
  it('이름이 정확히 일치하는 리스타트 대회로 자동 연결되고, 대상 대회를 고르는 목록은 없다', async () => {
    const other: Tournament = { ...restartDraft, id: 'other', name: '가상 다른 대회' }
    await openSender([mainTournament, restartDraft, other])
    expect(screen.getByText('리스타트 대회 (자동 연결)')).toBeInTheDocument()
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument()
    expect(screen.queryByText('가상 다른 대회')).toBeNull()
    expect(screen.queryByText(/보낼 대회/)).toBeNull()
  })

  it('"리스타트"라는 단어가 있어도 이름이 다른 대회는 연결하지 않고, 대회를 먼저 만들라고 안내한다', async () => {
    const wrong: Tournament = { ...restartDraft, id: 'wrong', name: '가상 본선 리스타트' }
    await openSender([mainTournament, wrong])
    expect(screen.getByText('리스타트 대회를 찾지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByText('필요한 이름: 가상 본선 리스타트전')).toBeInTheDocument() // 어떤 이름을 찾는지 화면에 보여 준다
    expect(screen.queryByText('리스타트 대진 자동 생성')).toBeNull()
  })

  it('같은 이름 대회가 여러 개고 날짜로도 못 가리면 아무것도 고르지 않고 중단한다', async () => {
    await openSender([mainTournament, restartDraft, { ...restartDraft, id: 'twin' }])
    expect(screen.getByText(/같은 이름의 리스타트 대회가 여러 개 있습니다/)).toBeInTheDocument()
    expect(screen.queryByText('리스타트 대진 자동 생성')).toBeNull()
  })

  it('같은 이름이 여러 개여도 본선과 날짜가 같은 대회가 하나면 그 대회로 연결해서 대진을 만든다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openSender([mainTournament, { ...restartDraft, id: 'old', date: '2026-04-18' }, restartDraft])
    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await waitFor(() => expect(createRestartBracketMock).toHaveBeenCalledTimes(1))
    expect(createRestartBracketMock.mock.calls[0][0]).toBe(RESTART_ID)
  })

  it('이미 대진이 확정된 대회가 연결되면 추가·생성을 막고 이유를 보여준다(대진을 취소하거나 다시 만들지 않음)', async () => {
    await openSender([mainTournament, { ...restartDraft, status: 'bracketFixed', bracketSize: 16 }])
    expect(screen.getByText('이미 대진이 확정된 대회에는 참가자를 추가할 수 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('리스타트 대진 자동 생성').closest('button')).toBeDisabled()
    expect(createRestartBracketMock).not.toHaveBeenCalled()
  })

  it('종료된 대회가 연결되면 추가·생성을 막는다', async () => {
    await openSender([mainTournament, { ...restartDraft, status: 'finished' }])
    expect(screen.getByText('이미 종료된 대회입니다.')).toBeInTheDocument()
    expect(screen.getByText('리스타트 대진 자동 생성').closest('button')).toBeDisabled()
  })
})

describe('1차 탈락자와 본선 8강 탈락자 표시 구분', () => {
  it('리스타트 1차전 대상자는 본선 1차 패자 8명뿐이고, 8강 탈락자는 별도 "합류" 영역에만 이름이 나온다', async () => {
    const main = decide(decide(mainR1, 'r2m1'), 'r2m2') // 8강 1·2경기 승인 → 패자(B) = 가상선수3, 가상선수7
    await openSender([mainTournament, restartDraft], main)
    // 본선 대진표에는 모든 선수 이름이 원래 보이므로, 보내기 패널 영역 안에서만 확인한다
    const panel = within(screen.getByText('리스타트 참가자 보내기', { selector: 'span' }).closest('.card')! as HTMLElement)
    expect(panel.getByText('리스타트 1차전 대상자 (8명)')).toBeInTheDocument()
    expect(panel.getByText('본선 8강 탈락자 → 리스타트 합류')).toBeInTheDocument()
    for (const n of [2, 4, 6, 8, 10, 12, 14, 16]) expect(panel.getAllByText(`가상선수${n}`)).toHaveLength(1)
    expect(panel.getAllByText('가상선수3')).toHaveLength(1) // 8강 탈락자는 합류 영역에만
    expect(panel.getAllByText('가상선수7')).toHaveLength(1)
    // 1차전 대상자 영역 안에는 8강 탈락자 이름이 없다
    const firstRoundBox = panel.getByText('리스타트 1차전 대상자 (8명)').nextElementSibling!.nextElementSibling as HTMLElement
    expect(firstRoundBox.textContent).not.toContain('가상선수3')
    expect(firstRoundBox.textContent).not.toContain('가상선수7')
    expect(panel.queryAllByRole('checkbox')).toHaveLength(0) // 자동 모드에서는 체크박스로 섞어 고르지 않는다
  })

  it('승인 전 8강 경기는 "승인 대기", 승인됐지만 아직 배치 전이면 "합류 대기"로 표시된다', async () => {
    await openSender([mainTournament, restartDraft], decide(mainR1, 'r2m1'))
    expect(screen.getAllByText('합류 대기')).toHaveLength(1)
    expect(screen.getAllByText('승인 대기')).toHaveLength(3)
    expect(screen.getByText('경기 2 결과 대기')).toBeInTheDocument()
  })

  it('승인 대기 중인 8강 결과(패자 미확정)는 이름이 나오지 않고 합류 처리도 되지 않는다', async () => {
    const pending = mainR1.map((m) => (m.id === 'r2m1'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId } : m))
    await openSender([mainTournament, restartDraft], pending)
    expect(screen.queryByText('합류 대기')).toBeNull()
    expect(screen.getAllByText('승인 대기')).toHaveLength(4)
    expect(syncRestartJoinersMock).not.toHaveBeenCalled()
  })

  it('리스타트 대진이 만들어진 뒤 예약 자리에 배치되면 "합류 완료"로 바뀌고, 1차전 대상자 목록은 더 이상 나오지 않는다', async () => {
    const main = decide(decide(mainR1, 'r2m1'), 'r2m2')
    await openSender([mainTournament, restartFixed], main, fillJoiner(restartMatches, 'r2m1', 3)) // 가상선수3만 배치 완료
    expect(await screen.findByText(/리스타트 대진이 이미 만들어졌습니다/)).toBeInTheDocument()
    expect(screen.queryByText(/리스타트 1차전 대상자/)).toBeNull()
    await waitFor(() => expect(screen.getAllByText('합류 완료')).toHaveLength(1))
    expect(screen.getAllByText('합류 대기')).toHaveLength(1) // 가상선수7은 패자 확정, 아직 미배치
  })

  it('일반 회원 화면에는 보내기·합류 현황 같은 관리자 영역이 없다', async () => {
    useAuth.setState({ memberId: 'm2', memberName: '가상선수2', isGuest: false })
    fetchTournamentsMock.mockResolvedValue([mainTournament, restartDraft])
    fetchTournamentParticipantsMock.mockResolvedValue(mainPeople)
    fetchTournamentMatchesMock.mockResolvedValue(decide(mainR1, 'r2m1'))
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    expect(screen.queryByText('리스타트 참가자 보내기')).toBeNull()
    expect(screen.queryByText(/리스타트 합류/)).toBeNull()
    expect(screen.queryByText('리스타트 대진 자동 생성')).toBeNull()
  })
})

describe('자동 연결 표시 · 상태 분리 · 목록 새로 읽기', () => {
  it('연결되면 "연결된 리스타트 대회"와 대회 이름, 찾은 이름 기준이 화면에 보인다', async () => {
    await openSender([mainTournament, restartDraft])
    expect(screen.getByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument()
    expect(screen.getByText('필요한 이름: 가상 본선 리스타트전')).toBeInTheDocument()
    expect(screen.getByText('리스타트 대진 자동 생성').closest('button')).not.toBeDisabled() // draft → 사용 가능
  })

  it('이름이 맞는 대회가 하나뿐이면 날짜가 달라도 연결된다', async () => {
    await openSender([mainTournament, { ...restartDraft, date: '2026-10-06' }])
    expect(screen.getByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(screen.queryByText('리스타트 대회를 찾지 못했습니다.')).toBeNull()
  })

  it('이름이 맞는 대회가 참가자 확정 상태여도 "못 찾았다"가 아니라 연결은 보이고 사용 불가 이유만 표시된다', async () => {
    await openSender([mainTournament, { ...restartDraft, status: 'entryClosed', participantCount: 8 }])
    expect(screen.getByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument()
    expect(screen.queryByText('리스타트 대회를 찾지 못했습니다.')).toBeNull()
    expect(screen.getByText(/연결된 리스타트 대회가 참가자 확정 상태라 추가할 수 없습니다/)).toBeInTheDocument()
    expect(screen.getByText('리스타트 대진 자동 생성').closest('button')).toBeDisabled()
  })

  it('대진 확정된 대회도 연결은 보이고 사용 불가 이유만 표시된다', async () => {
    await openSender([mainTournament, { ...restartDraft, status: 'bracketFixed', bracketSize: 16 }])
    expect(screen.getByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(screen.getByText('이미 대진이 확정된 대회에는 참가자를 추가할 수 없습니다.')).toBeInTheDocument()
  })

  it('글자 구성만 다른 같은 이름(자모 분리·앞뒤/연속 공백·보이지 않는 문자)도 연결된다', async () => {
    const odd: Tournament = {
      ...restartDraft,
      name: ' ​가상  본선 리스타트전 '.normalize('NFD'),
    }
    await openSender([mainTournament, odd])
    expect(screen.getByText('연결된 리스타트 대회')).toBeInTheDocument()
  })

  it('패널을 열면 대회 목록을 서버에서 다시 읽어, 처음 화면을 연 뒤 만들어진 리스타트 대회도 찾는다', async () => {
    asAdmin()
    fetchTournamentsMock.mockResolvedValueOnce([mainTournament]) // 화면을 처음 열었을 때는 리스타트 대회가 아직 없었다
    fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === MAIN_ID ? mainPeople : restartPeople))
    fetchTournamentMatchesMock.mockResolvedValue(mainR1)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    fetchTournamentsMock.mockResolvedValue([mainTournament, restartDraft]) // 다른 기기에서 방금 만들어짐
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(await screen.findByText('연결된 리스타트 대회')).toBeInTheDocument()
  })

  it('"연결 다시 확인"을 누르면 목록을 다시 읽고, 대상 대회를 고르는 목록은 여전히 없다', async () => {
    await openSender([mainTournament])
    expect(screen.getByText('리스타트 대회를 찾지 못했습니다.')).toBeInTheDocument()
    fetchTournamentsMock.mockResolvedValue([mainTournament, restartDraft])
    fireEvent.click(await screen.findByText('연결 다시 확인')) // 패널을 연 직후 자동 확인이 끝나면 다시 눌러진다
    expect(await screen.findByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(screen.queryByText(/보낼 대회/)).toBeNull()
  })
})
