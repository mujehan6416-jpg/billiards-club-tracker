import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

// 리스타트 자동 대진 화면 흐름 테스트. Firestore는 전부 모킹하고, 이름·ID는 가상 데이터만 쓴다.

type Meta = { fromCache: boolean; hasPendingWrites: boolean }
type OnData = (matches: TournamentMatch[], meta: Meta) => void

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const setParticipantEntryStatusMock = vi.fn()
const writeTournamentParticipantMock = vi.fn()
const createRestartBracketMock = vi.fn()
const syncRestartJoinersMock = vi.fn()
const approveTournamentMatchMock = vi.fn()
const subscribers = new Map<string, OnData>()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: (id: string, onData: OnData) => { subscribers.set(id, onData); return () => subscribers.delete(id) },
  setParticipantEntryStatus: (...a: unknown[]) => setParticipantEntryStatusMock(...a),
  writeTournamentParticipant: (...a: unknown[]) => writeTournamentParticipantMock(...a),
  createRestartBracket: (...a: unknown[]) => createRestartBracketMock(...a),
  syncRestartJoiners: (...a: unknown[]) => syncRestartJoinersMock(...a),
  approveTournamentMatch: (...a: unknown[]) => approveTournamentMatchMock(...a),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { TournamentBracketView } from '../src/components/tournament/TournamentBracketView'
import { TournamentMatchPanel } from '../src/components/tournament/TournamentMatchPanel'
import { analyzeRestartSource, buildRestartBracket } from '../src/logic/tournamentRestartBracket'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Member } from '../src/types'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { decide, decideRound, fillJoiner, fullMain, mainWithByes, seededRng } from './fixtures/restartMain'

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
// 본선 참가자 문서의 id는 경기 안의 참가자 id(p1…)와 같다
const mainPeople = Array.from({ length: 16 }, (_, i) => person(i + 1, { id: `p${i + 1}` }))

const mainTournament: Tournament = {
  id: MAIN_ID, name: '가상 본선', date: '2026-10-05', timeLimitMinutes: 50, status: 'bracketFixed', bracketSize: 16,
  createdAt: '2026-10-01T00:00:00.000Z',
}
const restartDraft: Tournament = { ...mainTournament, id: RESTART_ID, name: '가상 본선 리스타트전', status: 'draft', bracketSize: undefined }

const mainR1 = decideRound(fullMain(16), 1)
const losers = [2, 4, 6, 8, 10, 12, 14, 16]
function restartMatchesFrom(source: TournamentMatch[]) {
  const a = analyzeRestartSource(source)
  if (!a.ok) throw new Error(a.message)
  const built = buildRestartBracket({
    sourceTournamentId: MAIN_ID, analysis: a.value, sourceMatches: source, rng: seededRng(5),
    entrants: losers.map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
  })
  if (!built.ok) throw new Error(built.message)
  return built.value.matches
}
const restartMatches = restartMatchesFrom(mainR1)
const restartFixed: Tournament = {
  ...mainTournament, id: RESTART_ID, name: '가상 본선 리스타트전', bracketSize: 16, restartSourceTournamentId: MAIN_ID,
}

const nameOf = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')
const noop = vi.fn()
const panel = (m: TournamentMatch, viewer: string | undefined, isAdmin = false) => render(
  <TournamentMatchPanel
    match={m} nameOf={nameOf} viewerMemberId={viewer} isAdmin={isAdmin}
    onClose={noop} onSubmitResult={noop} onAdminEnterResult={noop} onVerify={noop}
    onRequestCorrection={noop} onAdminVerify={noop} onAdminCorrect={noop} onApprove={noop} onForfeit={noop}
  />,
)

