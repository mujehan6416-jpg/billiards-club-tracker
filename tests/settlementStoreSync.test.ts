import { describe, it, expect, vi, beforeEach } from 'vitest'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹해, store의 흐름 제어 로직만 검증한다.
const listSettlementsMock = vi.fn()
const getSettlementMock = vi.fn()
const saveSettlementMock = vi.fn()
const deleteSettlementMock = vi.fn()

vi.mock('../src/lib/settlementSync', () => ({
  listSettlements: (...args: unknown[]) => listSettlementsMock(...args),
  getSettlement: (...args: unknown[]) => getSettlementMock(...args),
  saveSettlement: (...args: unknown[]) => saveSettlementMock(...args),
  deleteSettlement: (...args: unknown[]) => deleteSettlementMock(...args),
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
  deleteSettlementMock.mockReset()
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

  it('authorizedAdmin이 아니면 deleteSettlement도 거부되고 목록이 그대로 유지된다', async () => {
    const id = createDraftSettlement()
    const res = await useSettlementStore.getState().deleteSettlement(id)
    expect(res.ok).toBe(false)
    expect(deleteSettlementMock).not.toHaveBeenCalled()
    expect(useSettlementStore.getState().getById(id)).toBeDefined()
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

  it('draft 저장 후 store를 초기화(재접속 재현)하고 loadSettlements로 다시 불러오면 동일한 draft가 복원된다', async () => {
    // 1) 관리자가 draft를 만들고 저장(saveDraft) — 실제 saveDraft 경로를 그대로 태운다.
    const id = useSettlementStore.getState().createSettlement({
      meetingName: '가상 정기모임 7회차', meetingDate: '2026-03-01', meetingType: 'regular',
      sessionId: 'session-restore-test', actorDisplayName: '테스트관리자',
    })
    saveSettlementMock.mockResolvedValue(1)
    const saveRes = await useSettlementStore.getState().saveDraft(id)
    expect(saveRes.ok).toBe(true)
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.id).toBe(id)
    expect(savedPayload.status).toBe('draft')

    // 2) 앱 재접속(로그아웃 후 재로그인, 새로고침 등)을 재현 — 로컬 settlementStore를 완전히 비운다.
    useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
    expect(useSettlementStore.getState().getById(id)).toBeUndefined()

    // 3) Firestore에는 방금 저장된 payload가 그대로 있다고 가정하고 loadSettlements를 호출한다.
    listSettlementsMock.mockResolvedValue([{ ...savedPayload, version: 1 }])
    const loadRes = await useSettlementStore.getState().loadSettlements()
    expect(loadRes.ok).toBe(true)

    // 4) 같은 sessionId/식별키로 동일한 draft가 복원되어야 한다 — 새 문서가 중복 생성되지 않는다.
    const restored = useSettlementStore.getState().getById(id)
    expect(restored).toBeDefined()
    expect(restored!.status).toBe('draft')
    expect(restored!.sessionId).toBe('session-restore-test')
    expect(restored!.meetingName).toBe('가상 정기모임 7회차')
    expect(useSettlementStore.getState().settlements).toHaveLength(1) // 중복 생성 없음
  })

  it('[재현] 지출·회식비 입력 후 draft 저장 → 재접속 재현 → loadSettlements로 다시 불러오면 지출·회식비가 그대로 복원된다', async () => {
    const id = useSettlementStore.getState().createSettlement({
      meetingName: '가상 정기모임 8회차', meetingDate: '2026-03-08', meetingType: 'regular', actorDisplayName: '테스트관리자',
    })
    const expenseRes = useSettlementStore.getState().addExpense(id, {
      date: '2026-03-08', label: '가상 대관료', category: '대관비', amount: 100000, method: '체크카드', clubShare: 100000, personalDonation: 0,
    })
    expect(expenseRes.ok).toBe(true)
    const dinnerRes = useSettlementStore.getState().addDinnerContribution(id, {
      dinnerRound: 1, totalAmount: 200000, method: '현금', clubShare: 0, contributionType: '전액찬조',
      contributors: [{ name: '가상찬조자1', memberId: null, amount: 200000, title: '회장님' }],
    })
    expect(dinnerRes.ok).toBe(true)

    saveSettlementMock.mockResolvedValue(1)
    const saveRes = await useSettlementStore.getState().saveDraft(id)
    expect(saveRes.ok).toBe(true)
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    // 저장 직전 시점에 실제로 store에 있던 지출·회식비가 Firestore로 보낼 payload에 포함되는지 확인
    expect(savedPayload.expenses).toHaveLength(1)
    expect(savedPayload.expenses[0]).toMatchObject({ label: '가상 대관료', amount: 100000 })
    expect(savedPayload.dinnerContributions).toHaveLength(1)
    expect(savedPayload.dinnerContributions[0]).toMatchObject({ dinnerRound: 1, totalAmount: 200000 })

    // 재접속 재현
    useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
    listSettlementsMock.mockResolvedValue([{ ...savedPayload, version: 1 }])
    const loadRes = await useSettlementStore.getState().loadSettlements()
    expect(loadRes.ok).toBe(true)

    const restored = useSettlementStore.getState().getById(id)
    expect(restored).toBeDefined()
    expect(restored!.expenses).toHaveLength(1)
    expect(restored!.expenses[0]).toMatchObject({ label: '가상 대관료', category: '대관비', amount: 100000, method: '체크카드' })
    expect(restored!.dinnerContributions).toHaveLength(1)
    expect(restored!.dinnerContributions[0]).toMatchObject({ dinnerRound: 1, totalAmount: 200000, contributionType: '전액찬조' })
    expect(restored!.dinnerContributions[0].contributors).toHaveLength(1)
  })

  it('지출 여러 건을 입력 순서대로 저장·복원하고, 금액·구분·결제수단·메모를 모두 보존한다', async () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 지출 A', category: '음료수비', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0, note: '가상 메모 A',
    })
    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 지출 B', category: '상품비', amount: 20000, method: '계좌이체', clubShare: 20000, personalDonation: 0,
    })
    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 지출 C', category: '기타', amount: 5000, method: '기타', clubShare: 5000, personalDonation: 0, note: '가상 메모 C',
    })

    saveSettlementMock.mockResolvedValue(1)
    await useSettlementStore.getState().saveDraft(id)
    const savedPayload = saveSettlementMock.mock.calls[0][0]

    useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
    listSettlementsMock.mockResolvedValue([{ ...savedPayload, version: 1 }])
    await useSettlementStore.getState().loadSettlements()

    const restored = useSettlementStore.getState().getById(id)!
    expect(restored.expenses.map((e) => e.label)).toEqual(['가상 지출 A', '가상 지출 B', '가상 지출 C']) // 입력 순서 유지
    expect(restored.expenses[0]).toMatchObject({ amount: 10000, category: '음료수비', method: '현금', note: '가상 메모 A' })
    expect(restored.expenses[1]).toMatchObject({ amount: 20000, category: '상품비', method: '계좌이체' })
    expect(restored.expenses[1].note).toBeUndefined()
    expect(restored.expenses[2]).toMatchObject({ amount: 5000, category: '기타', method: '기타', note: '가상 메모 C' })
  })

  it('confirmed 상태 정산의 지출·회식비도 draft와 동일하게 저장·복원된다', async () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 확정 지출', category: '기타', amount: 15000, method: '현금', clubShare: 15000, personalDonation: 0,
    })
    useSettlementStore.getState().changeStatus(id, 'confirmed', '테스트관리자')
    expect(useSettlementStore.getState().getById(id)!.status).toBe('confirmed')

    saveSettlementMock.mockResolvedValue(1)
    await useSettlementStore.getState().saveDraft(id) // saveDraft는 현재 status를 그대로 저장한다(상태 자체를 바꾸지 않음)
    const savedPayload = saveSettlementMock.mock.calls[0][0]
    expect(savedPayload.status).toBe('confirmed')
    expect(savedPayload.expenses).toHaveLength(1)

    useSettlementStore.setState({ settlements: [], currentId: null, syncStatus: 'idle', lastSyncError: null })
    listSettlementsMock.mockResolvedValue([{ ...savedPayload, version: 1 }])
    await useSettlementStore.getState().loadSettlements()

    const restored = useSettlementStore.getState().getById(id)!
    expect(restored.status).toBe('confirmed')
    expect(restored.expenses).toHaveLength(1)
    expect(restored.expenses[0]).toMatchObject({ label: '가상 확정 지출', amount: 15000 })
  })

  it('지출·회식비를 추가해도 참가자·회비·찬조 데이터는 전혀 영향받지 않는다(데이터 격리 확인)', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().addGuestParticipant(id, '가상참가자1')
    const participantId = useSettlementStore.getState().getById(id)!.participants[0].id
    useSettlementStore.getState().updateDues(id, participantId, { amount: 30000, method: '현금' })

    useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '가상 지출', category: '기타', amount: 10000, method: '현금', clubShare: 10000, personalDonation: 0,
    })
    useSettlementStore.getState().addDinnerContribution(id, {
      dinnerRound: 1, totalAmount: 50000, method: '현금', clubShare: 50000, contributionType: '모임회계지출', contributors: [],
    })

    const after = useSettlementStore.getState().getById(id)!
    expect(after.participants).toHaveLength(1)
    expect(after.participants[0].dues).toMatchObject({ amount: 30000, method: '현금' })
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

