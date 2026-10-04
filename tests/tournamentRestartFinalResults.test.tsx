import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// 리스타트 대회 화면의 "대회 최종 결과"에는 3위·4위·공동 3위가 나오지 않는다(1위·2위만). 가상 데이터만 사용한다.

const fetchTournamentsMock = vi.fn()
const fetchTournamentParticipantsMock = vi.fn()
const fetchTournamentMatchesMock = vi.fn()

vi.mock('../src/lib/tournamentSync', () => ({
  fetchTournaments: (...a: unknown[]) => fetchTournamentsMock(...a),
  fetchTournamentParticipants: (...a: unknown[]) => fetchTournamentParticipantsMock(...a),
  fetchTournamentMatches: (...a: unknown[]) => fetchTournamentMatchesMock(...a),
  subscribeTournamentMatches: () => () => {},
  syncRestartJoiners: async () => 0,
}))

import { TournamentFinalResults } from '../src/components/tournament/TournamentFinalResults'
import { TournamentTab } from '../src/tabs/TournamentTab'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { Tournament, TournamentParticipant } from '../src/types/tournament'
import { nameOfMain, playMain8, playRestart } from './fixtures/resultShare'

const mainT: Tournament = { id: 'main', name: '가상 본선', date: '2026-10-05', timeLimitMinutes: 50, status: 'finished', bracketSize: 8, createdAt: '2026-10-01T00:00:00.000Z' }
const restartT: Tournament = { ...mainT, id: 'restart-main', name: '가상 본선 리스타트전', bracketSize: 16, restartSourceTournamentId: 'main' }
const people = (prefix: string, n: number): TournamentParticipant[] => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${i + 1}`, memberId: `m${i + 1}`, displayNameSnapshot: `가상선수${i + 1}`, baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered' as const,
}))

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({ members: [] })
  useAuth.setState({ memberId: 'm1', memberName: '가상선수1', isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  fetchTournamentsMock.mockResolvedValue([mainT, restartT])
  fetchTournamentParticipantsMock.mockImplementation(async (id: string) => (id === 'main' ? people('p', 8) : people('m', 16)))
  fetchTournamentMatchesMock.mockImplementation(async (id: string) => (id === 'main' ? playMain8(false) : playRestart()))
})
afterEach(() => { vi.restoreAllMocks() })

const props = { nameOf: nameOfMain, isAdmin: false, onFinish: () => {} }

describe('TournamentFinalResults — hideThirdPlace', () => {
  it('기본(마스터즈 등): 3·4위전이 없으면 공동 3위, 있으면 3위·4위를 보여준다(기존 동작 그대로)', () => {
    const { unmount } = render(<TournamentFinalResults tournament={mainT} matches={playMain8(false)} {...props} />)
    expect(screen.getByText(/공동 3위: 가상선수3, 가상선수7/)).toBeInTheDocument()
    unmount()
    render(<TournamentFinalResults tournament={mainT} matches={playMain8(true)} {...props} />)
    expect(screen.getByText('3위: 가상선수3')).toBeInTheDocument()
    expect(screen.getByText('4위: 가상선수7')).toBeInTheDocument()
  })

  it('hideThirdPlace(리스타트): 우승·준우승만 나오고 3위·4위·공동 3위는 어느 경우에도 나오지 않는다', () => {
    for (const withThirdPlace of [false, true]) {
      const { unmount } = render(<TournamentFinalResults tournament={mainT} matches={playMain8(withThirdPlace)} hideThirdPlace {...props} />)
      expect(screen.getByText('우승: 가상선수1')).toBeInTheDocument()
      expect(screen.getByText('준우승: 가상선수5')).toBeInTheDocument()
      expect(screen.queryByText(/공동 3위|3위:|4위:/)).toBeNull()
      unmount()
    }
  })
})

describe('대회 화면에서의 최종 결과', () => {
  it('리스타트 대회 화면: 우승·준우승만 보이고 공동 3위는 보이지 않는다', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선 리스타트전'))
    await screen.findByText(/경기 완료/)
    expect(screen.getByText(/^우승:/)).toBeInTheDocument()
    expect(screen.getByText(/^준우승:/)).toBeInTheDocument()
    expect(screen.queryByText(/공동 3위|3위:|4위:/)).toBeNull()
  })

  it('본선 대회 화면: 기존처럼 공동 3위가 보인다(3·4위전이 없는 대진)', async () => {
    render(<TournamentTab />)
    fireEvent.click(await screen.findByText('가상 본선'))
    await screen.findByText(/경기 완료/)
    expect(screen.getByText(/공동 3위: 가상선수3, 가상선수7/)).toBeInTheDocument()
  })
})
