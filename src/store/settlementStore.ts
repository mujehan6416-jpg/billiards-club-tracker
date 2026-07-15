import { create } from 'zustand'
import type { Member, Session } from '../types'
import type {
  RegularSettlement,
  SettlementParticipant,
  SettlementExpense,
  DinnerContribution,
  CashDeposit,
  SettlementStatus,
  DuesPayment,
  DonationPayment,
  SettlementPublicSummary,
} from '../types/settlement'
import {
  calcIncomeSummary,
  calcExpenseSummary,
  calcProfitSummary,
  calcCashSummary,
  calcBankSummary,
  transitionStatus,
  isLocked,
  validateDinnerContribution,
  hasDuplicateDinnerRound,
  validateCashDeposit,
} from '../logic/settlement'
import { buildMemberShareText, buildPresidentShareText, buildPublicSummary } from '../lib/settlementShareText'
import { DINNER_CATEGORY } from '../lib/settlementConstants'
import { useAdminAuthStore } from './adminAuthStore'
import * as settlementSync from '../lib/settlementSync'

// 이 store는 로컬(메모리) 계산·검증 로직과 Firestore 동기화(신규)를 함께 갖는다.
// 로컬 전용 액션(생성/참가자/지출/회식비/현금입금/상태전이 등)은 이전 단계와 동일하게
// Firestore를 전혀 호출하지 않는다. 새로 추가된 클라우드 동기화 액션(loadSettlements 등)만
// Firestore(clubs/skkubc/settlements)를 호출하며, 전부 useAdminAuthStore가 'authorizedAdmin'일
// 때만 실행된다 — Firebase Auth 로그인 + admins/{uid}.active 확인이 모두 끝나야 한다.
//
// 잠금(confirmed/cancelled) 상태에서는 화면(disabled 속성)뿐 아니라 이 store의 모든 로컬 수정 액션도
// LOCKED_ERROR를 반환하고 실제로 상태를 바꾸지 않는다 — "화면만 잠그고 데이터는 그대로 바뀌는" 사고를 막기 위함.
// 관리자 화면 진입·확정/취소 등 민감 작업의 2차 확인용 PIN(useAdmin().isAdmin)은 이번 단계에서
// 그대로 유지한다 — Firebase Auth(서버 권한)와 PIN(화면 재확인)은 서로 다른 목적이라 병행한다.
//
// version 소유권 규칙: 로컬 편집 함수(참가자/지출/찬조/회식비/현금입금/상태전이 등)는 절대
// settlement.version을 바꾸지 않는다. version은 오직 pushToCloud()가 settlementSync.saveSettlement()
// 저장에 성공했을 때 그 반환값으로만 갱신된다. 저장이 실패하면 로컬 version은 그대로 유지된다
// (로컬 편집 내용도 롤백하지 않는다 — lastSyncError로 서버와 어긋났을 수 있다는 경고만 남긴다).

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export type StoreResult = { ok: true } | { ok: false; error: string }
export type SyncStatus = 'idle' | 'loading' | 'saving' | 'error'

/** 이름 찾을 수 없는(탈퇴·삭제된) 회원 ID를 참가자로 넣을 때 표시하는 자리표시 이름. */
export const UNKNOWN_MEMBER_NAME = '이름 확인 필요'

export type ImportAttendeesResult =
  | { ok: true; addedCount: number; unresolvedCount: number; duplicateSkippedCount: number; totalAttendees: number }
  | { ok: false; error: string }

// 실패만 나타내는 좁은 타입 — StoreResult뿐 아니라 ImportAttendeesResult 같은 확장 결과 타입에도
// 그대로 대입할 수 있어야 하므로 { ok: true } 분기가 섞이지 않게 별도로 둔다.
type ErrorResult = { ok: false; error: string }
const NOT_FOUND: ErrorResult = { ok: false, error: '정산을 찾을 수 없습니다.' }
const LOCKED_ERROR: ErrorResult = { ok: false, error: '확정된 정산은 수정할 수 없습니다. 먼저 "정산 수정"을 눌러주세요.' }
const NOT_AUTHORIZED: ErrorResult = { ok: false, error: '관리자 인증이 필요합니다. Firebase 관리자 로그인 후 다시 시도해주세요.' }

interface SettlementStoreState {
  settlements: RegularSettlement[]
  currentId: string | null
  syncStatus: SyncStatus
  lastSyncError: string | null

  setCurrentId: (id: string | null) => void
  getCurrent: () => RegularSettlement | undefined
  getById: (id: string) => RegularSettlement | undefined

