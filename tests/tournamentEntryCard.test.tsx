import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TournamentEntryCard } from '../src/components/tournament/TournamentEntryCard'
import type { Tournament, TournamentParticipant } from '../src/types/tournament'

// 참가자 명단 3열 배치·정렬·개인정보 노출 여부를 집중적으로 확인한다.
// 이름은 전부 가상 데이터다.

const draftTournament: Tournament = {
  id: 't1', name: '테스트 대회', date: '2026-10-01', timeLimitMinutes: 50,
  status: 'draft', createdAt: '2026-09-01T00:00:00.000Z',
}

const me: TournamentParticipant = {
  id: 'me', memberId: 'me', displayNameSnapshot: '본인', baseHandicapSnapshot: 20, tournamentHandicap: 20,
  entryStatus: 'entered',
}

function entered(name: string, id: string): TournamentParticipant {
  return { id, memberId: id, displayNameSnapshot: name, baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered' }
}

function renderCard(enteredParticipants: TournamentParticipant[]) {
  return render(
    <TournamentEntryCard
      tournament={draftTournament}
      participant={me}
      enteredParticipants={enteredParticipants}
      onSetEntryStatus={vi.fn()}
    />,
  )
}

describe('참가자 명단 3열 배치 — 인원 수별', () => {
  const counts = [1, 2, 3, 4, 7, 8, 12]

  it.each(counts)('%i명일 때 참가인원·명단 인원이 정확히 일치하고 가짜 데이터로 채우지 않는다', (n) => {
    const list = Array.from({ length: n }, (_, i) => entered(`가상회원${i + 1}`, `p${i + 1}`))
    const { container } = renderCard(list)
    expect(screen.getByText(`현재 참가신청 ${n}명`)).toBeInTheDocument()
    expect(screen.getByText(`참가자 명단 ${n}명`)).toBeInTheDocument()
    const grid = container.querySelector('[style*="grid-template-columns"]') as HTMLElement
    expect(grid.children.length).toBe(n)
  })

  it('3열 그리드(grid-template-columns: repeat(3, ...))로 배치된다', () => {
    const { container } = renderCard([entered('가상회원1', 'p1')])
    const grid = container.querySelector('[style*="grid-template-columns"]') as HTMLElement
    expect(grid.style.gridTemplateColumns).toContain('repeat(3')
  })
})

describe('참가자 이름 정렬', () => {
  it('Firestore 반환 순서와 무관하게 가나다순으로 정렬한다', () => {
    const list = [entered('최영수', 'p3'), entered('강민준', 'p1'), entered('김서연', 'p2')]
    const { container } = renderCard(list)
    const grid = container.querySelector('[style*="grid-template-columns"]') as HTMLElement
    const names = Array.from(grid.children).map((el) => el.textContent)
    expect(names).toEqual(['강민준', '김서연', '최영수'])
  })
})

describe('긴 이름 처리', () => {
  it('긴 이름도 overflow ellipsis 스타일을 갖고 한 칸을 유지한다(줄바꿈 없음)', () => {
    const longName = '아주아주아주긴이름테스트회원'
    const { container } = renderCard([entered(longName, 'p1')])
    const cell = container.querySelector(`span[title="${longName}"]`) as HTMLElement
    expect(cell).toBeTruthy()
    expect(cell.style.whiteSpace).toBe('nowrap')
    expect(cell.style.textOverflow).toBe('ellipsis')
    expect(cell.style.overflow).toBe('hidden')
  })
})

describe('참가자 명단 개인정보', () => {
  it('memberId, 회원 문서 ID 등은 텍스트로 노출되지 않는다', () => {
    const list = [entered('가상회원1', 'dev-tm-secret-id')]
    const { container } = renderCard(list)
    expect(container.textContent).not.toContain('dev-tm-secret-id')
  })
})
