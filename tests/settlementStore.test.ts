import { describe, it, expect, beforeEach } from 'vitest'
import { useSettlementStore } from '../src/store/settlementStore'
import type { Member, Session } from '../src/types'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const fakeMember = (id: string, name: string): Member => ({
  id, name, handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true,
})

function createDraftSettlement(): string {
  return useSettlementStore.getState().createSettlement({
    meetingName: '가상 정기모임 1회차', meetingDate: '2026-01-10', meetingType: 'regular', actorDisplayName: '테스트관리자',
  })
}

beforeEach(() => {
  useSettlementStore.setState({ settlements: [], currentId: null })
})

describe('addMemberParticipant', () => {
  it('동일 회원을 중복으로 추가할 수 없다', () => {
    const id = createDraftSettlement()
    const member = fakeMember('m1', '테스트회원A')
    const first = useSettlementStore.getState().addMemberParticipant(id, member)
    const second = useSettlementStore.getState().addMemberParticipant(id, member)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.participants).toHaveLength(1)
  })
})

describe('addGuestParticipant', () => {
  it('비회원을 이름만으로 추가할 수 있다', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().addGuestParticipant(id, '가상비회원A')
    expect(res.ok).toBe(true)
    const settlement = useSettlementStore.getState().getById(id)!
    expect(settlement.participants).toHaveLength(1)
    expect(settlement.participants[0].participantType).toBe('guest')
    expect(settlement.participants[0].memberId).toBeNull()
  })

  it('빈 이름은 거부한다', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().addGuestParticipant(id, '   ')
    expect(res.ok).toBe(false)
  })
})

describe('addExpense — 회식비 이중 입력 방지', () => {
  it('분류가 회식비면 일반 지출로 저장하지 않는다', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '회식', category: '회식비', amount: 100000, method: '현금', clubShare: 100000, personalDonation: 0,
    })
    expect(res.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.expenses).toHaveLength(0)
  })
})

describe('addDinnerContribution — 회식 차수 중복 방지 및 총액 검증', () => {
  it('같은 차수를 두 번 추가하면 거부한다', () => {
    const id = createDraftSettlement()
    const first = useSettlementStore.getState().addDinnerContribution(id, {
      dinnerRound: 1, totalAmount: 100000, method: '현금', clubShare: 100000, contributionType: '모임회계지출', contributors: [],
    })
    const second = useSettlementStore.getState().addDinnerContribution(id, {
      dinnerRound: 1, totalAmount: 50000, method: '현금', clubShare: 50000, contributionType: '모임회계지출', contributors: [],
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.dinnerContributions).toHaveLength(1)
  })

  it('totalAmount = clubShare + 찬조자 합계가 아니면 저장하지 않는다', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().addDinnerContribution(id, {
      dinnerRound: 1, totalAmount: 150000, method: '현금', clubShare: 50000, contributionType: '일부찬조',
      contributors: [{ name: '테스트회원A', memberId: null, amount: 90000 }], // 50000+90000 != 150000
    })
    expect(res.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.dinnerContributions).toHaveLength(0)
  })
})

describe('addCashDeposit — 현금 잔액 초과 방지', () => {
  it('입금 전 현금 잔액을 넘는 입금확인은 저장하지 않는다', () => {
    const id = createDraftSettlement()
    const member = fakeMember('m1', '테스트회원A')
    useSettlementStore.getState().addMemberParticipant(id, member)
    useSettlementStore.getState().updateDues(id, useSettlementStore.getState().getById(id)!.participants[0].id, { amount: 30000, method: '현금', status: '입금확인' })

    const res = useSettlementStore.getState().addCashDeposit(id, { depositDate: '2026-01-11', amount: 40000, status: '입금확인' })
    expect(res.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.cashDeposits).toHaveLength(0)
  })

  it('현금 잔액 이내면 저장된다', () => {
    const id = createDraftSettlement()
    const member = fakeMember('m1', '테스트회원A')
    useSettlementStore.getState().addMemberParticipant(id, member)
    useSettlementStore.getState().updateDues(id, useSettlementStore.getState().getById(id)!.participants[0].id, { amount: 30000, method: '현금', status: '입금확인' })

    const res = useSettlementStore.getState().addCashDeposit(id, { depositDate: '2026-01-11', amount: 30000, status: '입금확인' })
    expect(res.ok).toBe(true)
  })
})