describe('합류 예약 자리 표시 (화면 컴포넌트)', () => {
  it('합류 자리는 빈 이름이 아니라 "본선 8강 탈락자 합류 예정"으로 보이고 "대기 중"이며, 부전승·경기 완료로 보이지 않는다', () => {
    render(<TournamentBracketView matches={restartMatches} nameOf={nameOf} />)
    fireEvent.click(screen.getByRole('button', { name: '8강' }))
    expect(screen.getAllByText('본선 8강 탈락자 합류 예정')).toHaveLength(4)
    expect(screen.getAllByText(/대기 중 · 합류자가 정해지면 시작합니다/)).toHaveLength(4)
    expect(screen.queryByText(/부전승/)).toBeNull()
    expect(screen.queryByText(/확정$/)).toBeNull()
  })

  it('합류자가 정해지면 안내 문구 대신 선수 이름이 보인다', () => {
    const filled = fillJoiner(restartMatches, 'r2m1', 3)
    render(<TournamentBracketView matches={filled} nameOf={nameOf} />)
    fireEvent.click(screen.getByRole('button', { name: '8강' }))
    expect(screen.getAllByText('본선 8강 탈락자 합류 예정')).toHaveLength(3)
    expect(screen.getByText('가상선수3')).toBeInTheDocument()
  })

  it('경기 상세: 상대가 정해지기 전에는 선수·관리자 모두 결과 입력칸이 없고 대기 안내가 보인다', () => {
    const waiting = { ...restartMatches.find((m) => m.id === 'r2m1')!, playerAParticipantId: 'm2', playerAMemberId: 'm2', playerAHandicapSnapshot: 20 }
    const asPlayer = panel(waiting, 'm2')
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByText('결과 입력')).toBeNull()
    expect(screen.getByText('상대(본선 탈락자)가 정해지면 시작할 수 있습니다. 지금은 대기 중입니다.')).toBeInTheDocument()
    asPlayer.unmount()

    panel(waiting, undefined, true)
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByText('관리자가 대신 입력')).toBeNull()
    expect(screen.getByText('상대(본선 탈락자)가 정해지면 시작할 수 있습니다. 지금은 대기 중입니다.')).toBeInTheDocument()
  })

  it('합류자가 정해진 경기는 평소처럼 결과 입력이 열린다', () => {
    const joined = fillJoiner(restartMatches, 'r2m1', 3).find((m) => m.id === 'r2m1')!
    panel({ ...joined, playerAParticipantId: 'm2', playerAMemberId: 'm2', playerAHandicapSnapshot: 20 }, 'm2')
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2)
  })
})

// ───────────────────────────── TournamentTab 연결 ─────────────────────────────

let restartPeople: TournamentParticipant[]

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}
function asMember(n = 1) {
  useAuth.setState({ memberId: `m${n}`, memberName: `가상선수${n}`, isGuest: false })
}

function serve(opts: { tournaments: Tournament[]; mainMatches?: TournamentMatch[]; restartMatches?: TournamentMatch[] }) {
  fetchTournamentsMock.mockResolvedValue(opts.tournaments)
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === MAIN_ID ? mainPeople : restartPeople))
  fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === MAIN_ID ? (opts.mainMatches ?? mainR1) : (opts.restartMatches ?? [])))
}

async function openTournament(name: string) {
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText(name))
  await screen.findByText(/경기 완료/)
}

beforeEach(() => {
  vi.clearAllMocks()
  subscribers.clear()
  restartPeople = members.map((m) => person(Number(m.id.slice(1)), { entryStatus: 'noResponse' }))
  setParticipantEntryStatusMock.mockImplementation(async (_t: string, pid: string, status: 'entered') => {
    restartPeople = restartPeople.map((p) => (p.id === pid ? { ...p, entryStatus: status } : p))
  })
  createRestartBracketMock.mockResolvedValue(undefined)
  syncRestartJoinersMock.mockResolvedValue(0)
  approveTournamentMatchMock.mockResolvedValue({})
  useApp.setState({ members })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
})
afterEach(() => { vi.restoreAllMocks() })

