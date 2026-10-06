import type { RegularSettlement } from '../../types/settlement'
import { calcCashSummary, calcHoldingsSummary } from '../../logic/settlement'

// "현금·통장" 탭의 현금 요약 두 가지. 새로 계산하지 않고 기존 calcCashSummary / calcHoldingsSummary가 이미 내는
// 값을 사용자가 이해하기 쉬운 항목으로 풀어서 보여주기만 한다(수입·지출·잔액 계산식은 그대로).
//
//   현재 보유 현금 = 현금으로 받은 금액 + 통장에서 인출한 금액 − 현금 지출 금액 − 통장에 입금한 금액
//                  = cash.cashIncome + cash.bankWithdrawal − cash.cashExpense − cash.confirmedDeposit = cash.cashBalance
//
// - 현금으로 받은 금액: 현금 회비 + 현금 찬조금(계좌이체·기타 수입은 들어가지 않는다)
// - 현금 지출 금액: 결제수단이 현금인 지출(+ 예전 회식비 중 현금)만
// - 통장에 입금한 금액: "입금확인"된 현금 통장 입금만(입금예정·입금전·취소는 제외)

const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`

const row = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 15, lineHeight: 1.7 } as const
const labelStyle = { minWidth: 0, overflowWrap: 'anywhere' } as const
const amountStyle = { whiteSpace: 'nowrap', fontWeight: 600 } as const

/** 현금이 모자라면(음수) "현금 부족 N원", 아니면 "N원". 집계/확정 탭에서도 같은 표현을 쓰도록 내보낸다. */
export function formatCash(n: number): string {
  return n < 0 ? `현금 부족 ${fmt(-n)}` : fmt(n)
}
const cashText = formatCash

function Row({ label, value, strong, danger }: { label: string; value: string; strong?: boolean; danger?: boolean }) {
  return (
    <div style={{ ...row, ...(strong ? { fontWeight: 700, fontSize: 17 } : {}), ...(danger ? { color: '#c0392b' } : {}) }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ ...amountStyle, ...(strong ? { fontWeight: 700 } : {}) }}>{value}</span>
    </div>
  )
}

// 현재 보유 현금이 음수일 때(지출이 확인된 현금보다 많을 때)의 안내 — 두 줄로 나눠 보여준다.
const SHORTAGE_HINT = '현금으로 지출한 금액이 현재 확인된 현금보다 많습니다.\n현금 수입, 통장 인출 또는 지출 내역을 확인해 주세요.'
// 현재는 괜찮은데 지금 입력 중인 입금액 때문에 모자라게 될 때의 안내.
const DEPOSIT_TOO_MUCH_HINT = '입금하려는 금액이 현재 보유 현금보다 많습니다. 입금액을 확인해 주세요.'

function Hint({ text }: { text: string }) {
  return <span style={{ fontSize: 13, color: '#c0392b', fontWeight: 600, whiteSpace: 'pre-line' }}>{text}</span>
}

/**
 * ② 현금을 통장에 입금 — "지금 가진 현금이 얼마인가 / 입금할 수 있는 현금이 얼마인가"에 답하는 박스.
 * pendingDeposit이 있으면(입금액을 입력 중) 이번 입금액과 입금 후 보유 현금도 보여준다.
 * pendingDeposit.replaces는 "수정 중인 입금확인 내역"의 기존 금액 — 이미 위 "통장에 입금한 금액"에 들어 있으므로 되돌려서 계산한다.
 */
export function CashOnHandSummary({ settlement, pendingDeposit }: {
  settlement: RegularSettlement
  pendingDeposit?: { amount: number; replaces: number }
}) {
  const cash = calcCashSummary(settlement)
  const after = pendingDeposit ? cash.cashBalance + pendingDeposit.replaces - pendingDeposit.amount : undefined

  return (
    <div className="info-msg" data-testid="cash-on-hand-summary" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontWeight: 700, fontSize: 16 }}>💵 현재 현금 현황</span>
      <Row label="현금으로 받은 금액" value={fmt(cash.cashIncome)} />
      <Row label="통장에서 인출한 금액" value={fmt(cash.bankWithdrawal)} />
      <Row label="현금으로 지출한 금액" value={fmt(cash.cashExpense)} />
      <Row label="통장에 입금한 금액" value={fmt(cash.confirmedDeposit)} />
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
        <Row label="현재 보유 현금" value={cashText(cash.cashBalance)} strong danger={cash.cashBalance < 0} />
      </div>
      {pendingDeposit && after !== undefined && (
        <>
          <Row label="이번 입금액" value={fmt(pendingDeposit.amount)} />
          <Row label="입금 후 보유 현금" value={cashText(after)} strong danger={after < 0} />
        </>
      )}
      {cash.cashBalance < 0 && <Hint text={SHORTAGE_HINT} />}
      {cash.cashBalance >= 0 && after !== undefined && after < 0 && <Hint text={DEPOSIT_TOO_MUCH_HINT} />}
    </div>
  )
}

/** "현금·통장" 탭 맨 아래 — 지금 통장과 현금에 각각 얼마가 있고 합쳐서 얼마인지. */
export function CurrentFundStatus({ settlement }: { settlement: RegularSettlement }) {
  const h = calcHoldingsSummary(settlement)
  return (
    <div className="info-msg" data-testid="current-fund-status" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontWeight: 700, fontSize: 16 }}>💼 현재 자금 현황</span>
      <Row label="통장잔액" value={fmt(h.bankBalance)} danger={h.bankBalance < 0} />
      <Row label="보유 현금" value={cashText(h.cashBalance)} danger={h.cashBalance < 0} />
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
        <Row label="전체 보유액" value={fmt(h.totalHoldings)} strong />
      </div>
      {h.cashBalance < 0 && <Hint text={SHORTAGE_HINT} />}
      <span className="muted" style={{ fontSize: 12, whiteSpace: 'pre-line', marginTop: 4 }}>
        {'통장과 현금을 합한 현재 전체 보유액입니다.\n현금 인출·입금은 자금의 위치만 바뀌므로 전체 보유액에는 영향을 주지 않습니다.'}
      </span>
    </div>
  )
}