  createSettlement: (input: {
    meetingName: string
    meetingDate: string
    meetingType: 'regular' | 'tournament'
    meetingRound?: number
    sessionId?: string
    actorDisplayName: string
  }) => string

  /**
   * 세션 참석자를 정산 대상자로 불러온다(이미 참가자로 들어와 있는 회원은 건너뜀 — memberId 기준 중복 방지).
   * 현재 회원명부에서 이름을 찾을 수 없는 ID(탈퇴·삭제된 회원)는 제외하지 않고
   * UNKNOWN_MEMBER_NAME("이름 확인 필요")로 표시해 그대로 추가한다 — 관리자가 눈으로 보고 정리할 수 있게.
   */
  initFromAttendees: (settlementId: string, session: Session, members: Member[]) => ImportAttendeesResult
  addMemberParticipant: (settlementId: string, member: Member) => StoreResult
  addGuestParticipant: (settlementId: string, displayName: string) => StoreResult
  removeParticipant: (settlementId: string, participantId: string) => StoreResult
  updateDues: (settlementId: string, participantId: string, patch: Partial<DuesPayment> | null) => StoreResult
  updateDonation: (settlementId: string, participantId: string, patch: Partial<DonationPayment> | null) => StoreResult

  addExpense: (settlementId: string, expense: Omit<SettlementExpense, 'id'>) => StoreResult
  updateExpense: (settlementId: string, expenseId: string, patch: Partial<Omit<SettlementExpense, 'id'>>) => StoreResult
  deleteExpense: (settlementId: string, expenseId: string) => StoreResult

  addDinnerContribution: (settlementId: string, dinner: Omit<DinnerContribution, 'id'>) => StoreResult
  updateDinnerContribution: (settlementId: string, dinnerId: string, patch: Omit<DinnerContribution, 'id'>) => StoreResult
  deleteDinnerContribution: (settlementId: string, dinnerId: string) => StoreResult

  addCashDeposit: (settlementId: string, deposit: Omit<CashDeposit, 'id'>) => StoreResult
  updateCashDeposit: (settlementId: string, depositId: string, patch: Partial<Omit<CashDeposit, 'id'>>) => StoreResult
  deleteCashDeposit: (settlementId: string, depositId: string) => StoreResult

  updatePrevBankBalance: (settlementId: string, amount: number) => StoreResult
  updateOtherBankAdjustment: (settlementId: string, amount: number) => StoreResult

  changeStatus: (settlementId: string, to: SettlementStatus, actorDisplayName: string, reason?: string) => StoreResult

  getSummary: (settlementId: string) => {
    income: ReturnType<typeof calcIncomeSummary>
    expense: ReturnType<typeof calcExpenseSummary>
    profit: ReturnType<typeof calcProfitSummary>
    cash: ReturnType<typeof calcCashSummary>
    bank: ReturnType<typeof calcBankSummary>
  } | null
  getPublicSummary: (settlementId: string) => SettlementPublicSummary | null
  getMemberShareText: (settlementId: string) => string
  getPresidentShareText: (settlementId: string) => string

  // ── Firestore 동기화 (전부 authorizedAdmin 상태에서만 동작) ──
  loadSettlements: () => Promise<StoreResult>
  loadSettlement: (settlementId: string) => Promise<StoreResult>
  saveDraft: (settlementId: string) => Promise<StoreResult>
  confirmSettlement: (settlementId: string, actorDisplayName: string) => Promise<StoreResult>
  reviseSettlement: (settlementId: string, actorDisplayName: string, reason?: string) => Promise<StoreResult>
  cancelSettlement: (settlementId: string, actorDisplayName: string, reason?: string) => Promise<StoreResult>
}

function patchSettlement(
  settlements: RegularSettlement[],
  id: string,
  fn: (s: RegularSettlement) => RegularSettlement,
): RegularSettlement[] {
  return settlements.map((s) => (s.id === id ? { ...fn(s), updatedAt: now() } : s))
}