describe('리스타트 대진 자동 생성 (본선 화면, 관리자)', () => {
  async function openCreate(mainMatches = mainR1) {
    asAdmin()
    serve({ tournaments: [mainTournament, restartDraft], mainMatches })
    await openTournament('가상 본선')
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
  }

  it('본선 1차가 모두 승인되면 리스타트 대회가 자동 연결되어 곧바로 생성할 수 있고, 1차 탈락자 8명으로 11경기가 만들어진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openCreate()
    expect(screen.getByText('본선 1차 경기 8 / 8 최종 승인')).toBeInTheDocument()
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument() // 대상 대회를 고르지 않아도 이름으로 자동 연결
    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)

    await waitFor(() => expect(createRestartBracketMock).toHaveBeenCalledTimes(1))
    const [targetId, matches, input] = createRestartBracketMock.mock.calls[0]
    expect(targetId).toBe(RESTART_ID)
    expect(matches).toHaveLength(11)
    expect(input).toMatchObject({ sourceTournamentId: MAIN_ID, participantCount: 8 })
    // 1차 탈락자 8명이 대상 대회 참가(entered)로 들어갔다
    expect(setParticipantEntryStatusMock.mock.calls.map((c) => c[1]).sort()).toEqual([...losers.map((n) => `m${n}`)].sort())
    // 이미 확정된 본선 2차 패자가 있을 수 있으므로 생성 직후 합류 자리 배치도 한 번 확인한다
    expect(syncRestartJoinersMock).toHaveBeenCalledWith(RESTART_ID, 'skkubc')
    expect(await screen.findByText(/리스타트 대진을 만들었습니다\. 1차전 4경기, 본선 탈락자 합류 예정 자리 4개/)).toBeInTheDocument()
  })

  it('확인창에서 취소하면 아무것도 만들지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await openCreate()
    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    expect(createRestartBracketMock).not.toHaveBeenCalled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
  })

  it('본선 1차가 아직 다 승인되지 않았으면 만들 수 없다(승인 대기 경기는 반영하지 않음)', async () => {
    let partial = fullMain(16)
    for (let i = 1; i <= 7; i++) partial = decide(partial, `r1m${i}`)
    await openCreate(partial)
    expect(screen.getByText(/본선 1차 경기 7 \/ 8 최종 승인 — 모두 승인되면 대진을 만들 수 있습니다/)).toBeInTheDocument()
    expect(screen.getByText('리스타트 대진 자동 생성').closest('button')).toBeDisabled()
  })

  it('리스타트 대회에 본선 1차 탈락자가 아닌 참가자가 있으면 만들지 않고 안내한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    restartPeople = restartPeople.map((p) => (p.id === 'm1' ? { ...p, entryStatus: 'entered' as const } : p)) // 1차 승자인 가상선수1
    await openCreate()
    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    expect(await screen.findByText(/본선 1차 탈락자가 아닌 참가자가 있습니다/)).toBeInTheDocument()
    expect(createRestartBracketMock).not.toHaveBeenCalled()
  })

  it('합류 구조가 성립하지 않는 인원(12명)은 이유를 안내하고 만들지 않는다', async () => {
    await openCreate(decideRound(mainWithByes([2, 4, 6, 8]), 1))
    expect(screen.getByText(/리스타트 1차 생존자\(2명\)와 본선 2차 탈락자\(4명\) 수가 맞지 않아/)).toBeInTheDocument()
    expect(screen.queryByText('리스타트 대진 자동 생성')).toBeNull()
  })
})

describe('본선 승인 → 합류 자리 자동 배치', () => {
  it('관리자가 본선 2차 경기를 최종 승인하면 연결된 리스타트 대회의 합류 자리 배치를 요청한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    asAdmin()
    const pending = mainR1.map((m) => (m.id === 'r2m1'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId }
      : m))
    serve({ tournaments: [mainTournament, restartFixed], mainMatches: pending, restartMatches })
    await openTournament('가상 본선')
    fireEvent.click(screen.getByRole('button', { name: '8강' }))
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('관리자 확인을 기다리고 있습니다') || b.getAttribute('role') === 'button' && b.textContent?.includes('경기 1'))!)
    fireEvent.click(await screen.findByText('최종 승인'))
    await waitFor(() => expect(approveTournamentMatchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(syncRestartJoinersMock).toHaveBeenCalledWith(RESTART_ID, 'skkubc'))
  })

  it('합류 자리 배치가 실패해도 최종 승인은 유효하고, 다시 확인하라는 안내가 나온다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    asAdmin()
    syncRestartJoinersMock.mockRejectedValue(new Error('network'))
    const pending = mainR1.map((m) => (m.id === 'r2m1'
      ? { ...m, status: 'awaitingApproval' as const, scoreA: 20, scoreB: 5, calculatedWinnerParticipantId: m.playerAParticipantId }
      : m))
    serve({ tournaments: [mainTournament, restartFixed], mainMatches: pending, restartMatches })
    await openTournament('가상 본선')
    fireEvent.click(screen.getByRole('button', { name: '8강' }))
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('role') === 'button' && b.textContent?.includes('경기 1'))!)
    fireEvent.click(await screen.findByText('최종 승인'))
    expect(await screen.findByText(/최종 승인은 저장되었지만 리스타트 대회 합류 자리 배치는 하지 못했습니다/)).toBeInTheDocument()
  })
})