describe('deleteSettlement', () => {
  beforeEach(() => {
    useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'dev-admin-uid', email: 'dev-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  })

  it('삭제 성공 시 settlementSync.deleteSettlement이 호출되고 목록에서 해당 항목만 제거된다', async () => {
    const id = createDraftSettlement()
    const otherId = useSettlementStore.getState().createSettlement({
      meetingName: '가상 정기모임 2회차', meetingDate: '2026-01-11', meetingType: 'regular', actorDisplayName: '테스트관리자',
    })
    deleteSettlementMock.mockResolvedValue(undefined)

    const res = await useSettlementStore.getState().deleteSettlement(id)
    expect(res.ok).toBe(true)
    expect(deleteSettlementMock).toHaveBeenCalledWith(id)
    expect(useSettlementStore.getState().getById(id)).toBeUndefined()
    expect(useSettlementStore.getState().getById(otherId)).toBeDefined()
    expect(useSettlementStore.getState().settlements).toHaveLength(1)
  })

  it('삭제한 정산이 currentId였다면 currentId를 null로 초기화한다', async () => {
    const id = createDraftSettlement()
    expect(useSettlementStore.getState().currentId).toBe(id)
    deleteSettlementMock.mockResolvedValue(undefined)

    await useSettlementStore.getState().deleteSettlement(id)
    expect(useSettlementStore.getState().currentId).toBeNull()
  })

  it('삭제한 정산이 currentId가 아니었다면 currentId를 그대로 유지한다', async () => {
    const keepId = createDraftSettlement()
    const toDeleteId = useSettlementStore.getState().createSettlement({
      meetingName: '가상 정기모임 3회차', meetingDate: '2026-01-12', meetingType: 'regular', actorDisplayName: '테스트관리자',
    })
    useSettlementStore.setState({ currentId: keepId })
    deleteSettlementMock.mockResolvedValue(undefined)

    await useSettlementStore.getState().deleteSettlement(toDeleteId)
    expect(useSettlementStore.getState().currentId).toBe(keepId)
  })

  it('draft·confirmed·cancelled 등 어떤 상태의 정산도 삭제할 수 있다(guard로 막히지 않는다)', async () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().changeStatus(id, 'confirmed', '테스트관리자')
    useSettlementStore.getState().changeStatus(id, 'cancelled', '테스트관리자')
    expect(useSettlementStore.getState().getById(id)!.status).toBe('cancelled')
    deleteSettlementMock.mockResolvedValue(undefined)

    const res = await useSettlementStore.getState().deleteSettlement(id)
    expect(res.ok).toBe(true)
    expect(useSettlementStore.getState().getById(id)).toBeUndefined()
  })

  it('Firestore 삭제 실패 시 목록과 currentId가 그대로 유지되고 오류가 남는다', async () => {
    const id = createDraftSettlement()
    deleteSettlementMock.mockRejectedValue(new Error('가상 삭제 실패'))

    const res = await useSettlementStore.getState().deleteSettlement(id)
    expect(res.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)).toBeDefined()
    expect(useSettlementStore.getState().currentId).toBe(id)
    expect(useSettlementStore.getState().lastSyncError).toContain('가상 삭제 실패')
    expect(useSettlementStore.getState().syncStatus).toBe('error')
  })

  it('존재하지 않는 id는 Firestore 호출 없이 실패를 반환한다', async () => {
    const res = await useSettlementStore.getState().deleteSettlement('no-such-id')
    expect(res.ok).toBe(false)
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })
})
