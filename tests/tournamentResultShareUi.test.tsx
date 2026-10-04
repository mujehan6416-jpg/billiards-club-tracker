import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 대회 경기결과 공유(관리자 전용) 화면 테스트. Firestore·공유(share)는 전부 모킹하고, 가상 데이터만 쓴다.

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()
const shareTextMock = vi.fn()
const shareImageMock = vi.fn()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: () => () => {},
  syncRestartJoiners: async () => 0, // 관리자가 리스타트 대회를 열면 합류 자리 확인을 한 번 부른다(읽기 화면 테스트에는 영향 없음)
}))
vi.mock('../src/lib/share', () => ({
  shareText: (...a: unknown[]) => shareTextMock(...a),
  shareImage: (...a: unknown[]) => shareImageMock(...a),
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { buildResultShareData, buildResultShareText } from '../src/logic/tournamentResultShare'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'
import { nameOfMain, playMain8, playRestart, restartFinalists } from './fixtures/resultShare'

const mainT: Tournament = {
  id: 'main', name: 'Test3', date: '2026-10-05', timeLimitMinutes: 50, status: 'finished', bracketSize: 8,
  createdAt: '2026-10-01T00:00:00.000Z',
}
const restartT: Tournament = {
  ...mainT, id: 'restart-main', name: 'Test3 리스타트전', status: 'bracketFixed', bracketSize: 16, restartSourceTournamentId: 'main',
}
const person = (id: string): TournamentParticipant => ({
  id, memberId: id.replace('p', 'm'), displayNameSnapshot: `가상선수${id.slice(1)}`,
  baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered',
})
const mainPeople = Array.from({ length: 8 }, (_, i) => person(`p${i + 1}`))
const restartPeople = Array.from({ length: 16 }, (_, i) => person(`m${i + 1}`))
const restartMatches = playRestart()
const { champion, runnerUp } = restartFinalists(restartMatches)
const nameOfRestart = (id: string | null) => (id ? `가상선수${id.slice(1)}` : '')

function asAdmin() {
  useAdmin.setState({ isAdmin: true })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'uid-test', email: null, adminDisplayName: null, errorMessage: null })
}

function serve(opts: { main?: TournamentMatch[]; tournaments?: Tournament[]; restart?: TournamentMatch[] } = {}) {
  fetchTournamentsMock.mockResolvedValue(opts.tournaments ?? [mainT, restartT])
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? mainPeople : restartPeople))
  fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === 'main' ? (opts.main ?? playMain8(true)) : (opts.restart ?? restartMatches)))
}

async function openMain(name = 'Test3') {
  render(<TournamentTab />)
  fireEvent.click(await screen.findByText(name))
  await screen.findByText(/경기 완료/)
}

const card = () => within(screen.getByTestId('result-card'))