describe('리스타트 대회 화면', () => {
  it('관리자가 열면 합류 자리 자동 배치를 한 번 확인하고, 합류 현황·수동 확인 버튼을 보여주며, 전체 대진표 그림 토글과 보내기 UI는 없다', async () => {
    asAdmin()
    serve({ tournaments: [mainTournament, restartFixed], restartMatches })
    await openTournament('가상 본선 리스타트전')
    await waitFor(() => expect(syncRestartJoinersMock).toHaveBeenCalledWith(RESTART_ID, 'skkubc'))
    expect(syncRestartJoinersMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('본선 탈락자 합류 0 / 4자리 확정')).toBeInTheDocument()
    expect(screen.queryByText('전체 대진표')).toBeNull()
    expect(screen.queryByText('리스타트 참가자 보내기')).toBeNull()

    syncRestartJoinersMock.mockResolvedValue(2)
    fireEvent.click(screen.getByText('합류자 자동 배치 확인'))
    expect(await screen.findByText('본선 탈락자 2명을 합류 자리에 배치했습니다.')).toBeInTheDocument()
  })

  it('일반 회원이 열면 배치를 시도하지 않고 수동 확인 버튼도 없다(읽기만 한다)', async () => {
    asMember(2)
    serve({ tournaments: [mainTournament, restartFixed], restartMatches })
    await openTournament('가상 본선 리스타트전')
    expect(syncRestartJoinersMock).not.toHaveBeenCalled()
    expect(screen.queryByText('합류자 자동 배치 확인')).toBeNull()
    expect(screen.getByText('본선 탈락자 합류 0 / 4자리 확정')).toBeInTheDocument()
  })

  it('실시간: 합류자가 배치되면 새로고침 없이 합류 현황과 이름이 바뀐다', async () => {
    asMember(2)
    serve({ tournaments: [mainTournament, restartFixed], restartMatches })
    await openTournament('가상 본선 리스타트전')
    expect(subscribers.has(RESTART_ID)).toBe(true)
    act(() => subscribers.get(RESTART_ID)!(fillJoiner(restartMatches, 'r2m1', 3), { fromCache: false, hasPendingWrites: false }))
    expect(screen.getByText('본선 탈락자 합류 1 / 4자리 확정')).toBeInTheDocument()
  })

  it('일반(비 리스타트) 본선 화면에는 합류 현황이 나오지 않고 전체 대진표 보기가 그대로 있다', async () => {
    asMember(2)
    serve({ tournaments: [mainTournament, restartFixed] })
    await openTournament('가상 본선')
    expect(screen.queryByText(/본선 탈락자 합류/)).toBeNull()
    expect(screen.getByText('전체 대진표')).toBeInTheDocument()
  })
})

describe('15명 본선(부전승 1명) — 화면 흐름', () => {
  const main15 = decideRound(mainWithByes([16]), 1) // 가상선수15가 본선 1차 부전승

  it('본선 1차 실제 7경기가 모두 승인되면 7 / 7로 표시되고, 부전승 1명 자동 배정 안내와 함께 대진이 만들어진다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    asAdmin()
    serve({ tournaments: [mainTournament, restartDraft], mainMatches: main15 })
    await openTournament('가상 본선')
    fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
    expect(screen.getByText('본선 1차 경기 7 / 7 최종 승인')).toBeInTheDocument()
    expect(screen.getByText('리스타트 1차전 대상자 (7명)')).toBeInTheDocument()
    expect(screen.getByText(/이 7명으로 1차전을 자동으로 만들고\(부전승 1명은 추첨으로 자동 배정\)/)).toBeInTheDocument()
    // 본선 부전승 선수(가상선수15)는 1차전 대상자 목록에 없다(본선 대진표에는 원래 보이므로 목록 영역만 확인)
    const list = screen.getByText('리스타트 1차전 대상자 (7명)').parentElement!
    expect(list.textContent).not.toContain('가상선수15')
    expect(list.textContent).toContain('가상선수14')

    const button = screen.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)

    await waitFor(() => expect(createRestartBracketMock).toHaveBeenCalledTimes(1))
    const [, matches, input] = createRestartBracketMock.mock.calls[0] as [string, TournamentMatch[], { participantCount: number }]
    expect(input.participantCount).toBe(7)
    const r1 = matches.filter((m) => m.roundNumber === 1)
    expect(r1.filter((m) => m.resultType === 'bye')).toHaveLength(1)
    expect(r1.filter((m) => m.resultType === 'normal')).toHaveLength(3)
    expect(setParticipantEntryStatusMock.mock.calls.map((c) => c[1])).not.toContain('m15')
    expect(await screen.findByText(/1차전 3경기\(부전승 1명 자동 배정\), 본선 탈락자 합류 예정 자리 4개/)).toBeInTheDocument()
  })

  it('리스타트 대진 화면: 1차전에 부전승 1명이 "부전승"으로, 실제 경기 3개가 보인다', () => {
    const a = analyzeRestartSource(main15)
    if (!a.ok) throw new Error(a.message)
    const built = buildRestartBracket({
      sourceTournamentId: MAIN_ID, analysis: a.value, sourceMatches: main15, rng: seededRng(9),
      entrants: [2, 4, 6, 8, 10, 12, 14].map((n) => ({ participantId: `m${n}`, memberId: `m${n}`, handicap: 20 })),
    })
    if (!built.ok) throw new Error(built.message)
    render(<TournamentBracketView matches={built.value.matches} nameOf={nameOf} />)
    expect(screen.getAllByText('부전승으로 다음 라운드 진출')).toHaveLength(1)
    expect(screen.getAllByText('vs')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '8강' }))
    expect(screen.getAllByText('본선 8강 탈락자 합류 예정')).toHaveLength(4)
  })
})
