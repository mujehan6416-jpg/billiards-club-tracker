import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn().mockResolvedValue(1),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
}))

import {
  buildFundMovementLog, calcHoldingsSummary, calcIncomeSummary, calcExpenseSummary, calcProfitSummary,
  calcBankSummary, calcCashSummary,
} from '../src/logic/settlement'
import { buildMemberShareText, buildPresidentShareText, buildPublicSummary } from '../src/lib/settlementShareText'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import { FundMovementLog } from '../src/components/settlement/FundMovementLog'
import { BankCashWithdrawalForm } from '../src/components/settlement/BankCashWithdrawalForm'
import { CashDepositForm } from '../src/components/settlement/CashDepositForm'
import { SettlementSummary } from '../src/components/settlement/SettlementSummary'
import { SettlementTab } from '../src/tabs/SettlementTab'
import type { RegularSettlement, BankCashWithdrawal, CashDeposit } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원·회계 정보가 아니다.

const ID = 'settle-fundlog-1'

function fake(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: ID, meetingName: '가상 정기모임', meetingDate: '2026-10-05', meetingType: 'regular', status: 'draft',
    participants: [], expenses: [], dinnerContributions: [], cashDeposits: [],
    prevBankBalance: 1_000_000, otherBankAdjustment: 0,
    createdAt: '2026-10-01T00:00:00.000Z', version: 1, revisionLog: [],
    ...overrides,
  }
}

const w = (id: string, date: string, amount: number, extra: Partial<BankCashWithdrawal> = {}): BankCashWithdrawal => ({ id, date, amount, ...extra })
const d = (id: string, depositDate: string, amount: number, extra: Partial<CashDeposit> = {}): CashDeposit => ({
  id, depositDate, amount, status: '입금확인', ...extra,
})

