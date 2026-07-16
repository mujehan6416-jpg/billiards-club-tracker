import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹해, 이 테스트가 실제 Firebase에 절대
// 접근하지 않도록 한다. 이 테스트의 핵심 목적 자체가 "previewMode에서는 이 함수가 호출되지
// 않아야 한다"는 안전장치를 검증하는 것이다.
const saveSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import { DuesTable } from '../src/components/settlement/DuesTable'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-preview-1',
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
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-preview-1', syncStatus: 'idle', lastSyncError: null })
  // Firebase Auth 세션이 남아있는 상황(이번 안전사고의 원인 가설)을 그대로 재현해서 테스트한다 —
  // previewMode는 관리자 인증 여부와 무관하게 저장을 막아야 한다.
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  saveSettlementMock.mockReset()
  saveSettlementMock.mockResolvedValue(1)
})

describe('DuesTable — previewMode 안전장치(개발 미리보기에서 실제 Firestore 쓰기 차단)', () => {
  it('previewMode에서는 임시저장 버튼이 비활성화되어 있다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText('임시저장')).toBeDisabled()
  })

  it('previewMode에서는 최종 게시 버튼이 비활성화되어 있다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText('최종 게시')).toBeDisabled()
  })

  it('previewMode에서 임시저장 버튼을 눌러도 saveSettlement(Firestore 저장 함수)가 호출되지 않는다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    fireEvent.click(screen.getByText('임시저장'))
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('previewMode에서는 "저장되지 않습니다" 안내를 보여주고, 저장 성공 메시지는 표시하지 않는다', () => {
    render(<DuesTable settlementId="settle-preview-1" previewMode />)
    expect(screen.getByText(/개발 미리보기에서는 저장되지 않습니다/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('임시저장'))
    expect(screen.queryByText('임시저장 완료')).not.toBeInTheDocument()
  })

  it('previewMode가 아니면(일반 관리자 화면과 동일) 임시저장 버튼이 활성 상태이고, 클릭하면 실제 saveSettlement가 호출된다', async () => {
    render(<DuesTable settlementId="settle-preview-1" />)
    const btn = screen.getByText('임시저장')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    await waitFor(() => expect(saveSettlementMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('임시저장 완료')).toBeInTheDocument())
  })
})