describe('confirmed 상태에서 입력 잠금', () => {
  it('확정 후에는 참가자·지출·회식비·현금입금 수정이 모두 막힌다', () => {
    const id = createDraftSettlement()
    const member = fakeMember('m1', '테스트회원A')
    useSettlementStore.getState().addMemberParticipant(id, member)

    const confirmRes = useSettlementStore.getState().changeStatus(id, 'confirmed', '테스트관리자')
    expect(confirmRes.ok).toBe(true)

    const addRes = useSettlementStore.getState().addMemberParticipant(id, fakeMember('m2', '테스트회원B'))
    const expenseRes = useSettlementStore.getState().addExpense(id, {
      date: '2026-01-10', label: '음료수', category: '음료수비', amount: 5000, method: '현금', clubShare: 5000, personalDonation: 0,
    })
    const cashRes = useSettlementStore.getState().addCashDeposit(id, { depositDate: '2026-01-11', amount: 1000, status: '입금확인' })

    expect(addRes.ok).toBe(false)
    expect(expenseRes.ok).toBe(false)
    expect(cashRes.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.participants).toHaveLength(1)
    expect(useSettlementStore.getState().getById(id)!.expenses).toHaveLength(0)
  })

  it('confirmed → revised로 바꾸면 다시 수정할 수 있다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().changeStatus(id, 'confirmed', '테스트관리자')
    useSettlementStore.getState().changeStatus(id, 'revised', '테스트관리자', '금액 수정 필요')
    const res = useSettlementStore.getState().addGuestParticipant(id, '가상비회원A')
    expect(res.ok).toBe(true)
  })
})

describe('getPublicSummary — 확정 전에는 노출하지 않는다', () => {
  it('draft 상태에서는 null', () => {
    const id = createDraftSettlement()
    expect(useSettlementStore.getState().getPublicSummary(id)).toBeNull()
  })

  it('confirmed 이후에는 공개용 요약을 반환하고 민감 필드가 없다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().changeStatus(id, 'confirmed', '테스트관리자')
    const summary = useSettlementStore.getState().getPublicSummary(id)
    expect(summary).not.toBeNull()
    const keys = Object.keys(summary!)
    expect(keys).not.toContain('prevBankBalance')
    expect(keys).not.toContain('participants')
    expect(keys).not.toContain('adminNote')
  })
})