beforeEach(() => {
  useSettlementStore.setState({ settlements: [fake()], currentId: ID, syncStatus: 'idle', lastSyncError: null })
  useAdminAuthStore.setState({ status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test', adminDisplayName: '가상관리자', errorMessage: null })
  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
})

const setStore = (s: RegularSettlement) => useSettlementStore.setState({ settlements: [s], currentId: s.id })

describe('buildFundMovementLog — 통합 내역 계산', () => {
  it('1. 10/05 통장→현금, 10/06 현금→통장은 날짜가 각각 따로 기록·표시된다 (서로 맞추지 않음)', () => {
    const s = fake({
      bankCashWithdrawals: [w('w1', '2026-10-05', 200_000, { note: '행사 운영비 준비' })],
      cashDeposits: [d('d1', '2026-10-06', 80_000, { note: '잔액 재입금' })],
    })
    expect(buildFundMovementLog(s)).toEqual([
      { kind: 'withdrawal', date: '2026-10-05', amount: 200_000, note: '행사 운영비 준비', id: 'w1' },
      { kind: 'deposit', date: '2026-10-06', amount: 80_000, note: '잔액 재입금', id: 'd1' },
    ])
  })

  it('2. 날짜 오름차순(오래된 → 최근)으로 정렬된다 — 입력 순서·종류와 무관하게', () => {
    const s = fake({
      bankCashWithdrawals: [w('w2', '2026-10-20', 30_000), w('w1', '2026-10-03', 10_000)],
      cashDeposits: [d('d2', '2026-10-25', 5_000), d('d1', '2026-10-10', 7_000)],
    })
    expect(buildFundMovementLog(s).map((e) => e.date)).toEqual(['2026-10-03', '2026-10-10', '2026-10-20', '2026-10-25'])
  })

  it('3. 같은 날짜 여러 건은 인출 → 입금, 같은 종류는 기록 시각 → 입력 순서로 항상 같게 정렬된다', () => {
    const s = fake({
      bankCashWithdrawals: [
        w('w-late', '2026-10-05', 3, { createdAt: '2026-10-05T10:00:00.000Z' }),
        w('w-early', '2026-10-05', 1, { createdAt: '2026-10-05T09:00:00.000Z' }),
        w('w-none-a', '2026-10-05', 4),
        w('w-none-b', '2026-10-05', 5),
      ],
      cashDeposits: [d('d-a', '2026-10-05', 6), d('d-b', '2026-10-05', 7)],
    })
    const ids = buildFundMovementLog(s).map((e) => e.id)
    // createdAt 없는 인출('')이 먼저(빈 문자열이 가장 작음) → 입력 순서 유지 → createdAt 있는 인출 → 입금(입력 순서)
    expect(ids).toEqual(['w-none-a', 'w-none-b', 'w-early', 'w-late', 'd-a', 'd-b'])
    // 같은 입력이면 몇 번을 호출해도 같은 결과
    expect(buildFundMovementLog(s).map((e) => e.id)).toEqual(ids)
  })

  it('4. 메모가 없거나 공백뿐이면 note가 비어 있고 정상 처리된다', () => {
    const s = fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 1000, { note: '   ' })], cashDeposits: [d('d1', '2026-10-06', 500)] })
    const log = buildFundMovementLog(s)
    expect(log.map((e) => e.note)).toEqual([undefined, undefined])
  })

  it('5. cashDeposits만 있는 과거 정산 — 입금만 표시된다', () => {
    const log = buildFundMovementLog(fake({ cashDeposits: [d('d1', '2026-10-06', 80_000)] }))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'deposit', date: '2026-10-06', amount: 80_000 })
  })

  it('6. bankCashWithdrawals만 있는 정산 — 인출만 표시된다', () => {
    const log = buildFundMovementLog(fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 200_000)] }))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ kind: 'withdrawal', date: '2026-10-05', amount: 200_000 })
  })

  it('7. 둘 다 없는 기존 정산 — 빈 목록', () => {
    expect(buildFundMovementLog(fake())).toEqual([])
  })

  it('입금확인이 아닌 입금(입금예정·입금전·취소)은 통장 거래가 아니므로 내역에서 제외한다', () => {
    const s = fake({
      cashDeposits: [d('a', '2026-10-06', 1, { status: '입금예정' }), d('b', '2026-10-06', 2, { status: '입금전' }), d('c', '2026-10-06', 3, { status: '취소' }), d('ok', '2026-10-06', 4)],
    })
    expect(buildFundMovementLog(s).map((e) => e.id)).toEqual(['ok'])
  })

  it('8. 표시 추가 후에도 총수입·총지출·통장·현금·전체 보유액 계산이 변하지 않고 원본 배열도 그대로다', () => {
    const base = fake({
      participants: [{ id: 'p1', participantType: 'guest', memberId: null, displayName: '가상A', addedVia: 'manually_added_guest', dues: { amount: 80_000, method: '현금', status: '입금확인' } }],
      expenses: [{ id: 'e1', date: '2026-10-05', label: '다과', category: '기타', amount: 50_000, method: '현금', clubShare: 50_000, personalDonation: 0 }],
      bankCashWithdrawals: [w('w1', '2026-10-05', 200_000)],
      cashDeposits: [d('d1', '2026-10-06', 80_000)],
    })
    const before = JSON.stringify(base)
    const expected = {
      holdings: calcHoldingsSummary(base), income: calcIncomeSummary(base), expense: calcExpenseSummary(base),
      profit: calcProfitSummary(base), bank: calcBankSummary(base), cash: calcCashSummary(base),
    }
    buildFundMovementLog(base)
    expect(JSON.stringify(base)).toBe(before) // 읽기 전용
    // 직전 구현과 같은 숫자(손으로 계산): 통장 1,000,000-200,000+80,000=880,000 / 현금 80,000-50,000+200,000-80,000=150,000
    expect(expected.holdings).toEqual({ bankBalance: 880_000, cashBalance: 150_000, totalHoldings: 1_030_000 })
    expect(expected.profit).toMatchObject({ totalIncome: 80_000, totalExpense: 50_000 })
  })
})

