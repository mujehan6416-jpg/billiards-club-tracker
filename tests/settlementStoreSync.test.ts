import { describe, it, expect, vi, beforeEach } from 'vitest'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹해, store의 흐름 제어 로직만 검증한다.
const listSettlementsMock = vi.fn()
const getSettlementMock = vi.fn()
const saveSettlementMock = vi.fn()

vi.mock('../src/lib/settlementSync', () => ({
  listSettlements: (...args: unknown[]) => listSettlementsMock(...args),
  getSettlement: (...args: unknown[]) => getSettlementMock(...args),
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
}))

import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'

// 아래 이름은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function createDraftSettlement(): string {
  return useSettlementStore.getState().createSettlement({
    meetingName: '가상 정기모임 1회차', meetingDate: '2026-01-10', meetingType: 'regular', actorDisplayName: '테스트관리자',
  })
}

beforeEach(() => {
  useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  listSettlementsMock.mockReset()
  getSettlementMock.mockReset()
  saveSettlementMock.mockReset()
})

describe('관리자 인증 게이트', () => {
  it('authorizedAdmin이 아니면 loadSettlements가 거부되고 Firestore를 호출하지 않는다', async () => {
    const res = await useSettlementStore.getState().loadSettlements()
    expect(res.ok).toBe(false)
    expect(listSettlementsMock).not.toHaveBeenCalled()
  })

  it('authorizedAdmin이 아니면 saveDraft도 거부된다', async () => {
    const id = createDraftSettlement()
    const res = await useSettlementStore.getState().saveDraft(id)
    expect(res.ok).toBe(false)
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })
})

describe('authorizedAdmin 상태에서의 동기화', () => {
  beforeEach(() => {
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'dev-admin-uid', email: 'dev-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  })

  it('loadSettlements 성공 시 로컬 목록이 서버 목록으로 교체된다', async () => {
    const remote = [
      { id: 'remote-1', meetingName: '가상 원격 정산', meetingDate: '2026-02-01', meetingType: 'regular', status: 'draft', participants: [], expenses: [], dinnerContributions: [], cashDeposits: [], prevBankBalance: 0, otherBankAdjustment: 0, createdAt: '2026-02-01T00:00:00.000Z', version: 1, revisionLog: [] },
    ]
    listSettlementsMock.mockResolvedValue(remote)
    const res = await useSettlementStore.getState().loadSettlements()
    expect(res.ok).toBe(true)
    expect(useSettlementStore.getState().settlements).toEqual(remote)
    expect(useSettlementStore.getState().syncStatus).toBe('idle')
  })

  it('신규 정산은 로컬 version 0으로 시작한다(아직 서버에 저장된 적 없음)', () => {
    const id = createDraftSettlement()
    expect(useSettlementStore.getState().getById(id)!.version).toBe(0)
  })

  it('일반 편집 함수(updateExpense 등) 호출만으로는 version이 증가하지 않는다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 지출', category: '기타', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0,
    })
    expect(useSettlementStore.getState().getById(id)!.version).toBe(0)
    const expenseId = useSettlementStore.getState().getById(id)!.expenses[0].id
    useSettlementStore.getState().updateExpense(id, expenseId, { amount: 20000 })
    expect(useSettlementStore.getState().getById(id)!.version).toBe(0)
  })

  it('saveDraft 성공 시 settlementSync.saveSettlement이 호출되고, 반환된 새 버전이 로컬에 반영된다', async () => {
    const id = createDraftSettlement()
    saveSettlementMock.mockResolvedValue(1) // 로컬 version 0 → 서버 신규 생성 → 새 버전 1
    const res = await useSettlementStore.getState().saveDraft(id)
    expect(res.ok).toBe(true)
    expect(saveSettlementMock).toHaveBeenCalledTimes(1)
    expect(useSettlementStore.getState().lastSyncError).toBeNull()
    expect(useSettlementStore.getState().getById(id)!.version).toBe(1)
  })

  it('confirmSettlement: 로컬 상태 전이가 실패하면 Firestore를 호출하지 않는다', async () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().changeStatus(id, 'cancelled', '테스트관리자')
    const res = await useSettlementStore.getState().confirmSettlement(id, '테스트관리자')
    expect(res.ok).toBe(false) // cancelled → confirmed는 금지된 전이
    expect(saveSettlementMock).not.toHaveBeenCalled()
  })

  it('confirmSettlement 성공: 로컬 상태가 confirmed로 바뀌고, 저장 성공 시 version이 정확히 1만 증가한다', async () => {
    const id = createDraftSettlement()
    expect(useSettlementStore.getState().getById(id)!.version).toBe(0)
    saveSettlementMock.mockResolvedValue(1)
    const res = await useSettlementStore.getState().confirmSettlement(id, '테스트관리자')
    expect(res.ok).toBe(true)
    expect(useSettlementStore.getState().getById(id)!.status).toBe('confirmed')
    expect(useSettlementStore.getState().getById(id)!.version).toBe(1) // 0 → 1 (정확히 1만 증가)
    expect(saveSettlementMock).toHaveBeenCalledTimes(1)
  })

  it('confirmSettlement: 인증된 관리자의 uid가 confirmedByUid로 기록되어 서버에 전달된다', async () => {
    const id = createDraftSettlement()
    saveSettlementMock.mockResolvedValue(1)
    await useSettlementStore.getState().confirmSettlement(id, '테스트관리자')
    expect(useSettlementStore.getState().getById(id)!.confirmedByUid).toBe('dev-admin-uid')
    const sentToServer = saveSettlementMock.mock.calls[0][0]
    expect(sentToServer.confirmedByUid).toBe('dev-admin-uid')
  })

  it('네트워크 실패 시 로컬 상태(및 version)는 유지되고 lastSyncError에 경고가 남는다', async () => {
    const id = createDraftSettlement()
    saveSettlementMock.mockRejectedValue(new Error('네트워크 오류(가상)'))
    const res = await useSettlementStore.getState().confirmSettlement(id, '테스트관리자')
    expect(res.ok).toBe(false)
    // 로컬 상태 전이 자체는 이미 반영되어 있어야 한다(롤백하지 않음)
    expect(useSettlementStore.getState().getById(id)!.status).toBe('confirmed')
    // 저장이 실패했으므로 version은 그대로(0) 유지되어야 한다
    expect(useSettlementStore.getState().getById(id)!.version).toBe(0)
    expect(useSettlementStore.getState().lastSyncError).toContain('네트워크 오류(가상)')
    expect(useSettlementStore.getState().syncStatus).toBe('error')
  })
})
