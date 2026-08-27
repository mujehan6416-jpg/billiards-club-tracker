import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TournamentDrawAdmin } from '../src/components/tournament/TournamentDrawAdmin'
import type { Tournament, TournamentMatch, TournamentParticipant } from '../src/types/tournament'

// 가상 데이터만 사용한다 — 실제 회원 이름·경기 데이터가 아니다.

function tournament(over: Partial<Tournament> = {}): Tournament {
  return {
    id: 't1', name: '테스트 대회', date: '2026-10-01', timeLimitMinutes: 50,
    status: 'entryClosed', participantCount: 3, createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

function participant(n: number, over: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return {
    id: `p${n}`, memberId: `m${n}`, displayNameSnapshot: `테스트회원${n}`,
    baseHandicapSnapshot: 20, tournamentHandicap: 20, entryStatus: 'entered',
    ...over,
  }
}

const nameOf = (id: string | null) => (id ? `이름-${id}` : '')

const noop = {
  onPrepareDraw: vi.fn(), onSaveDrawNumbers: vi.fn(), onBuildPreview: vi.fn(),
  onConfirmBracket: vi.fn(), onReopenEntries: vi.fn(), onCancelBracket: vi.fn(),
}

describe('entryClosed — 추첨 준비 전', () => {
  it('추첨 준비 버튼을 누르면 onPrepareDraw가 호출된다', () => {
    const onPrepareDraw = vi.fn()
    render(
      <TournamentDrawAdmin
        tournament={tournament()} enteredParticipants={[participant(1), participant(2), participant(3)]}
        matches={null} nameOf={nameOf} {...noop} onPrepareDraw={onPrepareDraw}
      />,
    )
    fireEvent.click(screen.getByText('추첨 준비'))
    expect(onPrepareDraw).toHaveBeenCalledTimes(1)
  })

  it('참가자 확정 취소를 누르고 확인하면 onReopenEntries가 호출된다', () => {
    const onReopenEntries = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <TournamentDrawAdmin
        tournament={tournament()} enteredParticipants={[participant(1), participant(2)]}
        matches={null} nameOf={nameOf} {...noop} onReopenEntries={onReopenEntries}
      />,
    )
    fireEvent.click(screen.getByText('참가자 확정 취소'))
    expect(onReopenEntries).toHaveBeenCalledTimes(1)
  })

  it('확인창에서 취소하면 onReopenEntries가 호출되지 않는다', () => {
    const onReopenEntries = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <TournamentDrawAdmin
        tournament={tournament()} enteredParticipants={[participant(1), participant(2)]}
        matches={null} nameOf={nameOf} {...noop} onReopenEntries={onReopenEntries}
      />,
    )
    fireEvent.click(screen.getByText('참가자 확정 취소'))
    expect(onReopenEntries).not.toHaveBeenCalled()
  })
})

describe('drawReady — 번호 입력', () => {
  const participants = [participant(1), participant(2), participant(3)]

  it('참가자 이름과 번호 입력칸이 모두 보인다', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.getByText('테스트회원1')).toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3)
  })

  it('같은 번호를 두 번 입력하면 즉시 중복 안내가 뜬다', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '1' } })
    fireEvent.change(inputs[1], { target: { value: '1' } })
    expect(screen.getByText(/이미 사용된 번호입니다/)).toBeInTheDocument()
  })

  it('범위 밖 번호(참가자 수 초과)는 저장 버튼을 활성화하지 않는다', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '1' } })
    fireEvent.change(inputs[1], { target: { value: '2' } })
    fireEvent.change(inputs[2], { target: { value: '99' } })
    expect(screen.getByText('번호 저장')).toBeDisabled()
  })

  it('일부만 입력했으면 저장 버튼이 비활성화된다(참가자 누락 차단)', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '1' } })
    expect(screen.getByText('번호 저장')).toBeDisabled()
  })

  it('전부 정상 입력하면 저장 버튼이 활성화되고, 누르면 onSaveDrawNumbers가 전체 목록으로 호출된다', () => {
    const onSaveDrawNumbers = vi.fn()
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop} onSaveDrawNumbers={onSaveDrawNumbers}
      />,
    )
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '2' } })
    fireEvent.change(inputs[1], { target: { value: '1' } })
    fireEvent.change(inputs[2], { target: { value: '3' } })
    fireEvent.click(screen.getByText('번호 저장'))

    expect(onSaveDrawNumbers).toHaveBeenCalledTimes(1)
    const entries = onSaveDrawNumbers.mock.calls[0][0]
    expect(entries).toHaveLength(3)
    expect(new Set(entries.map((e: { drawNumber: number }) => e.drawNumber))).toEqual(new Set([1, 2, 3]))
  })

  it('모든 참가자에게 drawNumber가 이미 저장돼 있으면 "대진표 확인" 버튼이 보인다', () => {
    const saved = participants.map((p, i) => ({ ...p, drawNumber: i + 1 }))
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={saved}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.getByText('대진표 확인')).toBeInTheDocument()
  })

  it('아직 일부 미입력이면 "대진표 확인" 버튼이 없다', () => {
    const partiallySaved = [{ ...participants[0], drawNumber: 1 }, participants[1], participants[2]]
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={partiallySaved}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.queryByText('대진표 확인')).not.toBeInTheDocument()
  })

  it('"대진표 확인"을 누르면 onBuildPreview가 호출된다', () => {
    const onBuildPreview = vi.fn()
    const saved = participants.map((p, i) => ({ ...p, drawNumber: i + 1 }))
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={saved}
        matches={null} nameOf={nameOf} {...noop} onBuildPreview={onBuildPreview}
      />,
    )
    fireEvent.click(screen.getByText('대진표 확인'))
    expect(onBuildPreview).toHaveBeenCalledTimes(1)
  })

  it('drawReady에서도 참가자 확정 취소 버튼을 쓸 수 있다', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={null} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.getByText('참가자 확정 취소')).toBeInTheDocument()
  })
})