describe('화면 — 입력 날짜 명칭 (출금일 / 입금일)', () => {
  it('① 출금일, ② 입금일 입력칸이 따로 있고 서로 값을 맞추지 않는다', () => {
    render(<><BankCashWithdrawalForm settlementId={ID} /><CashDepositForm settlementId={ID} /></>)
    const out = screen.getByLabelText('출금일') as HTMLInputElement
    const inn = screen.getByLabelText('입금일') as HTMLInputElement
    fireEvent.change(out, { target: { value: '2026-10-05' } })
    expect(inn.value).not.toBe('2026-10-05') // 출금일을 바꿔도 입금일은 자동으로 따라가지 않는다
    fireEvent.change(inn, { target: { value: '2026-10-06' } })
    expect(out.value).toBe('2026-10-05')
    expect(inn.value).toBe('2026-10-06')
  })

  it('목록에는 "출금일 …" / "입금일 …"로 각각 표시된다', () => {
    setStore(fake({
      bankCashWithdrawals: [w('w1', '2026-10-05', 200_000, { note: '행사 운영비 준비' })],
      cashDeposits: [d('d1', '2026-10-06', 80_000, { note: '잔액 재입금' })],
    }))
    render(<><BankCashWithdrawalForm settlementId={ID} /><CashDepositForm settlementId={ID} /></>)
    expect(screen.getByText('출금일 2026-10-05 · 행사 운영비 준비')).toBeInTheDocument()
    expect(screen.getByText('입금일 2026-10-06 · 잔액 재입금')).toBeInTheDocument()
  })
})

describe('FundMovementLog 화면', () => {
  // 카드의 첫 줄: "2026-10-05 · 현금 인출" / "2026-10-06 · 현금 입금"
  const cards = () => within(screen.getByTestId('fund-movement-log')).getAllByText(/^\d{4}-\d{2}-\d{2} · 현금 (인출|입금)$/).map((el) => el.closest('.card') as HTMLElement)

  it('날짜·구분 / 금액 / 메모가 날짜순 카드로 표시되고 합계가 나온다 (제목·안내문 포함)', () => {
    setStore(fake({
      bankCashWithdrawals: [w('w1', '2026-10-05', 200_000, { note: '행사 운영비 준비' })],
      cashDeposits: [d('d1', '2026-10-06', 80_000, { note: '잔액 재입금' }), d('d0', '2026-10-04', 1_000)],
    }))
    render(<FundMovementLog settlementId={ID} />)
    const log = screen.getByTestId('fund-movement-log')
    expect(within(log).getByText('📒 자금이동 내역')).toBeInTheDocument()
    expect(log).toHaveTextContent('통장에서 현금을 인출하거나 현금을 다시 통장에 입금한 내역입니다.')
    expect(log).toHaveTextContent('통장 거래내역과 날짜·금액을 대조할 때 확인할 수 있습니다.')
    const list = cards()
    expect(list).toHaveLength(3)
    expect(list[0]).toHaveTextContent('2026-10-04 · 현금 입금')
    expect(list[0]).toHaveTextContent('현금 → 통장 1,000원')
    expect(list[0]).toHaveTextContent('메모 없음')
    expect(list[1]).toHaveTextContent('2026-10-05 · 현금 인출')
    expect(list[1]).toHaveTextContent('통장 → 현금 200,000원')
    expect(list[1]).toHaveTextContent('행사 운영비 준비')
    expect(list[2]).toHaveTextContent('2026-10-06 · 현금 입금')
    expect(list[2]).toHaveTextContent('현금 → 통장 80,000원')
    expect(list[2]).toHaveTextContent('잔액 재입금')
    expect(screen.getByText('인출 합계 200,000원 (통장 → 현금)')).toBeInTheDocument()
    expect(screen.getByText('입금 합계 81,000원 (현금 → 통장)')).toBeInTheDocument()
  })

  it('기록이 없으면 안내 문구만 보인다', () => {
    render(<FundMovementLog settlementId={ID} />)
    expect(screen.getByText('등록된 자금이동이 없습니다.')).toBeInTheDocument()
  })

  it('입력 UI가 없다 — 같은 거래를 이 영역에서 다시 입력할 수 없다', () => {
    setStore(fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 1)] }))
    render(<FundMovementLog settlementId={ID} />)
    const box = within(screen.getByTestId('fund-movement-log'))
    expect(box.queryAllByRole('button')).toHaveLength(0)
    expect(box.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('9. 좁은 화면 대비: 긴 메모·긴 줄은 줄바꿈되고 표가 아닌 카드 구조다', () => {
    const longNote = '아주긴메모'.repeat(30)
    setStore(fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 1_234_567_890, { note: longNote })] }))
    render(<FundMovementLog settlementId={ID} />)
    const card = cards()[0]
    expect(card.querySelector('table')).toBeNull()
    expect(card).toHaveTextContent('통장 → 현금 1,234,567,890원')
    expect(card).toHaveTextContent(longNote)
    expect(within(card).getByText(longNote).style.overflowWrap).toBe('anywhere')
    expect(within(card).getByText('2026-10-05 · 현금 인출').style.overflowWrap).toBe('anywhere')
  })
})

