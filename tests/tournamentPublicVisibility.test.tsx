import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TournamentBracketView } from '../src/components/tournament/TournamentBracketView'
import { TournamentBracketVisual } from '../src/components/tournament/TournamentBracketVisual'
import { TournamentMatchPanel } from '../src/components/tournament/TournamentMatchPanel'
import type { TournamentMatch, TournamentMatchStatus } from '../src/types/tournament'

// 공개 기준 테스트: 일반 회원에게는 최종 승인(official)된 결과만 "결과"로 보인다.
// 이름·ID는 전부 가상 데이터다.

const names: Record<string, string> = { p1: '가상선수1', p2: '가상선수2' }
const nameOf = (id: string | null) => (id ? names[id] ?? '' : '')

function match(status: TournamentMatchStatus, over: Partial<TournamentMatch> = {}): TournamentMatch {
  const scored = status !== 'awaitingResult'
  return {
    id: 'm1', roundNumber: 1, playerCountInRound: 2, matchNumber: 1,
    playerAParticipantId: 'p1', playerBParticipantId: 'p2', playerAMemberId: 'u1', playerBMemberId: 'u2',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 18,
    scoreA: scored ? 17 : null, scoreB: scored ? 9 : null,
    resultType: 'normal', status,
    calculatedWinnerParticipantId: scored ? 'p1' : undefined,
    nextMatchId: null, nextSlot: null,
    resultLog: scored ? { submittedByMemberId: 'u1' } : undefined,
    ...(status === 'official' ? { officialWinnerParticipantId: 'p1', officialLoserParticipantId: 'p2' } : {}),
    ...over,
  }
}

// match()가 쓰는 점수(17/9)와 핸디(20/18)로 만들어지는 달성률 문구.
const SCORE_A = '17/20 (85%)'
const SCORE_B = '9/18 (50%)'
const BYSTANDER = 'u9' // 이 경기의 선수가 아닌 일반 회원

const panel = (m: TournamentMatch, viewer: string | undefined, isAdmin = false) => render(
  <TournamentMatchPanel
    match={m} nameOf={nameOf} viewerMemberId={viewer} isAdmin={isAdmin}
    onClose={vi.fn()} onSubmitResult={vi.fn()} onAdminEnterResult={vi.fn()} onVerify={vi.fn()}
    onRequestCorrection={vi.fn()} onAdminVerify={vi.fn()} onAdminCorrect={vi.fn()} onApprove={vi.fn()} onForfeit={vi.fn()}
  />,
)

describe('일반 회원(경기 당사자 아님) — 승인 전에는 점수·승패가 보이지 않는다', () => {
  for (const status of ['awaitingResult', 'awaitingVerification', 'awaitingApproval'] as const) {
    it(`대진표 카드: ${status}`, () => {
      render(<TournamentBracketView matches={[match(status)]} nameOf={nameOf} highlightMemberId={BYSTANDER} />)
      expect(screen.queryByText(new RegExp(SCORE_A.replace(/[()/]/g, '\\$&')))).toBeNull()
      expect(screen.queryByText(/승자|패자|공식 결과/)).toBeNull()
      expect(screen.queryByText(/17|85%/)).toBeNull()
    })

    it(`경기 상세: ${status}`, () => {
      const { container } = panel(match(status), BYSTANDER)
      expect(container.textContent).not.toContain(SCORE_A)
      expect(container.textContent).not.toContain(SCORE_B)
      expect(container.textContent).not.toMatch(/승자|공식 결과/)
      expect(screen.queryByText('최종 승인')).toBeNull()
    })

    it(`전체 대진표(그림): ${status}`, () => {
      const { container } = render(<TournamentBracketVisual matches={[match(status)]} nameOf={nameOf} />)
      expect(container.textContent).not.toMatch(/17|85%/)
    })
  }
})

describe('일반 회원 — 최종 승인(official) 결과는 공개된다', () => {
  it('대진표 카드에 승자와 점수가 보인다', () => {
    render(<TournamentBracketView matches={[match('official')]} nameOf={nameOf} highlightMemberId={BYSTANDER} />)
    expect(screen.getByText(/승자 가상선수1/)).toBeInTheDocument()
    expect(screen.getByText(/17\/20 \(85%\)/)).toBeInTheDocument()
  })

  it('경기 상세에 공식 결과가 보인다', () => {
    panel(match('official'), BYSTANDER)
    expect(screen.getByText(/공식 결과 · 승자: 가상선수1/)).toBeInTheDocument()
  })
})

describe('관리자 — 승인 전 상태를 계속 볼 수 있고 승인 업무가 가능하다', () => {
  it('승인 대기 경기에서 점수와 최종 승인 버튼이 보인다', () => {
    const { container } = panel(match('awaitingApproval'), undefined, true)
    expect(container.textContent).toContain(SCORE_A)
    expect(screen.getByText('최종 승인')).toBeInTheDocument()
  })
})