describe('drawReady — 대진표 미리보기 단계', () => {
  const participants = [participant(1), participant(2)].map((p, i) => ({ ...p, drawNumber: i + 1 }))
  const previewMatches: TournamentMatch[] = [{
    id: 'r1m1', roundNumber: 1, playerCountInRound: 2, matchNumber: 1,
    playerAParticipantId: 'p1', playerBParticipantId: 'p2',
    playerAMemberId: 'm1', playerBMemberId: 'm2',
    playerAHandicapSnapshot: 20, playerBHandicapSnapshot: 20,
    scoreA: null, scoreB: null, resultType: 'normal', status: 'awaitingResult',
    nextMatchId: null, nextSlot: null,
  }]

  it('미리보기 대진표가 보이고 "확정 전" 배너가 함께 뜬다', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={previewMatches} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.getByText(/아직 확정 전 미리보기/)).toBeInTheDocument()
  })

  it('대진 확정을 누르고 확인하면 onConfirmBracket이 호출된다', () => {
    const onConfirmBracket = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={previewMatches} nameOf={nameOf} {...noop} onConfirmBracket={onConfirmBracket}
      />,
    )
    fireEvent.click(screen.getByText('대진 확정'))
    expect(onConfirmBracket).toHaveBeenCalledTimes(1)
  })

  it('대진 확정 확인창에서 취소하면 onConfirmBracket이 호출되지 않는다', () => {
    const onConfirmBracket = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'drawReady' })} enteredParticipants={participants}
        matches={previewMatches} nameOf={nameOf} {...noop} onConfirmBracket={onConfirmBracket}
      />,
    )
    fireEvent.click(screen.getByText('대진 확정'))
    expect(onConfirmBracket).not.toHaveBeenCalled()
  })
})

describe('bracketFixed — 확정 후', () => {
  it('대진 확정 취소 버튼만 보이고, 대진표 자체는 다시 그리지 않는다(TournamentTab이 공통으로 그린다)', () => {
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'bracketFixed' })} enteredParticipants={[participant(1), participant(2)]}
        matches={[]} nameOf={nameOf} {...noop}
      />,
    )
    expect(screen.getByText('대진 확정 취소')).toBeInTheDocument()
    expect(screen.queryByText('vs')).not.toBeInTheDocument()
  })

  it('대진 확정 취소를 누르고 확인하면 onCancelBracket이 호출된다', () => {
    const onCancelBracket = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <TournamentDrawAdmin
        tournament={tournament({ status: 'bracketFixed' })} enteredParticipants={[participant(1), participant(2)]}
        matches={[]} nameOf={nameOf} {...noop} onCancelBracket={onCancelBracket}
      />,
    )
    fireEvent.click(screen.getByText('대진 확정 취소'))
    expect(onCancelBracket).toHaveBeenCalledTimes(1)
  })
})
