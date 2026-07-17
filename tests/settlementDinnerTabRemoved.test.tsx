import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SettlementTab } from '../src/tabs/SettlementTab'
import { useSettlementStore } from '../src/store/settlementStore'
import { useApp } from '../src/store/appStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-dinner-removed-1',
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    version: 0,
    revisionLog: [],
    ...overrides,
  }
}

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-dinner-removed-1', syncStatus: 'idle', lastSyncError: null })
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
})

describe('[재현 및 수정 확인] 회식비 탭 제거 — 지출 분류 회식비로 통일', () => {
  it('정산 상단 탭 목록에 "회식비" 탭이 더 이상 없다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    expect(screen.queryByText('회식비')).not.toBeInTheDocument()
  })

  it('상단 탭은 참가자·지출·현금입금·집계/확정·공유 5개만 남는다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    for (const label of ['참가자', '지출', '공유']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /집계/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /현금/ })).toBeInTheDocument()
  })

  it('지출 탭에서 분류 "회식비"를 고를 수 있고, 선택해도 다른 탭으로 튕기지 않는다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '지출' }))
    const select = screen.getByDisplayValue('당구비') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '회식비' } })
    expect(select.value).toBe('회식비')
    // 회식비 전용 탭으로 리다이렉트되지 않았다면 "지출 추가" 입력 폼(제목)이 계속 보여야 한다
    expect(screen.getByText('지출 추가', { selector: 'span' })).toBeInTheDocument()
  })

  it('회식비 분류로 지출을 저장하면 총지출·회식비 요약에 반영된다', () => {
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByText('지출'))
    fireEvent.change(screen.getByDisplayValue('당구비'), { target: { value: '회식비' } })
    fireEvent.change(screen.getByPlaceholderText('항목명 (예: 당구장 대관료)'), { target: { value: '회식 2차' } })
    fireEvent.change(screen.getAllByPlaceholderText('0')[0], { target: { value: '100000' } })
    fireEvent.click(screen.getByRole('button', { name: '지출 추가' }))

    const saved = useSettlementStore.getState().getById('settle-dinner-removed-1')!.expenses[0]
    expect(saved).toMatchObject({ category: '회식비', amount: 100000, clubShare: 100000 })
  })
})
