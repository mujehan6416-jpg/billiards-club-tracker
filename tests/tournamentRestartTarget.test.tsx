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
const ensureTournamentDocMock = vi.fn()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: () => () => {},
  setParticipantEntryStatus: (...a: unknown[]) => setParticipantEntryStatusMock(...a),
  writeTournamentParticipant: (...a: unknown[]) => writeTournamentParticipantMock(...a),
  createRestartBracket: (...a: unknown[]) => createRestartBracketMock(...a),
  syncRestartJoiners: (...a: unknown[]) => syncRestartJoinersMock(...a),
  ensureTournamentDoc: (...a: unknown[]) => ensureTournamentDocMock(...a),
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
/** 서버에 있는 대회 목록 흉내 — 자동 생성하면 여기에 추가되고, 이후 fetchTournaments가 그것을 돌려준다. */
let server: Tournament[] = []

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}

async function openSender(tournaments: Tournament[], mainMatches: TournamentMatch[] = mainR1, restart: TournamentMatch[] = []) {
  asAdmin()
  server = [...tournaments]
  fetchTournamentsMock.mockImplementation(async () => [...server])
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
  // 없을 때만 생성(트랜잭션 흉내): 이미 같은 id가 있으면 만들지 않는다
  ensureTournamentDocMock.mockImplementation(async (t: Tournament) => {
    if (server.some((x) => x.id === t.id)) return { created: false }
    server.push(t)
    return { created: true }
  })
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

  it('"리스타트"라는 단어가 있어도 이름이 다른 대회는 연결하지 않고, 정확한 이름의 대회를 자동으로 만든다(다른 대회는 그대로)', async () => {
    const wrong: Tournament = { ...restartDraft, id: 'wrong', name: '가상 본선 리스타트' }
    await openSender([mainTournament, wrong])
    expect(await screen.findByText(/연결된 리스타트 대회/)).toBeInTheDocument()
    expect(ensureTournamentDocMock).toHaveBeenCalledTimes(1)
    expect(ensureTournamentDocMock.mock.calls[0][0]).toMatchObject({ name: '가상 본선 리스타트전' })
    expect(server.find((t) => t.id === 'wrong')).toEqual(wrong) // 이름이 다른 대회는 건드리지 않는다
    expect(screen.queryByText(/먼저 만들어 주세요/)).toBeNull()
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
    expect(screen.getByText('리스타트 대회 이름: 가상 본선 리스타트전')).toBeInTheDocument()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled() // 이미 있으면 새로 만들지 않는다
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

  it('자동 생성에 실패하면 오류와 "리스타트 대회 다시 준비" 버튼만 보이고(수동 선택 UI 없음), 다시 누르면 만들어져 연결된다', async () => {
    ensureTournamentDocMock.mockRejectedValueOnce(new Error('network'))
    await openSender([mainTournament])
    expect(await screen.findByText('리스타트 대회를 자동으로 만들지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText('리스타트 대진 자동 생성')).toBeNull()
    expect(screen.queryByText(/보낼 대회/)).toBeNull()
    fireEvent.click(screen.getByText('리스타트 대회 다시 준비'))
    expect(await screen.findByText(/연결된 리스타트 대회/)).toBeInTheDocument()
    expect(server.filter((t) => t.name === '가상 본선 리스타트전')).toHaveLength(1)
  })
})

describe('관리자 진단 정보 (연결이 안 될 때 원인 구분용)', () => {
  it('앱 버전과 읽은 대회 수가 보이고, 최신 버전과 같으면 "최신 버전"으로 표시된다', async () => {
    // 서버의 index.html이 지금 실행 중인 번들과 같은 해시를 내려주는 상황(테스트 환경의 실행 중 버전은 "개발 실행")
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => '<script src="/assets/index-AbC123.js"></script>' })))
    await openSender([mainTournament, restartDraft])
    expect(screen.getByText(/앱 버전: 개발 실행/)).toBeInTheDocument()
    expect(screen.getByText('읽은 대회 2개')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('자동 생성에 실패했을 때는 읽은 다른 대회 이름이 그대로 보이고, 눈에 안 보이는 문자가 있으면 표시한다', async () => {
    ensureTournamentDocMock.mockRejectedValue(new Error('network'))
    const odd: Tournament = { ...restartDraft, id: 'odd', name: '가상 본선 리스타트 ' }
    const nonsense: Tournament = { ...restartDraft, id: 'n', name: '가상 다른 대회' }
    await openSender([mainTournament, odd, nonsense])
    expect(await screen.findByText('리스타트 대회를 자동으로 만들지 못했습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('읽은 다른 대회 이름:')).toBeInTheDocument()
    expect(screen.getByText(/「가상 본선 리스타트 」 ※ 앞뒤 공백·눈에 안 보이는 문자가 있어 정리해서 비교함/)).toBeInTheDocument()
    expect(screen.getByText('「가상 다른 대회」')).toBeInTheDocument()
  })

  it('연결에 성공하면 이름 목록은 나오지 않는다(진단은 못 찾을 때만 상세)', async () => {
    await openSender([mainTournament, restartDraft])
    expect(screen.queryByText('읽은 다른 대회 이름:')).toBeNull()
  })

  it('일반 회원에게는 진단 정보도 보이지 않는다', async () => {
    useAuth.setState({ memberId: 'm2', memberName: '가상선수2', isGuest: false })
    fetchTournamentsMock.mockResolvedValue([mainTournament, restartDraft])
    fetchTournamentParticipantsMock.mockResolvedValue(mainPeople)
    fetchTournamentMatchesMock.mockResolvedValue(mainR1)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    expect(screen.queryByText(/앱 버전/)).toBeNull()
    expect(screen.queryByText(/읽은 대회/)).toBeNull()
  })
})

describe('리스타트 대회 자동 생성 (본선 "리스타트 참가자 보내기"를 열 때)', () => {
  it('리스타트 대회가 없으면 패널을 여는 즉시 자동 생성하고 바로 연결한다(운영자가 만들 필요 없음)', async () => {
    await openSender([mainTournament])
    expect(await screen.findByText('연결된 리스타트 대회 (자동 생성됨)')).toBeInTheDocument()
    expect(screen.getByText('가상 본선 리스타트전')).toBeInTheDocument()
    expect(ensureTournamentDocMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/먼저 만들어 주세요/)).toBeNull()
    expect(screen.queryByText(/찾지 못했습니다/)).toBeNull()
  })

  it('자동 생성되는 대회: 이름 = 본선 이름 + " 리스타트전", 날짜·제한시간은 본선과 동일, 참가 신청 전(draft), 대진·종료 없음', async () => {
    await openSender([mainTournament])
    await screen.findByText(/자동 생성됨/)
    const created = ensureTournamentDocMock.mock.calls[0][0] as Tournament
    expect(created).toMatchObject({
      id: `restart-${MAIN_ID}`, name: '가상 본선 리스타트전', date: mainTournament.date,
      timeLimitMinutes: mainTournament.timeLimitMinutes, status: 'draft',
    })
    expect(created.bracketSize).toBeUndefined()
    expect(created.participantCount).toBeUndefined()
    expect(created.completedAt).toBeUndefined()
    expect(created.restartSourceTournamentId).toBeUndefined()
  })

  it('본선 참가자는 복사하지 않고 참가자 문서도 미리 만들지 않는다', async () => {
    await openSender([mainTournament])
    await screen.findByText(/자동 생성됨/)
    expect(writeTournamentParticipantMock).not.toHaveBeenCalled()
    expect(setParticipantEntryStatusMock).not.toHaveBeenCalled()
    expect(ensureTournamentDocMock.mock.calls[0]).toHaveLength(2) // (대회 문서, clubId)만 — 참가자 목록을 넘기지 않는다
  })

  it('이미 있으면(이름 일치) 새로 만들지 않고 기존 대회를 그대로 연결한다', async () => {
    await openSender([mainTournament, restartDraft])
    expect(await screen.findByText('연결된 리스타트 대회')).toBeInTheDocument()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled()
    expect(server).toHaveLength(2)
  })

  it('자동 생성한 대회는 이름을 나중에 고쳐도(고정 id) 같은 대회로 연결되어 새로 만들지 않는다', async () => {
    const renamed: Tournament = { ...restartDraft, id: `restart-${MAIN_ID}`, name: '이름을 고친 대회' }
    await openSender([mainTournament, renamed])
    expect(await screen.findByText('이름을 고친 대회')).toBeInTheDocument()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled()
  })

  it('패널을 닫았다 여러 번 다시 열어도 리스타트 대회는 1개만 있다', async () => {
    await openSender([mainTournament])
    await screen.findByText(/자동 생성됨/)
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByText('닫기'))
      fireEvent.click(screen.getByText('리스타트 참가자 보내기'))
      await screen.findByText(/연결된 리스타트 대회/)
    }
    expect(server.filter((t) => t.name === '가상 본선 리스타트전')).toHaveLength(1)
    expect(ensureTournamentDocMock).toHaveBeenCalledTimes(1) // 처음 한 번만 생성을 시도했다
  })

  it('다른 기기가 방금 먼저 만들었다면(동시 생성) 새로 만들지 않고 그 대회를 쓴다 — 중복 없음', async () => {
    // 이 기기가 목록을 읽은 직후 다른 기기가 같은 고정 id로 먼저 만든 상황: 생성 시도는 "이미 있음"으로 끝난다
    ensureTournamentDocMock.mockImplementationOnce(async (t: Tournament) => {
      server.push({ ...t, createdAt: '2026-10-05T09:00:00.000Z' })
      return { created: false }
    })
    await openSender([mainTournament])
    expect(await screen.findByText('연결된 리스타트 대회')).toBeInTheDocument() // "(자동 생성됨)"은 붙지 않는다
    expect(screen.queryByText(/자동 생성됨/)).toBeNull()
    expect(server.filter((t) => t.name === '가상 본선 리스타트전')).toHaveLength(1)
  })

  it('같은 이름의 리스타트 대회가 이미 여러 개면 새로 만들지 않고 중단 안내를 보여준다', async () => {
    await openSender([mainTournament, restartDraft, { ...restartDraft, id: 'twin' }])
    expect(await screen.findByText('같은 이름의 리스타트 대회가 여러 개 있습니다.')).toBeInTheDocument()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled()
    expect(server).toHaveLength(3)
  })

  it('자동 생성 직후에도 본선 1차 탈락자는 1차전 대상자, 8강 탈락자는 별도 합류 영역에만 나온다(자동 대진 기능 그대로)', async () => {
    const main = decide(decide(mainR1, 'r2m1'), 'r2m2')
    await openSender([mainTournament], main)
    await screen.findByText(/자동 생성됨/)
    const panel = within(screen.getByText('리스타트 참가자 보내기', { selector: 'span' }).closest('.card')! as HTMLElement)
    expect(panel.getByText('리스타트 1차전 대상자 (8명)')).toBeInTheDocument()
    expect(panel.getByText('본선 8강 탈락자 → 리스타트 합류')).toBeInTheDocument()
    expect(panel.getAllByText('합류 대기')).toHaveLength(2)
    const button = panel.getByText('리스타트 대진 자동 생성').closest('button')!
    await waitFor(() => expect(button).not.toBeDisabled()) // 방금 만든 draft 대회에 대진을 만들 수 있다
  })

  it('준비 중에는 "준비하고 있습니다" 안내가 나오고, 생성 요청은 한 번만 나간다', async () => {
    let release: (v: { created: boolean }) => void = () => {}
    ensureTournamentDocMock.mockImplementationOnce(() => new Promise((res) => { release = res }))
    await openSender([mainTournament])
    expect(await screen.findByText('리스타트 대회를 준비하고 있습니다.')).toBeInTheDocument()
    expect(ensureTournamentDocMock).toHaveBeenCalledTimes(1)
    release({ created: false })
  })

  it('일반 회원 화면에서는 자동 생성이 일어나지 않고 패널도 없다', async () => {
    useAuth.setState({ memberId: 'm2', memberName: '가상선수2', isGuest: false })
    server = [mainTournament]
    fetchTournamentsMock.mockImplementation(async () => [...server])
    fetchTournamentParticipantsMock.mockResolvedValue(mainPeople)
    fetchTournamentMatchesMock.mockResolvedValue(mainR1)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    expect(screen.queryByText('리스타트 참가자 보내기')).toBeNull()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled()
    expect(server).toHaveLength(1)
  })

  it('Firebase 관리자 인증이 안 된 PIN 관리자는 패널이 없어 자동 생성도 못 한다', async () => {
    useAdmin.setState({ isAdmin: true }) // authorizedAdmin 아님
    server = [mainTournament]
    fetchTournamentsMock.mockImplementation(async () => [...server])
    fetchTournamentParticipantsMock.mockResolvedValue(mainPeople)
    fetchTournamentMatchesMock.mockResolvedValue(mainR1)
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    expect(screen.queryByText('리스타트 참가자 보내기')).toBeNull()
    expect(ensureTournamentDocMock).not.toHaveBeenCalled()
  })
})
