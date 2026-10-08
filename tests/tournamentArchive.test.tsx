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
import { archiveStageToMatches } from '../src/logic/tournamentArchiveMatches'
import { calculateFinalPlacements } from '../src/logic/tournamentMatch'
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

  it('하이런은 현응렬 6이다 (핸디 안내 데이터는 남아 있지만 화면에는 표시하지 않는다)', () => {
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

describe('확정 결과 → 기존 결과 화면용 경기 목록 변환 (표시 전용)', () => {
  const main = archiveStageToMatches(stage('본선'), 'm')
  const restart = archiveStageToMatches(stage('리스타트전'), 'r')

  it('경기 수: 본선 16칸(15경기 + 부전승 1), 리스타트 11칸(10경기 + 부전승 1), 모두 확정 상태', () => {
    expect(main.matches.filter((m) => m.resultType === 'normal')).toHaveLength(15)
    expect(main.matches.filter((m) => m.resultType === 'bye')).toHaveLength(1)
    expect(restart.matches.filter((m) => m.resultType === 'normal')).toHaveLength(10)
    expect(restart.matches.filter((m) => m.resultType === 'bye')).toHaveLength(1)
    expect([...main.matches, ...restart.matches].every((m) => m.status === 'official')).toBe(true)
  })

  it('회원과 연결하지 않는다(memberId 없음 — 통계·회원 원본과 무관)', () => {
    expect([...main.matches, ...restart.matches].every((m) => m.playerAMemberId === null && m.playerBMemberId === null)).toBe(true)
  })

  it('점수/목표는 확정 데이터 그대로 옮긴다', () => {
    const allGames = games('본선').length + games('리스타트전').length
    const moved = [...main.matches, ...restart.matches].filter((m) => m.resultType === 'normal')
    expect(moved).toHaveLength(allGames)
    const kim = restart.matches.find((m) => restart.nameOf(m.officialWinnerParticipantId ?? null) === '김재홍')!
    expect([kim.scoreA, kim.playerAHandicapSnapshot, kim.scoreB, kim.playerBHandicapSnapshot]).toEqual([11, 15, 9, 20])
    expect(restart.nameOf(kim.officialLoserParticipantId ?? null)).toBe('나재운')
  })

  it('기존 순위 계산(calculateFinalPlacements)이 확정 순위와 같다', () => {
    const p = calculateFinalPlacements(main.matches)
    expect(main.nameOf(p.championParticipantId)).toBe('임진홍')
    expect(main.nameOf(p.runnerUpParticipantId)).toBe('현응렬')
    expect(p.thirdPlaceParticipantIds.map((id) => main.nameOf(id))).toEqual(['조영일'])
    expect(main.nameOf(p.fourthPlaceParticipantId ?? null)).toBe('엄재익')
    const r = calculateFinalPlacements(restart.matches)
    expect(restart.nameOf(r.championParticipantId)).toBe('우연홍')
    expect(restart.nameOf(r.runnerUpParticipantId)).toBe('송원경')
  })

  it('다음 경기 연결은 승자가 실제로 나온 다음 라운드 경기로만 정한다', () => {
    for (const { matches, nameOf } of [main, restart]) {
      const byId = new Map(matches.map((m) => [m.id, m]))
      for (const m of matches.filter((x) => x.nextMatchId)) {
        const next = byId.get(m.nextMatchId!)!
        const winner = nameOf(m.officialWinnerParticipantId ?? null)
        const nextSide = m.nextSlot === 'playerA' ? next.playerAParticipantId : next.playerBParticipantId
        expect(nameOf(nextSide)).toBe(winner)
      }
      // 결승과 3·4위전만 다음 경기가 없다.
      expect(matches.filter((x) => !x.nextMatchId).map((x) => x.playerCountInRound).sort()).toEqual(
        matches.some((x) => x.playerCountInRound === 3) ? [2, 3] : [2],
      )
    }
  })
})

describe('전체 대진표용 실제 경기 흐름 (추첨 슬롯 추정 없음)', () => {
  /** 경기(승자 이름) → 그 승자가 나간 다음 경기의 두 선수 이름. 확정 결과표의 "→ 다음 라운드 진출"과 같아야 한다. */
  function flow(stageTitle: string) {
    const { matches, nameOf, roundLabelOf } = archiveStageToMatches(stage(stageTitle), 'x')
    const byId = new Map(matches.map((m) => [m.id, m]))
    return matches.filter((m) => m.nextMatchId).map((m) => {
      const next = byId.get(m.nextMatchId!)!
      return `${roundLabelOf(m)} ${nameOf(m.officialWinnerParticipantId ?? null)} → ${roundLabelOf(next)} ${nameOf(next.playerAParticipantId)}·${nameOf(next.playerBParticipantId)}`
    })
  }

  it('본선: 예선 → 8강 → 4강 → 결승 흐름이 실제 경기 그대로다', () => {
    expect(flow('본선')).toEqual([
      '예선 손해수 → 8강 임진홍·손해수',
      '예선 임진홍 → 8강 임진홍·손해수',
      '예선 엄재익 → 8강 엄재익·김병찬',
      '예선 김병찬 → 8강 엄재익·김병찬',
      '예선 현응렬 → 8강 현응렬·강호철',
      '예선 강호철 → 8강 현응렬·강호철',
      '예선 조영일 → 8강 조영일·송원경',
      '예선 송원경 → 8강 조영일·송원경',
      '8강 임진홍 → 4강 임진홍·엄재익',
      '8강 엄재익 → 4강 임진홍·엄재익',
      '8강 현응렬 → 4강 현응렬·조영일',
      '8강 조영일 → 4강 현응렬·조영일',
      '4강 임진홍 → 결승 임진홍·현응렬',
      '4강 현응렬 → 결승 임진홍·현응렬',
    ])
  })

  it('리스타트: 예선 승자 3명 + 부전승 1명이 8강으로, 이후 4강 → 결승 흐름이 실제 경기 그대로다', () => {
    expect(flow('리스타트전')).toEqual([
      '예선 강은기 → 8강 송원경·강은기',
      '예선 김재홍 → 8강 김병찬·김재홍',
      '예선 오용진 → 8강 손해수·오용진',
      '예선 우연홍 → 8강 우연홍·강호철',
      '8강 송원경 → 4강 송원경·김병찬',
      '8강 김병찬 → 4강 송원경·김병찬',
      '8강 손해수 → 4강 우연홍·손해수',
      '8강 우연홍 → 4강 우연홍·손해수',
      '4강 송원경 → 결승 우연홍·송원경',
      '4강 우연홍 → 결승 우연홍·송원경',
    ])
  })

  it('합류자: 리스타트 8강의 본선 탈락자 4명만 찾고, 본선에는 합류자가 없다', () => {
    expect(archiveStageToMatches(stage('본선'), 'x').joiners).toEqual([])
    expect(archiveStageToMatches(stage('리스타트전'), 'x').joiners).toEqual([
      { roundLabel: '8강', names: ['송원경', '김병찬', '손해수', '강호철'] },
    ])
  })

  it('3·4위전은 승자 진출 흐름에 끼지 않는다(4강 패자 둘의 별도 경기)', () => {
    const { matches, nameOf, roundLabelOf } = archiveStageToMatches(stage('본선'), 'x')
    const third = matches.find((m) => roundLabelOf(m) === '3·4위전')!
    expect(third.playerCountInRound).toBe(3)
    expect(third.nextMatchId).toBeNull()
    expect(matches.some((m) => m.nextMatchId === third.id)).toBe(false)
    expect([nameOf(third.officialWinnerParticipantId ?? null), nameOf(third.officialLoserParticipantId ?? null)]).toEqual(['조영일', '엄재익'])
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

  /** 라운드 탭을 하나씩 눌러 그 단계의 모든 경기 카드 글자를 모은다(기존 라운드별 보기 화면 그대로). */
  function collectCards(stageTitle: string) {
    const region = screen.getByRole('region', { name: stageTitle })
    const tabs = within(within(region).getByTestId('round-tabs')).getAllByRole('button')
    const labels = tabs.map((t) => t.textContent ?? '')
    const cards: string[] = []
    for (const tab of tabs) {
      fireEvent.click(tab)
      for (const label of within(region).getAllByText(/^경기 \d+/)) cards.push(label.parentElement!.textContent ?? '')
    }
    return { region, labels, cards, byes: cards.filter((c) => c.includes('부전승')), games: cards.filter((c) => !c.includes('부전승')) }
  }

  async function openArchive() {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByRole('button', { name: /제2회 부산동문회장배 당구대회/ }))
  }

  it('기존 대회 결과 화면과 같은 머리말(대회명 · 날짜 · 경기 시간)로 열린다', async () => {
    await openArchive()
    expect(screen.getByRole('heading', { name: '제2회 부산동문회장배 당구대회' })).toBeInTheDocument()
    expect(screen.getByText('📅 2026년 10월 5일 · 55분 경기')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '본선' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '리스타트전' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('본선: 기존 라운드 탭·경기 카드로 15경기 + 부전승 1건, 기존 최종 결과 카드로 1~4위', async () => {
    await openArchive()
    const { region, labels, games, byes } = collectCards('본선')
    expect(labels).toEqual(['✅ 예선', '✅ 8강', '✅ 4강', '✅ 3·4위전', '✅ 결승'])
    expect(within(region).getByText('15 / 15 경기 완료')).toBeInTheDocument()
    expect(games).toHaveLength(15)
    expect(byes).toHaveLength(1)
    expect(byes[0]).toContain('송원경')
    expect(within(region).getByText('우승: 임진홍')).toBeInTheDocument()
    expect(within(region).getByText('준우승: 현응렬')).toBeInTheDocument()
    expect(within(region).getByText('3위: 조영일')).toBeInTheDocument()
    expect(within(region).getByText('4위: 엄재익')).toBeInTheDocument()
    expect(within(region).getByText('대회가 종료되었습니다.')).toBeInTheDocument()
    // 조영일 경기 기록(점수/목표)은 그대로 — 17/20 두 번, 4강 12/20 패, 3·4위전 20/20 승.
    expect(games.filter((c) => c.includes('승자 조영일 · 17/20'))).toHaveLength(2)
    expect(games.some((c) => c.includes('패자 조영일 · 12/20'))).toBe(true)
    expect(games.some((c) => c.includes('승자 조영일 · 20/20'))).toBe(true)
    expect(games.some((c) => c.includes('승자 임진홍 · 25/25') && c.includes('패자 현응렬 · 11/23'))).toBe(true)
  })

  it('리스타트전: 10경기 + 부전승 1건, 우승·준우승만 표시', async () => {
    await openArchive()
    fireEvent.click(screen.getByRole('button', { name: '리스타트전' }))
    const { region, labels, games, byes } = collectCards('리스타트전')
    expect(labels).toEqual(['✅ 예선', '✅ 8강', '✅ 4강', '✅ 결승'])
    expect(within(region).getByText('10 / 10 경기 완료')).toBeInTheDocument()
    expect(games).toHaveLength(10)
    expect(byes).toHaveLength(1)
    expect(byes[0]).toContain('우연홍')
    expect(within(region).getByText('우승: 우연홍')).toBeInTheDocument()
    expect(within(region).getByText('준우승: 송원경')).toBeInTheDocument()
    expect(within(region).queryByText(/3위/)).not.toBeInTheDocument()
    expect(games.some((c) => c.includes('승자 김재홍 · 11/15') && c.includes('패자 나재운 · 9/20'))).toBe(true)
  })

  it('하이런 현응렬 6을 보여 주고, 핸디 안내 문구는 없다', async () => {
    await openArchive()
    expect(screen.getByText('🎯 하이런')).toBeInTheDocument()
    expect(screen.getByText('현응렬 6')).toBeInTheDocument()
    expect(screen.queryByText(/핸디 기준/)).not.toBeInTheDocument()
  })

  it('기존 대회처럼 [라운드별 보기] [전체 대진표] 전환이 있고, 처음에는 라운드별 보기다', async () => {
    await openArchive()
    expect(screen.getByRole('button', { name: '라운드별 보기' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '전체 대진표' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('round-tabs')).toBeInTheDocument()
  })

  /** 전체 대진표(기존 TournamentBracketVisual)에 그려진 경기 칸들의 [A 이름, B 이름]. */
  function visualCards(region: HTMLElement) {
    return [...region.querySelectorAll('[data-match-id]')].map((el) => [...el.querySelectorAll('span')].map((s) => s.textContent ?? ''))
  }

  it('본선 전체 대진표: 예선 8칸(부전승 1) + 8강 4 + 4강 2 + 결승 1 + 3·4위전 1, 승자 칸 강조', async () => {
    await openArchive()
    fireEvent.click(screen.getByRole('button', { name: '전체 대진표' }))
    const region = screen.getByRole('region', { name: '본선' })
    expect(within(region).queryByTestId('round-tabs')).not.toBeInTheDocument()
    for (const label of ['✅ 예선', '✅ 8강', '✅ 4강', '✅ 결승', '3·4위전']) expect(within(region).getByText(label)).toBeInTheDocument()
    const cards = visualCards(region)
    expect(cards).toHaveLength(16)
    expect(cards.filter((c) => c.some((t) => t.includes('(부전승)')))).toHaveLength(1)
    expect(cards.some((c) => c.includes('3·4위전') && c.includes('조영일') && c.includes('엄재익'))).toBe(true)
    // 확정된 모든 실제 경기에 승자 칸이 하나씩, 부전승 1칸 — 15 + 1 = 16.
    expect(region.querySelectorAll('[data-winner="true"]')).toHaveLength(16)
    expect([...region.querySelectorAll('[data-winner="true"]')].filter((s) => s.textContent === '임진홍')).toHaveLength(4)
    expect(within(region).getByText('우승: 임진홍')).toBeInTheDocument()
    expect(within(region).queryByText(/부터 합류/)).not.toBeInTheDocument()
  })

  it('리스타트 전체 대진표: 예선 4칸(부전승 1) + 8강 4 + 4강 2 + 결승 1, 본선 탈락자 합류 안내', async () => {
    await openArchive()
    fireEvent.click(screen.getByRole('button', { name: '리스타트전' }))
    fireEvent.click(screen.getByRole('button', { name: '전체 대진표' }))
    const region = screen.getByRole('region', { name: '리스타트전' })
    for (const label of ['✅ 예선', '✅ 8강', '✅ 4강', '✅ 결승']) expect(within(region).getByText(label)).toBeInTheDocument()
    expect(within(region).queryByText('3·4위전')).not.toBeInTheDocument()
    const cards = visualCards(region)
    expect(cards).toHaveLength(11)
    expect(cards.filter((c) => c.some((t) => t.includes('(부전승)')))).toHaveLength(1)
    expect(region.querySelectorAll('[data-winner="true"]')).toHaveLength(11)
    expect(within(region).getByText('8강부터 합류(본선 탈락자): 송원경 · 김병찬 · 손해수 · 강호철')).toBeInTheDocument()
    expect(within(region).getByText('우승: 우연홍')).toBeInTheDocument()
  })

  it('전체 대진표에서 라운드별 보기로 돌아가면 기존 라운드 탭이 다시 보인다', async () => {
    await openArchive()
    fireEvent.click(screen.getByRole('button', { name: '전체 대진표' }))
    fireEvent.click(screen.getByRole('button', { name: '라운드별 보기' }))
    expect(screen.getByTestId('round-tabs')).toBeInTheDocument()
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
