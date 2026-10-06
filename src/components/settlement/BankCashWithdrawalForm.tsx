import { useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { calcHoldingsSummary, withdrawalsOf } from '../../logic/settlement'
import { todayStr } from '../../lib/date'
import { moneyInputStyle } from './moneyInputStyle'
import { MoneyInput } from '../MoneyInput'

// "통장에서 현금 인출"(통장 → 현금) 입력·목록. 수입도 지출도 아니라서 총수입·총지출은 바뀌지 않고,
// 통장잔액은 줄고 현금잔액은 는다(전체 보유액은 그대로).
// 반대 방향인 "현금을 통장에 입금"은 이 화면 아래의 기존 현금 통장 입금(CashDepositForm) 하나만 쓴다 —
// 같은 거래를 두 군데에서 입력해 이중 반영되지 않도록 여기에는 입금 입력을 두지 않는다.
// 저장 버튼은 같은 탭 아래쪽(CashDepositForm)의 임시저장/최종 게시 버튼을 함께 쓴다.

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

const bigButton = { minHeight: 52, fontSize: 17, fontWeight: 600 } as const
const labelStyle = { fontSize: 13, fontWeight: 600 } as const
const fieldStyle ={ width: '100%', boxSizing: 'border-box', minHeight: 48, fontSize: 16 } as const

export function BankCashWithdrawalForm({ settlementId }: { settlementId: string }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addWithdrawal = useSettlementStore((s) => s.addBankCashWithdrawal)
  const deleteWithdrawal = useSettlementStore((s) => s.deleteBankCashWithdrawal)

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayStr())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  if (!settlement) return null
  const locked = isLocked(settlement.status)
  const holdings = calcHoldingsSummary(settlement)
  const withdrawals = [...withdrawalsOf(settlement)].sort((a, b) => a.date.localeCompare(b.date))

  const submit = () => {
    setError('')
    const res = addWithdrawal(settlementId, { amount: parseAmt(amount), date, note: note.trim() || undefined })
    if (!res.ok) { setError(res.error); return }
    setAmount('')
    setNote('')
    setDate(todayStr())
  }

  const remove = (id: string, amountWon: number) => {
    if (window.confirm(`통장에서 현금 인출 ${fmt(amountWon)}원을 삭제할까요?`)) {
      const res = deleteWithdrawal(settlementId, id)
      if (!res.ok) setError(res.error)
    }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 16 }}>① 통장에서 현금 인출</span>
      <p className="muted" style={{ fontSize: 13 }}>
        통장에서 현금을 찾아왔을 때 기록하세요. 수입·지출이 아니므로 총수입·총지출은 변하지 않습니다.
        (현금을 통장에 넣는 것은 아래 ②번에서 입력합니다.)
      </p>

      <div className="info-msg" style={{ fontSize: 15, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>통장잔액 {fmt(holdings.bankBalance)}원</span>
        <span>현금잔액 {fmt(holdings.cashBalance)}원</span>
        <span style={{ fontWeight: 700 }}>전체 보유액 {fmt(holdings.totalHoldings)}원</span>
      </div>
      {holdings.cashBalance < 0 && (
        <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b', fontWeight: 600 }}>
          ⚠ 현금잔액이 마이너스입니다. 현금 지출·현금 통장 입금을 다시 확인해주세요.
        </p>
      )}
      {holdings.bankBalance < 0 && (
        <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b', fontWeight: 600 }}>
          ⚠ 통장잔액이 마이너스입니다. 전월 통장 잔액과 인출 금액을 다시 확인해주세요.
        </p>
      )}

      {!locked && (
        <div className="col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>현금 인출 추가</span>
          <span className="muted" style={labelStyle}>출금일 (통장에서 현금을 찾은 날)</span>
          <input type="date" aria-label="출금일" value={date} onChange={(e) => setDate(e.target.value)} style={fieldStyle} />
          <span className="muted" style={labelStyle}>금액</span>
          <MoneyInput ariaLabel="현금 인출 금액" value={amount} placeholder="인출한 금액" onChange={setAmount} style={moneyInputStyle} />
          <span className="muted" style={labelStyle}>메모</span>
          <input aria-label="현금 인출 메모" placeholder="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} style={fieldStyle} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <button type="button" className="primary block" onClick={submit} style={bigButton}>현금 인출 저장</button>
          <p className="muted" style={{ fontSize: 12 }}>※ 아래 "임시저장"을 눌러야 서버에 저장됩니다.</p>
        </div>
      )}

      {locked && error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
      {withdrawals.length === 0 && <p className="muted">등록된 현금 인출이 없습니다.</p>}
      {withdrawals.map((w) => (
        <div key={w.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>통장에서 현금 인출</div>
            <div style={{ fontWeight: 600 }}>{fmt(w.amount)}원</div>
            <div className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>출금일 {w.date}{w.note ? ` · ${w.note}` : ''}</div>
          </div>
          {!locked && (
            <button
              type="button" className="danger" onClick={() => remove(w.id, w.amount)}
              style={{ minHeight: 48, minWidth: 64, flexShrink: 0 }}
            >
              삭제
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
