import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberSettlementSummary } from '../src/components/settlement/MemberSettlementSummary'
import { useSettlementStore } from '../src/store/settlementStore'
import type { RegularSettlement } from '../src/types/settlement'
import type { Session } from '../src/types'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSession(overrides: Partial<Session> = {}): Session {
  return { id: 'session-1', date: '2026-01-10', type: 'regular', attendeeIds: [], games: [], ...overrides }
}

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-member-1',
    sessionId: 'session-1',
    meetingName: '가상 정기모임 1회차',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [
      { id: 'p1', participantType: 'member', memberId: 'p1', displayName: '테스트회원가', addedVia: 'meeting_attendee', dues: { amount: 30000, method: '현금', status: '입금확인' } },
    ],
    expenses: [
      { id: 'e1', date: '2026-01-10', label: '당구장 대관', category: '당구비', amount: 20000, method: '현금', clubShare: 20000, personalDonation: 0 },
    ],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    confirmedAt: '2026-01-10T10:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

beforeEach(() => {
  useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
})

describe('MemberSettlementSummary — 일반회원 확정 정산 공개', () => {
  it('confirmed 정산이 있으면 요약이 표시된다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed' })] })
    render(<MemberSettlementSummary session={fakeSession()} />)
    expect(screen.getByText(/정산 결과/)).toBeInTheDocument()
    expect(screen.getByText(/회비 합계 30,000원/)).toBeInTheDocument()
  })

  it('draft 정산만 있으면 아무것도 표시하지 않는다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'draft' })] })
    const { container } = render(<MemberSettlementSummary session={fakeSession()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('정산이 아예 없으면 영역 자체를 렌더링하지 않는다', () => {
    const { container } = render(<MemberSettlementSummary session={fakeSession()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('revised·cancelled 정산만 있으면 표시하지 않는다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'cancelled', id: 'settle-a' })] })
    const { container } = render(<MemberSettlementSummary session={fakeSession()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('관리자 전용 버튼(임시저장·최종게시·확정·확정취소·수정·삭제)을 전혀 노출하지 않는다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed' })] })
    render(<MemberSettlementSummary session={fakeSession()} />)
    for (const label of ['임시저장', '최종 게시', '정산 확정', '정산 취소', '정산 수정', '수정', '삭제']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it('sessionId로 연결된 정산이 없고 같은 날짜의 확정 정산만 있으면 그것을 표시한다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({ status: 'confirmed', sessionId: undefined, meetingDate: '2026-01-10' })],
    })
    render(<MemberSettlementSummary session={fakeSession({ id: 'other-session-id' })} />)
    expect(screen.getByText(/정산 결과/)).toBeInTheDocument()
  })

  it('다른 날짜의 정산은 표시하지 않는다', () => {
    useSettlementStore.setState({
      settlements: [fakeSettlement({ status: 'confirmed', sessionId: undefined, meetingDate: '2026-02-01' })],
    })
    const { container } = render(<MemberSettlementSummary session={fakeSession({ id: 'other-session-id' })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('통장 잔액·현금 보유액 등 민감 정보 문구를 표시하지 않는다', () => {
    useSettlementStore.setState({ settlements: [fakeSettlement({ status: 'confirmed', prevBankBalance: 999999 })] })
    render(<MemberSettlementSummary session={fakeSession()} />)
    expect(screen.queryByText(/999,999/)).not.toBeInTheDocument()
    expect(screen.queryByText(/통장/)).not.toBeInTheDocument()
  })
})