beforeEach(() => {
  vi.clearAllMocks()
  shareTextMock.mockResolvedValue(true)
  shareImageMock.mockResolvedValue(undefined)
  useApp.setState({ members: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
})
afterEach(() => { vi.restoreAllMocks() })

describe('경기결과 공유 — 관리자 화면', () => {
  it('관리자 본선 화면에 "경기결과 공유"가 있고, 열면 마스터즈 1~4위와 리스타트 1·2위가 카드에 나온다', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    // 리스타트 결과는 고정 id 대회(restart-main)에서 읽는다
    await waitFor(() => expect(fetchTournamentMatchesMock).toHaveBeenCalledWith('restart-main', 'skkubc'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
    expect(card().getByText('당신회')).toBeInTheDocument()
    expect(card().getByText('대회 경기결과')).toBeInTheDocument()
    expect(card().getByText('Test3')).toBeInTheDocument()
    expect(card().getByText('2026-10-05')).toBeInTheDocument()
    expect(card().getByText('🏆 마스터즈 챔피언십 경기결과')).toBeInTheDocument()
    expect(card().getByText('🏆 리스타트 챔피언십 경기결과')).toBeInTheDocument()
    for (const [rank, name] of [['1위', '가상선수1'], ['2위', '가상선수5'], ['3위', '가상선수3'], ['4위', '가상선수7']]) {
      expect(card().getAllByText(rank).length).toBeGreaterThan(0)
      expect(card().getByText(name)).toBeInTheDocument()
    }
    expect(card().getByText(nameOfRestart(runnerUp))).toBeInTheDocument()
  })

  it('하이런상은 직접 입력한 이름이 카드와 문구에만 쓰이고, 비어 있으면 줄을 뺀다', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    expect(screen.queryByTestId('result-highrun')).toBeNull()
    expect(screen.getByText('비워 두면 하이런상 줄은 빼고 만듭니다.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
    expect(card().getByText('🎯 하이런상')).toBeInTheDocument()
    expect(card().getByText('가상하이런')).toBeInTheDocument()
    expect(screen.getByText(/저장되지 않고/)).toBeInTheDocument()
  })

  it('"카톡용 결과 복사"는 요청한 형식의 문구를 공유(복사)하고, 붙여넣기 안내를 보여준다', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
    fireEvent.click(screen.getByText('카톡용 결과 복사'))
    const expected = buildResultShareText(buildResultShareData({
      mastersMatches: playMain8(true), mastersNameOf: nameOfMain, restartMatches, restartNameOf: nameOfRestart, highRun: '가상하이런',
    }))
    await waitFor(() => expect(shareTextMock).toHaveBeenCalledWith(expected))
    expect(expected).toContain('마스터즈 1위: 가상선수1')
    expect(expected).toContain('하이런상: 가상하이런')
    expect(expected.startsWith('🏆 대회 최종결과')).toBe(true)
    expect(await screen.findByText('복사했습니다. 카톡에 붙여넣어 주세요.')).toBeInTheDocument()
  })

  it('공유 창(Web Share)으로 열렸으면 그에 맞는 안내를 보여준다', async () => {
    shareTextMock.mockResolvedValue(false)
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    fireEvent.click(screen.getByText('카톡용 결과 복사'))
    expect(await screen.findByText('공유 창을 열었습니다. 카카오톡을 선택해 주세요.')).toBeInTheDocument()
  })

  it('"결과 이미지 만들기"는 카드 DOM을 기존 공유 함수(shareImage)로 넘기고, 카드 내용이 결과와 같다', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
    fireEvent.click(screen.getByText('결과 이미지 만들기'))
    await waitFor(() => expect(shareImageMock).toHaveBeenCalledTimes(1))
    const [node, filename, title] = shareImageMock.mock.calls[0] as [HTMLElement, string, string]
    expect(node).toBe(screen.getByTestId('result-card'))
    expect(filename).toBe('대회결과_2026-10-05.png')
    expect(title).toBe('당신회 대회 경기결과')
    const text = node.textContent ?? ''
    for (const s of ['당신회', '대회 경기결과', '마스터즈 챔피언십 경기결과', '가상선수1', '가상선수5', '가상선수3', '가상선수7',
      '리스타트 챔피언십 경기결과', nameOfRestart(champion), nameOfRestart(runnerUp), '하이런상', '가상하이런']) {
      expect(text).toContain(s)
    }
    expect(node.style.width).toBe('340px') // 스마트폰 세로형 고정 폭, 흰 배경
    expect(node.style.background).toMatch(/#fff|rgb\(255, 255, 255\)/)
  })

  it('이미지에서 긴 이름은 줄바꿈되어 잘리지 않는다(overflow-wrap)', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '아주아주긴이름을가진가상의하이런상수상자이름입니다' } })
    const el = card().getByText('아주아주긴이름을가진가상의하이런상수상자이름입니다')
    expect(el.style.overflowWrap).toBe('anywhere')
    expect(el.style.whiteSpace).not.toBe('nowrap')
  })

  it('마스터즈 결승이 끝나지 않았으면 순위 대신 미확정 안내가 나온다', async () => {
    asAdmin()
    serve({ main: playMain8(true, 'before-final') })
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    expect(await card().findByText('마스터즈 결과가 아직 확정되지 않았습니다.')).toBeInTheDocument()
    expect(card().queryByText('가상선수1', { selector: 'span' })).toBeNull()
  })

  it('리스타트 대회가 없거나 결승이 끝나지 않았으면 리스타트 미확정 안내가 나온다', async () => {
    asAdmin()
    serve({ tournaments: [mainT] })
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    expect(await card().findByText('리스타트 결과가 아직 확정되지 않았습니다.')).toBeInTheDocument()
  })

  it('리스타트 결과를 읽지 못하면 안내하고 다시 불러올 수 있다', async () => {
    asAdmin()
    serve()
    await openMain()
    fetchTournamentMatchesMock.mockImplementation(async (id: string) => {
      if (id === 'restart-main') throw new Error('network')
      return playMain8(true)
    })
    fireEvent.click(screen.getByText('경기결과 공유'))
    expect(await screen.findByText(/리스타트 결과를 읽지 못했습니다/)).toBeInTheDocument()
    fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === 'main' ? playMain8(true) : restartMatches))
    fireEvent.click(screen.getByText('리스타트 결과 다시 불러오기'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
  })
})

