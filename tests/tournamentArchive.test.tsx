import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

// 기록용 완료 대회는 서버에 아무것도 쓰지 않아야 한다 — 쓰기 함수를 전부 감시한다.
const { writeMocks, fetchTournamentsMock } = vi.hoisted(() => ({
  writeMocks: {
    createTournament: vi.fn(), createMissingParticipants: vi.fn(), setParticipantEntryStatus: vi.fn(),
    excludeParticipantByAdmin: vi.fn(), setParticipantTournamentHandicap: vi.fn(), writeTournamentParticipant: vi.fn(),
    confirmTournamentEntries: vi.fn(), reopenTournamentEntries: vi.fn(), prepareTournamentDraw: vi.fn(),
    saveTournamentDrawNumbers: vi.fn(), confirmTournamentBracket: vi.fn(), cancelTournamentBracket: vi.fn(),
    deleteTournament: vi.fn(), createRestartBracket: vi.fn(), ensureTournamentDoc: vi.fn(), finishTournament: vi.fn(),
  },
  fetchTournamentsMock: vi.fn(),
}))

vi.mock('../src/lib/tournamentSync', () => ({
  ...Object.fromEntries(Object.entries(writeMocks).map(([k, fn]) => [k, (...a: unknown[]) => fn(...a)])),
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: vi.fn().mockResolvedValue([]),
  fetchTournamentMatches: vi.fn().mockResolvedValue([]),
  subscribeTournamentMatches: () => () => {},
}))

import { TournamentTab } from '../src/tabs/TournamentTab'
import { ARCHIVED_TOURNAMENTS } from '../src/data/tournamentArchive'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Tournament } from '../src/types/tournament'

const cup = ARCHIVED_TOURNAMENTS[0]
const stage = (title: string) => cup.stages.find((s) => s.title === title)!
const entries = (title: string) => stage(title).rounds.flatMap((r) => r.entries)
const games = (title: string) => entries(title).flatMap((e) => (e.kind === 'game' ? [e] : []))
const byes = (title: string) => entries(title).flatMap((e) => (e.kind === 'bye' ? [e] : []))
const find = (title: string, round: string, winner: string, loser: string) =>
  stage(title).rounds.find((r) => r.label === round)!.entries.find(
    (e) => e.kind === 'game' && e.winner.name === winner && e.loser.name === loser,
  )

const otherTournament: Tournament = {
  id: 'other', name: '다른 운영 대회', date: '2026-10-01', timeLimitMinutes: 50, status: 'draft', createdAt: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ members: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  fetchTournamentsMock.mockResolvedValue([otherTournament])
})