describe('배치 위치', () => {
  it('"현금·통장" 탭과 "집계/확정" 탭 양쪽에 자금이동 내역이 보인다', () => {
    setStore(fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 200_000)] }))
    render(<SettlementTab devMembers={[]} devSessions={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /현금/ }))
    expect(screen.getByTestId('fund-movement-log')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /집계/ }))
    expect(screen.getByTestId('fund-movement-log')).toBeInTheDocument()
  })

  it('집계 화면(SettlementSummary)에도 날짜별 내역이 포함된다', () => {
    setStore(fake({ bankCashWithdrawals: [w('w1', '2026-10-05', 200_000)], cashDeposits: [d('d1', '2026-10-06', 80_000)] }))
    render(<SettlementSummary settlementId={ID} />)
    expect(screen.getByText('2026-10-05 · 현금 인출')).toBeInTheDocument()
    expect(screen.getByText('2026-10-06 · 현금 입금')).toBeInTheDocument()
  })
})

describe('공유문·공개 범위', () => {
  const confirmed = (extra: Partial<RegularSettlement> = {}) =>
    fake({ status: 'confirmed', confirmedAt: '2026-10-07T00:00:00.000Z', ...extra })

  it('회장 보고문에는 (인출이 있으면) 날짜별 자금이동 내역이 나온다', () => {
    const text = buildPresidentShareText(confirmed({
      bankCashWithdrawals: [w('w1', '2026-10-05', 200_000, { note: '행사 운영비 준비' })],
      cashDeposits: [d('d1', '2026-10-06', 80_000, { note: '잔액 재입금' })],
    }))
    expect(text).toContain('[자금이동 내역]')
    expect(text).toContain('10/05 통장→현금 200,000원 (행사 운영비 준비)')
    expect(text).toContain('10/06 현금→통장 80,000원 (잔액 재입금)')
    expect(text.indexOf('10/05 통장→현금')).toBeLessThan(text.indexOf('10/06 현금→통장'))
  })

  it('인출 기록이 없는 기존 정산의 회장 보고문은 예전과 똑같다 (입금만 있어도 줄이 늘지 않는다)', () => {
    const legacy = confirmed({ cashDeposits: [d('d1', '2026-10-06', 0)] })
    expect(buildPresidentShareText(legacy)).not.toContain('[자금이동 내역]')
  })

  it('회원용 공유문·공개 요약에는 자금이동 상세가 나타나지 않고 인출 유무와 무관하게 같다', () => {
    const plain = confirmed({ cashDeposits: [d('d1', '2026-10-06', 0)] })
    const moved = confirmed({ cashDeposits: [d('d1', '2026-10-06', 0)], bankCashWithdrawals: [w('w1', '2026-10-05', 200_000, { note: '비밀메모' })] })
    expect(buildMemberShareText(moved)).toBe(buildMemberShareText(plain))
    expect(buildPublicSummary(moved)).toEqual(buildPublicSummary(plain))
    expect(JSON.stringify(buildPublicSummary(moved))).not.toContain('비밀메모')
    expect(buildMemberShareText(moved)).not.toContain('인출')
  })
})