describe('결과 이미지 카드 — 순위와 이름을 한 줄로, 리스타트는 1·2위만', () => {
  async function openCard() {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
  }

  it('순위와 이름은 같은 줄에 놓인다 — "1위  이름"이 한 행(가로 배치)이고 이름은 가운데 정렬이 아니다', async () => {
    await openCard()
    const expected: [string, string][] = [
      ['1위', '가상선수1'], ['2위', '가상선수5'], ['3위', '가상선수3'], ['4위', '가상선수7'],
      ['1위', nameOfRestart(champion)], ['2위', nameOfRestart(runnerUp)],
    ]
    const rows = screen.getAllByTestId('result-row')
    expect(rows).toHaveLength(expected.length)
    rows.forEach((row, i) => {
      const [rank, name] = expected[i]
      // 한 행 안에 순위와 이름이 함께 있고, 행은 가로(flex row)로 이어진다
      expect(row.style.display).toBe('flex')
      expect(row.style.flexDirection).toBe('') // 기본 = row
      expect(row.firstElementChild!.textContent).toBe(rank)
      expect(row.textContent).toBe(`${rank}${name}`)
      // 이름은 왼쪽 정렬(가운데 정렬 아님)
      const nameEl = within(row as HTMLElement).getByText(name)
      expect(nameEl.style.textAlign).toBe('left')
    })
    // 하이런상: 제목 아래에 이름만(왼쪽 정렬)
    const high = screen.getByTestId('result-highrun')
    expect(high.textContent).toBe('🎯 하이런상가상하이런')
    expect(within(high).getByText('가상하이런').style.textAlign).toBe('left')
  })

  /** 이름 시작 위치를 정하는 값: 행의 간격 + 순위 칸 폭(줄어들지 않음, 줄바꿈 없음). 모두 같으면 이름이 같은 세로선에서 시작한다. */
  const nameStart = (row: HTMLElement) => {
    const rank = row.firstElementChild as HTMLElement
    return `${row.style.gap}|${rank.style.width}/${rank.style.flexShrink}/${rank.style.whiteSpace}`
  }

  it('모든 줄의 이름 시작 위치가 세로로 가지런하다 — 순위 칸 폭·간격이 같고, "1위" 폭에 맞춰 좁게(64px) 둔다', async () => {
    await openCard()
    const starts = screen.getAllByTestId('result-row').map(nameStart)
    expect(new Set(starts).size).toBe(1)
    expect(starts[0]).toBe('14px|64px/0/nowrap')
  })

  it('하이런상 이름도 위 결과 이름들과 같은 시작선에 놓인다 — 순위 칸 자리를 비워 둔 같은 행 구조', async () => {
    await openCard()
    const highRow = within(screen.getByTestId('result-highrun')).getByTestId('result-highrun-row')
    expect(nameStart(highRow)).toBe(nameStart(screen.getAllByTestId('result-row')[0]))
    expect(highRow.firstElementChild!.textContent).toBe('') // 순위 칸은 비어 있다
    expect(highRow.lastElementChild!.textContent).toBe('가상하이런')
  })

  it('"공동 3위"가 있는 대회는 순위 칸을 넓혀(100px) 라벨이 줄바꿈되지 않고, 리스타트·하이런상도 같은 폭으로 맞춘다', async () => {
    asAdmin()
    serve({ main: playMain8(false) }) // 3·4위전이 없는 대진 → 마스터즈 공동 3위
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await waitFor(() => expect(card().getByText(nameOfRestart(champion))).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
    expect(card().getByText('공동 3위')).toBeInTheDocument()
    const rows = [...screen.getAllByTestId('result-row'), screen.getByTestId('result-highrun-row')]
    const starts = rows.map(nameStart)
    expect(new Set(starts).size).toBe(1)
    expect(starts[0]).toBe('14px|100px/0/nowrap')
  })

  it('구역 제목에 마스터즈·리스타트 이름이 있고, 줄에는 "1위"처럼 순위만 쓴다(중복 표기 없음)', async () => {
    await openCard()
    const sections = screen.getAllByTestId('result-section')
    expect(sections[0].textContent).toContain('마스터즈 챔피언십 경기결과')
    expect(sections[1].textContent).toContain('리스타트 챔피언십 경기결과')
    expect(within(sections[0]).getAllByTestId('result-row')).toHaveLength(4)
    expect(within(sections[1]).getAllByTestId('result-row')).toHaveLength(2)
  })

  it('이미지 카드의 리스타트 부분에는 1위·2위만 있고 3위·4위는 없다(리스타트 대회에 3·4위전 결과가 있어도)', async () => {
    asAdmin()
    serve({ restart: playMain8(true) }) // 3·4위전 결과까지 있는 경기 목록을 리스타트 대회 결과로 읽어 온 상황
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    await waitFor(() => expect(screen.getAllByTestId('result-section')).toHaveLength(2))
    const [, restartSection] = screen.getAllByTestId('result-section')
    await waitFor(() => expect(restartSection.textContent).toContain('1위'))
    expect(restartSection.textContent).toContain('2위')
    expect(restartSection.textContent).not.toMatch(/3위|4위/)
  })

  it('카톡 문구와 카드에 같은 순위가 들어간다(같은 데이터에서 만든다)', async () => {
    await openCard()
    fireEvent.click(screen.getByText('카톡용 결과 복사'))
    await waitFor(() => expect(shareTextMock).toHaveBeenCalled())
    const text = shareTextMock.mock.calls[0][0] as string
    const cardText = screen.getByTestId('result-card').textContent ?? ''
    for (const n of ['가상선수1', '가상선수5', '가상선수3', '가상선수7', nameOfRestart(champion), nameOfRestart(runnerUp), '가상하이런']) {
      expect(text).toContain(n)
      expect(cardText).toContain(n)
    }
    expect(text).not.toMatch(/리스타트 3위|리스타트 4위/)
  })

  it('"카톡 문구 미리보기"에 복사될 문구와 같은 내용(최종결과 → 경기 상세)이 보인다', async () => {
    await openCard()
    const preview = screen.getByTestId('result-text-preview').textContent ?? ''
    expect(preview.startsWith('🏆 대회 최종결과')).toBe(true)
    expect(preview).toContain('하이런상: 가상하이런')
    expect(preview).toContain('▶ 결승전')
    fireEvent.click(screen.getByText('카톡용 결과 복사'))
    await waitFor(() => expect(shareTextMock).toHaveBeenCalled())
    expect(shareTextMock.mock.calls[0][0]).toBe(preview)
  })
})

describe('경기결과 공유 — 권한과 범위', () => {
  it('일반 회원에게는 공유 버튼도 편집 입력칸도 보이지 않는다', async () => {
    useAuth.setState({ memberId: 'm2', memberName: '가상선수2', isGuest: false })
    serve()
    await openMain()
    expect(screen.queryByText('경기결과 공유')).toBeNull()
    expect(screen.queryByPlaceholderText('하이런상 이름')).toBeNull()
    expect(screen.queryByTestId('result-card')).toBeNull()
  })

  it('Firebase 관리자 인증이 안 된 PIN 관리자에게도 보이지 않는다', async () => {
    useAdmin.setState({ isAdmin: true })
    serve()
    await openMain()
    expect(screen.queryByText('경기결과 공유')).toBeNull()
  })

  it('리스타트 대회 화면에는 공유 버튼이 없다(본선 화면에서만 연다)', async () => {
    asAdmin()
    serve()
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('Test3 리스타트전'))
    await screen.findByText(/경기 완료/)
    expect(screen.queryByText('경기결과 공유')).toBeNull()
  })

  it('읽기만 한다 — 공유 화면은 경기·대회·참가자를 저장하지 않는다(저장 함수가 목에 없으므로 호출하면 실패)', async () => {
    asAdmin()
    serve()
    await openMain()
    fireEvent.click(screen.getByText('경기결과 공유'))
    await screen.findByTestId('result-card')
    fireEvent.change(screen.getByPlaceholderText('하이런상 이름'), { target: { value: '가상하이런' } })
    fireEvent.click(screen.getByText('카톡용 결과 복사'))
    await waitFor(() => expect(shareTextMock).toHaveBeenCalled())
    // 읽기 함수 외에는 목이 없다 — 저장을 시도했다면 위 단계에서 오류가 났을 것이다
    expect(fetchTournamentsMock).toHaveBeenCalled()
  })
})