describe('기록용 완료 대회 데이터 (제2회 부산동문회장배)', () => {
  it('대회명이 정확하다', () => {
    expect(cup.name).toBe('제2회 부산동문회장배 당구대회')
  })

  it('날짜는 2026-10-05, 경기 시간은 55분이다', () => {
    expect(cup.date).toBe('2026-10-05')
    expect(cup.timeLimitMinutes).toBe(55)
  })

  it('본선은 15경기, 부전승 1건이다', () => {
    expect(games('본선')).toHaveLength(15)
    expect(byes('본선').map((b) => b.name)).toEqual(['송원경'])
  })

  it('리스타트는 10경기, 부전승 1건이다', () => {
    // 예선 3 + 8강 4 + 4강 2 + 결승 1 = 10경기. 부전승은 경기수에 넣지 않는다.
    expect(games('리스타트전')).toHaveLength(10)
    expect(byes('리스타트전').map((b) => b.name)).toEqual(['우연홍'])
  })

  it('부전승은 두 단계 합쳐 2건이다', () => {
    expect(byes('본선').length + byes('리스타트전').length).toBe(2)
  })

  it('본선 1~4위가 정확하다', () => {
    expect(stage('본선').placements).toEqual([
      { label: '1위', name: '임진홍' }, { label: '2위', name: '현응렬' },
      { label: '3위', name: '조영일' }, { label: '4위', name: '엄재익' },
    ])
  })

  it('리스타트 우승/준우승이 정확하다', () => {
    expect(stage('리스타트전').placements).toEqual([
      { label: '우승', name: '우연홍' }, { label: '준우승', name: '송원경' },
    ])
  })

  it('하이런은 현응렬 6, 조영일 핸디 기준은 20이다', () => {
    expect(cup.highRun).toEqual({ name: '현응렬', value: 6 })
    expect(cup.handicapNotes).toEqual([{ name: '조영일', handicap: 20 }])
  })

  it('김재홍 11/15 승 / 나재운 9/20 패 (리스타트 예선)', () => {
    const e = find('리스타트전', '예선', '김재홍', '나재운')
    expect(e).toMatchObject({
      winner: { name: '김재홍', score: 11, target: 15 },
      loser: { name: '나재운', score: 9, target: 20 },
    })
  })

  it('라운드 구성이 맞다', () => {
    expect(stage('본선').rounds.map((r) => r.label)).toEqual(['예선', '8강', '4강', '3·4위전', '결승'])
    expect(stage('리스타트전').rounds.map((r) => r.label)).toEqual(['예선', '8강', '4강', '결승'])
  })

  it('주요 경기 점수가 요청한 값과 같다 (본선)', () => {
    expect(find('본선', '결승', '임진홍', '현응렬')).toMatchObject({ winner: { score: 25, target: 25 }, loser: { score: 11, target: 23 } })
    expect(find('본선', '3·4위전', '조영일', '엄재익')).toMatchObject({ winner: { score: 20, target: 20 }, loser: { score: 7, target: 13 } })
    expect(find('본선', '예선', '강호철', '이제한')).toMatchObject({ winner: { score: 15, target: 15 }, loser: { score: 18, target: 21 } })
    expect(find('리스타트전', '결승', '우연홍', '송원경')).toMatchObject({ winner: { score: 17, target: 17 }, loser: { score: 2, target: 10 } })
  })

  it('데이터 파일은 다른 모듈을 가져오지 않는다(통계·회원·서버와 연결 없음)', () => {
    const src = readFileSync('src/data/tournamentArchive.ts', 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
  })
})

describe('기록용 완료 대회 화면', () => {
  it('대회 목록에 완료 상태로 보이고, 다른 운영 대회도 그대로 보인다', async () => {
    render(<TournamentTab />)
    expect(await screen.findByText('다른 운영 대회')).toBeInTheDocument()
    const card = screen.getByRole('button', { name: /제2회 부산동문회장배 당구대회/ })
    expect(within(card).getByText('완료')).toBeInTheDocument()
    expect(within(card).getByText('📅 2026년 10월 5일')).toBeInTheDocument()
    expect(within(card).getByText('⏱ 55분 경기')).toBeInTheDocument()
  })

  it('누르면 결과 화면이 열리고 본선·리스타트전이 나뉘어 보인다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByRole('button', { name: /제2회 부산동문회장배 당구대회/ }))

    expect(screen.getByRole('heading', { name: '제2회 부산동문회장배 당구대회' })).toBeInTheDocument()
    const main = screen.getByRole('region', { name: '본선' })
    const restart = screen.getByRole('region', { name: '리스타트전' })
    expect(within(main).getByText('1위: 임진홍')).toBeInTheDocument()
    expect(within(main).getByText('4위: 엄재익')).toBeInTheDocument()
    expect(within(restart).getByText('우승: 우연홍')).toBeInTheDocument()
    expect(within(restart).getByText('준우승: 송원경')).toBeInTheDocument()
    expect(within(main).getAllByTestId('archive-game')).toHaveLength(15)
    expect(within(restart).getAllByTestId('archive-game')).toHaveLength(10)
    expect(within(main).getAllByTestId('archive-bye')).toHaveLength(1)
    expect(within(restart).getAllByTestId('archive-bye')).toHaveLength(1)
    expect(screen.getByText('📅 2026년 10월 5일')).toBeInTheDocument()
    expect(screen.getByText('⏱ 55분 경기 · 대회 완료')).toBeInTheDocument()
    expect(screen.getByText('현응렬 6')).toBeInTheDocument()
    // 핸디 안내 문구는 화면에 표시하지 않는다 — 조영일 경기 기록(점수/목표)은 그대로 보인다.
    expect(screen.queryByText(/핸디 기준/)).not.toBeInTheDocument()
    expect(within(main).getAllByText('17/20')).toHaveLength(2)
    expect(within(main).getByText('12/20')).toBeInTheDocument()
    expect(within(main).getByText('20/20')).toBeInTheDocument()
    expect(within(restart).getByText('11/15')).toBeInTheDocument()
    expect(within(restart).getByText('9/20')).toBeInTheDocument()
    expect(within(main).getByText('본선 3·4위전')).toBeInTheDocument()
  })

  it('"대회 목록" 버튼으로 목록에 돌아온다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByRole('button', { name: /제2회 부산동문회장배 당구대회/ }))
    fireEvent.click(screen.getByRole('button', { name: '← 대회 목록' }))
    await waitFor(() => expect(screen.getByText('다른 운영 대회')).toBeInTheDocument())
  })

  it('열람해도 서버 쓰기가 없고 회원·경기 통계 상태도 그대로다', async () => {
    const before = JSON.stringify({ m: useApp.getState().members, s: useApp.getState().sessions })
    render(<TournamentTab />)
    fireEvent.click(await screen.findByRole('button', { name: /제2회 부산동문회장배 당구대회/ }))
    for (const fn of Object.values(writeMocks)) expect(fn).not.toHaveBeenCalled()
    expect(JSON.stringify({ m: useApp.getState().members, s: useApp.getState().sessions })).toBe(before)
  })

  it('관리자에게도 삭제·수정 버튼이 보이지 않는다', async () => {
    useAdmin.setState({ isAdmin: true })
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'u', email: null, adminDisplayName: null, errorMessage: null })
    render(<TournamentTab />)
    fireEvent.click(await screen.findByRole('button', { name: /제2회 부산동문회장배 당구대회/ }))
    expect(screen.queryByRole('button', { name: '대회 삭제' })).not.toBeInTheDocument()
  })
})