describe('Member/Session 연결 (시나리오 C)', () => {
  const fakeMembers: Member[] = Array.from({ length: 8 }, (_, i) => ({
    id: `dev-mem-${i + 1}`, name: `가상회원${i + 1}`, handicap: 15 + i,
    handicapHistory: [{ value: 15 + i, changedAt: '2026-01-01T00:00:00.000Z' }], active: true,
  }))
  const fakeSession: Session = {
    id: 'dev-session-c1', date: '2026-03-01', type: 'regular',
    attendeeIds: ['dev-mem-1', 'dev-mem-2', 'dev-mem-3', 'dev-mem-4', 'dev-mem-5'],
    games: [],
  }

  it('initFromAttendees는 Session.attendeeIds에 있는 5명만 정확히 불러온다', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    expect(res.ok).toBe(true)
    const participants = useSettlementStore.getState().getById(id)!.participants
    expect(participants).toHaveLength(5)
    expect(participants.map((p) => p.memberId).sort()).toEqual(['dev-mem-1', 'dev-mem-2', 'dev-mem-3', 'dev-mem-4', 'dev-mem-5'])
  })

  it('member 참가자는 memberId와 displayName이 원본 Member와 정확히 연결된다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    const p1 = useSettlementStore.getState().getById(id)!.participants.find((p) => p.memberId === 'dev-mem-3')!
    expect(p1.displayName).toBe('가상회원3')
    expect(p1.participantType).toBe('member')
    expect(p1.addedVia).toBe('meeting_attendee')
  })

  it('미참석 회원(가상회원6)을 회원 추가로 넣을 수 있다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    const member6 = fakeMembers.find((m) => m.id === 'dev-mem-6')!
    const res = useSettlementStore.getState().addMemberParticipant(id, member6)
    expect(res.ok).toBe(true)
    const participants = useSettlementStore.getState().getById(id)!.participants
    expect(participants).toHaveLength(6)
    const added = participants.find((p) => p.memberId === 'dev-mem-6')!
    expect(added.displayName).toBe('가상회원6')
    expect(added.addedVia).toBe('manually_added_member')
  })

  it('이미 참석자로 들어온 회원(가상회원1)을 다시 추가하면 중복 차단된다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    const member1 = fakeMembers.find((m) => m.id === 'dev-mem-1')!
    const res = useSettlementStore.getState().addMemberParticipant(id, member1)
    expect(res.ok).toBe(false)
    expect(useSettlementStore.getState().getById(id)!.participants).toHaveLength(5)
  })

  it('가상 비회원을 추가하면 memberId가 null이다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    const res = useSettlementStore.getState().addGuestParticipant(id, '가상비회원C1')
    expect(res.ok).toBe(true)
    const guest = useSettlementStore.getState().getById(id)!.participants.find((p) => p.displayName === '가상비회원C1')!
    expect(guest.memberId).toBeNull()
    expect(guest.participantType).toBe('guest')
  })

  it('initFromAttendees는 addedCount 등 결과 요약을 반환한다(참석자 5명 케이스)', () => {
    const id = createDraftSettlement()
    const res = useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    expect(res).toMatchObject({ ok: true, addedCount: 5, unresolvedCount: 0, duplicateSkippedCount: 0, totalAttendees: 5 })
  })

  it('참석 기록이 없는(0명) 모임은 addedCount 0과 totalAttendees 0을 반환한다', () => {
    const id = createDraftSettlement()
    const emptySession: Session = { id: 'dev-session-empty', date: '2026-04-01', type: 'regular', attendeeIds: [], games: [] }
    const res = useSettlementStore.getState().initFromAttendees(id, emptySession, fakeMembers)
    expect(res).toMatchObject({ ok: true, addedCount: 0, totalAttendees: 0 })
    expect(useSettlementStore.getState().getById(id)!.participants).toHaveLength(0)
  })

  it('탈퇴·삭제되어 회원명부에 없는 ID는 "이름 확인 필요"로 표시되고 제외되지 않는다', () => {
    const id = createDraftSettlement()
    const sessionWithGhost: Session = {
      id: 'dev-session-ghost', date: '2026-05-01', type: 'regular',
      attendeeIds: ['dev-mem-1', 'dev-mem-999-deleted'],
      games: [],
    }
    const res = useSettlementStore.getState().initFromAttendees(id, sessionWithGhost, fakeMembers)
    expect(res).toMatchObject({ ok: true, addedCount: 2, unresolvedCount: 1 })
    const participants = useSettlementStore.getState().getById(id)!.participants
    expect(participants).toHaveLength(2)
    const ghost = participants.find((p) => p.memberId === 'dev-mem-999-deleted')!
    expect(ghost).toBeDefined()
    expect(ghost.displayName).toBe('이름 확인 필요')
    expect(ghost.participantType).toBe('member')
  })

  it('같은 세션을 다시 불러오면 이미 있는 참가자는 중복 추가되지 않는다(duplicateSkippedCount)', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    const res = useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    expect(res).toMatchObject({ ok: true, addedCount: 0, duplicateSkippedCount: 5 })
    expect(useSettlementStore.getState().getById(id)!.participants).toHaveLength(5)
  })

  it('먼저 추가해 둔 비회원 참가자는 세션 불러오기 이후에도 그대로 유지된다', () => {
    const id = createDraftSettlement()
    useSettlementStore.getState().addGuestParticipant(id, '가상비회원선등록')
    const res = useSettlementStore.getState().initFromAttendees(id, fakeSession, fakeMembers)
    expect(res.ok).toBe(true)
    const participants = useSettlementStore.getState().getById(id)!.participants
    expect(participants).toHaveLength(6) // 비회원 1명 + 세션 참석자 5명
    expect(participants.some((p) => p.displayName === '가상비회원선등록')).toBe(true)
  })
})