export const useSettlementStore = create<SettlementStoreState>()((set, get) => {
  /** 잠금 상태면 LOCKED_ERROR를, 정산이 없으면 NOT_FOUND를 반환. 통과하면 null. */
  function guard(settlementId: string): { ok: false; error: string } | null {
    const settlement = get().getById(settlementId)
    if (!settlement) return NOT_FOUND
    if (isLocked(settlement.status)) return LOCKED_ERROR
    return null
  }

  /** authorizedAdmin이 아니면 NOT_AUTHORIZED를, 맞으면 null을 반환. */
  function guardAdmin(): StoreResult | null {
    if (useAdminAuthStore.getState().status !== 'authorizedAdmin') return NOT_AUTHORIZED
    return null
  }

  /** 로컬 settlement를 Firestore에 저장. 실패해도 로컬 상태는 되돌리지 않고 lastSyncError만 남긴다. */
  async function pushToCloud(settlementId: string): Promise<StoreResult> {
    const authBlocked = guardAdmin()
    if (authBlocked) return authBlocked
    const settlement = get().getById(settlementId)
    if (!settlement) return NOT_FOUND
    set({ syncStatus: 'saving' })
    try {
      const newVersion = await settlementSync.saveSettlement(settlement)
      // version은 오직 여기서만(=저장 성공 시에만) 갱신한다. 다른 로컬 편집 함수는 절대 건드리지 않는다.
      set((s) => ({
        settlements: s.settlements.map((st) => (st.id === settlementId ? { ...st, version: newVersion } : st)),
        syncStatus: 'idle',
        lastSyncError: null,
      }))
      return { ok: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : '저장 중 알 수 없는 오류가 발생했습니다.'
      set({
        syncStatus: 'error',
        lastSyncError: `서버 저장 실패: ${message} (로컬 화면의 내용과 서버에 저장된 내용이 다를 수 있습니다.)`,
      })
      return { ok: false, error: message }
    }
  }

  return {
    settlements: [],
    currentId: null,
    syncStatus: 'idle',
    lastSyncError: null,

    setCurrentId: (id) => set({ currentId: id }),
    getCurrent: () => get().settlements.find((s) => s.id === get().currentId),
    getById: (id) => get().settlements.find((s) => s.id === id),

    createSettlement: ({ meetingName, meetingDate, meetingType, meetingRound, sessionId, actorDisplayName }) => {
      const id = uid()
      const nowIso = now()
      const settlement: RegularSettlement = {
        id,
        sessionId,
        meetingName,
        meetingRound,
        meetingDate,
        meetingType,
        status: 'draft',
        participants: [],
        expenses: [],
        dinnerContributions: [],
        cashDeposits: [],
        prevBankBalance: 0,
        otherBankAdjustment: 0,
        createdAt: nowIso,
        // 0 = "아직 서버에 저장된 적 없음". 서버 저장에 처음 성공하면 1이 된다(pushToCloud 참고).
        version: 0,
        revisionLog: [
          { fromStatus: 'draft', toStatus: 'draft', changedAt: nowIso, actorDisplayName, reason: '정산 생성' },
        ],
      }
      set((s) => ({ settlements: [...s.settlements, settlement], currentId: id }))
      return id
    },

    initFromAttendees: (settlementId, session, members) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlementBefore = get().getById(settlementId)
      if (!settlementBefore) return NOT_FOUND

      const existingMemberIds = new Set(settlementBefore.participants.map((p) => p.memberId).filter(Boolean))
      const targetIds = session.attendeeIds.filter((mid) => !existingMemberIds.has(mid))
      const duplicateSkippedCount = session.attendeeIds.length - targetIds.length

      let unresolvedCount = 0
      const toAdd: SettlementParticipant[] = targetIds.map((mid) => {
        const member = members.find((m) => m.id === mid)
        if (!member) unresolvedCount += 1
        return {
          id: uid(),
          participantType: 'member',
          memberId: mid,
          displayName: member ? member.name : UNKNOWN_MEMBER_NAME,
          addedVia: 'meeting_attendee',
        }
      })

      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (settlement) => ({
          ...settlement,
          sessionId: session.id,
          participants: [...settlement.participants, ...toAdd],
        })),
      }))

      return {
        ok: true,
        addedCount: toAdd.length,
        unresolvedCount,
        duplicateSkippedCount,
        totalAttendees: session.attendeeIds.length,
      }
    },

    addMemberParticipant: (settlementId, member) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlement = get().getById(settlementId)!
      if (settlement.participants.some((p) => p.memberId === member.id)) {
        return { ok: false, error: `${member.name} 회원은 이미 정산 대상자에 포함되어 있습니다.` }
      }
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          participants: [
            ...st.participants,
            { id: uid(), participantType: 'member', memberId: member.id, displayName: member.name, addedVia: 'manually_added_member' },
          ],
        })),
      }))
      return { ok: true }
    },

    addGuestParticipant: (settlementId, displayName) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const name = displayName.trim()
      if (!name) return { ok: false, error: '비회원 이름을 입력해주세요.' }
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          participants: [
            ...st.participants,
            { id: uid(), participantType: 'guest', memberId: null, displayName: name, addedVia: 'manually_added_guest' },
          ],
        })),
      }))
      return { ok: true }
    },

    removeParticipant: (settlementId, participantId) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          participants: st.participants.filter((p) => p.id !== participantId),
        })),
      }))
      return { ok: true }
    },

    updateDues: (settlementId, participantId, patch) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          participants: st.participants.map((p) =>
            p.id !== participantId
              ? p
              : { ...p, dues: patch === null ? undefined : { ...(p.dues ?? { amount: 0, method: '현금', status: '미납' }), ...patch } },
          ),
        })),
      }))
      return { ok: true }
    },

    updateDonation: (settlementId, participantId, patch) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          participants: st.participants.map((p) =>
            p.id !== participantId
              ? p
              : { ...p, donation: patch === null ? undefined : { ...(p.donation ?? { amount: 0, method: '현금', status: '미확인' }), ...patch } },
          ),
        })),
      }))
      return { ok: true }
    },

    addExpense: (settlementId, expense) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      if (expense.category === DINNER_CATEGORY) {
        return { ok: false, error: '회식비는 일반 지출이 아니라 회식비 전용 입력에서 등록해주세요.' }
      }
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          expenses: [...st.expenses, { ...expense, id: uid() }],
        })),
      }))
      return { ok: true }
    },

    updateExpense: (settlementId, expenseId, patch) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      if (patch.category === DINNER_CATEGORY) {
        return { ok: false, error: '회식비는 일반 지출이 아니라 회식비 전용 입력에서 등록해주세요.' }
      }
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          expenses: st.expenses.map((e) => (e.id === expenseId ? { ...e, ...patch } : e)),
        })),
      }))
      return { ok: true }
    },

    deleteExpense: (settlementId, expenseId) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          expenses: st.expenses.filter((e) => e.id !== expenseId),
        })),
      }))
      return { ok: true }
    },

    addDinnerContribution: (settlementId, dinner) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlement = get().getById(settlementId)!
      if (hasDuplicateDinnerRound(settlement.dinnerContributions, dinner.dinnerRound)) {
        return { ok: false, error: `이미 ${dinner.dinnerRound}차 회식비가 등록되어 있습니다. 기존 항목을 수정해주세요.` }
      }
      const validation = validateDinnerContribution(dinner)
      if (!validation.ok) return validation
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          dinnerContributions: [...st.dinnerContributions, { ...dinner, id: uid() }],
        })),
      }))
      return { ok: true }
    },

    updateDinnerContribution: (settlementId, dinnerId, patch) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlement = get().getById(settlementId)!
      if (hasDuplicateDinnerRound(settlement.dinnerContributions, patch.dinnerRound, dinnerId)) {
        return { ok: false, error: `이미 ${patch.dinnerRound}차 회식비가 등록되어 있습니다.` }
      }
      const validation = validateDinnerContribution(patch)
      if (!validation.ok) return validation
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          dinnerContributions: st.dinnerContributions.map((d) => (d.id === dinnerId ? { ...patch, id: dinnerId } : d)),
        })),
      }))
      return { ok: true }
    },

    deleteDinnerContribution: (settlementId, dinnerId) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          dinnerContributions: st.dinnerContributions.filter((d) => d.id !== dinnerId),
        })),
      }))
      return { ok: true }
    },

    addCashDeposit: (settlementId, deposit) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlement = get().getById(settlementId)!
      const validation = validateCashDeposit(settlement, deposit)
      if (!validation.ok) return validation
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          cashDeposits: [...st.cashDeposits, { ...deposit, id: uid() }],
        })),
      }))
      return { ok: true }
    },

    updateCashDeposit: (settlementId, depositId, patch) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      const settlement = get().getById(settlementId)!
      const existing = settlement.cashDeposits.find((d) => d.id === depositId)
      if (!existing) return { ok: false, error: '입금 내역을 찾을 수 없습니다.' }
      const merged = { ...existing, ...patch }
      const validation = validateCashDeposit(settlement, { id: depositId, amount: merged.amount, status: merged.status })
      if (!validation.ok) return validation
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          cashDeposits: st.cashDeposits.map((d) => (d.id === depositId ? merged : d)),
        })),
      }))
      return { ok: true }
    },

    deleteCashDeposit: (settlementId, depositId) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({
          ...st,
          cashDeposits: st.cashDeposits.filter((d) => d.id !== depositId),
        })),
      }))
      return { ok: true }
    },

    updatePrevBankBalance: (settlementId, amount) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({ ...st, prevBankBalance: amount })),
      }))
      return { ok: true }
    },

    updateOtherBankAdjustment: (settlementId, amount) => {
      const blocked = guard(settlementId)
      if (blocked) return blocked
      set((s) => ({
        settlements: patchSettlement(s.settlements, settlementId, (st) => ({ ...st, otherBankAdjustment: amount })),
      }))
      return { ok: true }
    },

    changeStatus: (settlementId, to, actorDisplayName, reason) => {
      const settlement = get().getById(settlementId)
      if (!settlement) return NOT_FOUND
      // Firebase Auth로 인증된 관리자가 있으면 실제 UID를 기록한다(없으면 undefined로 남고,
      // Firestore 저장 시 settlementSync.stripUndefinedDeep이 그 필드를 제거한다).
      const actorUid = useAdminAuthStore.getState().uid ?? undefined
      const result = transitionStatus(settlement, to, { uid: actorUid, displayName: actorDisplayName }, reason)
      if (!result.ok) return result
      set((s) => ({
        settlements: s.settlements.map((st) => (st.id === settlementId ? result.settlement : st)),
      }))
      return { ok: true }
    },

    getSummary: (settlementId) => {
      const settlement = get().getById(settlementId)
      if (!settlement) return null
      return {
        income: calcIncomeSummary(settlement),
        expense: calcExpenseSummary(settlement),
        profit: calcProfitSummary(settlement),
        cash: calcCashSummary(settlement),
        bank: calcBankSummary(settlement),
      }
    },

    getPublicSummary: (settlementId) => {
      const settlement = get().getById(settlementId)
      if (!settlement || settlement.status !== 'confirmed') return null
      return buildPublicSummary(settlement)
    },

    getMemberShareText: (settlementId) => {
      const settlement = get().getById(settlementId)
      return settlement ? buildMemberShareText(settlement) : ''
    },

    getPresidentShareText: (settlementId) => {
      const settlement = get().getById(settlementId)
      return settlement ? buildPresidentShareText(settlement) : ''
    },

    loadSettlements: async () => {
      const authBlocked = guardAdmin()
      if (authBlocked) return authBlocked
      set({ syncStatus: 'loading' })
      try {
        const fetched = await settlementSync.listSettlements()
        set((s) => ({
          settlements: fetched,
          currentId: s.currentId && fetched.some((f) => f.id === s.currentId) ? s.currentId : null,
          syncStatus: 'idle',
          lastSyncError: null,
        }))
        return { ok: true }
      } catch (e) {
        const message = e instanceof Error ? e.message : '목록을 불러오지 못했습니다.'
        set({ syncStatus: 'error', lastSyncError: message })
        return { ok: false, error: message }
      }
    },

    loadSettlement: async (settlementId) => {
      const authBlocked = guardAdmin()
      if (authBlocked) return authBlocked
      set({ syncStatus: 'loading' })
      try {
        const fetched = await settlementSync.getSettlement(settlementId)
        if (!fetched) {
          set({ syncStatus: 'idle' })
          return NOT_FOUND
        }
        set((s) => {
          const exists = s.settlements.some((x) => x.id === fetched.id)
          return {
            settlements: exists
              ? s.settlements.map((x) => (x.id === fetched.id ? fetched : x))
              : [...s.settlements, fetched],
            syncStatus: 'idle',
            lastSyncError: null,
          }
        })
        return { ok: true }
      } catch (e) {
        const message = e instanceof Error ? e.message : '정산을 불러오지 못했습니다.'
        set({ syncStatus: 'error', lastSyncError: message })
        return { ok: false, error: message }
      }
    },

    saveDraft: async (settlementId) => {
      const settlement = get().getById(settlementId)
      if (!settlement) return NOT_FOUND
      return pushToCloud(settlementId)
    },

    confirmSettlement: async (settlementId, actorDisplayName) => {
      const local = get().changeStatus(settlementId, 'confirmed', actorDisplayName)
      if (!local.ok) return local
      return pushToCloud(settlementId)
    },

    reviseSettlement: async (settlementId, actorDisplayName, reason) => {
      const local = get().changeStatus(settlementId, 'revised', actorDisplayName, reason)
      if (!local.ok) return local
      return pushToCloud(settlementId)
    },

    cancelSettlement: async (settlementId, actorDisplayName, reason) => {
      const local = get().changeStatus(settlementId, 'cancelled', actorDisplayName, reason)
      if (!local.ok) return local
      return pushToCloud(settlementId)
    },
  }
})

/** 입력 필드를 잠가야 하는 상태인지 화면에서 바로 쓸 수 있도록 재노출. */
export { isLocked }
