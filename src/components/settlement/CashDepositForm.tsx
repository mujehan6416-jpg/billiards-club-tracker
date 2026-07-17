import { useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { calcCashSummary } from '../../logic/settlement'
import { todayStr } from '../../lib/date'
import type { CashDeposit, CashDepositStatus } from '../../types/settlement'
import { SettlementSaveButtons } from './SettlementSaveButtons'
import { moneyInputStyle } from './moneyInputStyle'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

type FormState = { depositDate: string; amount: string; status: CashDepositStatus; note: string }
const emptyForm = (): FormState => ({ depositDate: todayStr(), amount: '', status: '입금확인', note: '' })

export function CashDepositForm({ settlementId, previewMode = false }: { settlementId: string; previewMode?: boolean }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addCashDeposit = useSettlementStore((s) => s.addCashDeposit)
  const updateCashDeposit = useSettlementStore((s) => s.updateCashDeposit)
  const deleteCashDeposit = useSettlementStore((s) => s.deleteCashDeposit)

  const [form, setForm] = useState<FormState>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!settlement) return null
  const locked = isLocked(settlement.status)
  const cash = calcCashSummary(settlement)

  const set = (field: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [field]: v }))

  const startEdit = (d: CashDeposit) => {
    setEditingId(d.id)
    setForm({ depositDate: d.depositDate, amount: String(d.amount), status: d.status, note: d.note ?? '' })
  }

  const submit = () => {
    setError('')
    const payload = { depositDate: form.depositDate, amount: parseAmt(form.amount), status: form.status, note: form.note.trim() || undefined }
    const res = editingId ? updateCashDeposit(settlementId, editingId, payload) : addCashDeposit(settlementId, payload)
    if (!res.ok) { setError(res.error); return }
    setForm(emptyForm())
    setEditingId(null)
  }

  return (
    <div className="col-card">
      <div className="info-msg">
        입금 전 현금 잔액 {fmt(cash.cashBalanceBeforeDeposit)}원 (수입 {fmt(cash.cashIncome)}원 − 지출 {fmt(cash.cashExpense)}원)
        · 입금 확인 합계 {fmt(cash.confirmedDeposit)}원 · 입금 후 현금 잔액 {fmt(cash.cashBalanceAfterDeposit)}원
      </div>

      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>{editingId ? '현금 통장 입금 수정' : '현금 통장 입금 추가'}</span>
          <input type="date" value={form.depositDate} onChange={(e) => set('depositDate')(e.target.value)} />
          <input type="number" inputMode="numeric" min={0} value={form.amount} placeholder="입금액" onChange={(e) => set('amount')(e.target.value)} style={moneyInputStyle} />
          <select value={form.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="입금전">입금전</option>
            <option value="입금예정">입금예정</option>
            <option value="입금확인">입금확인</option>
            <option value="취소">취소</option>
          </select>
          <input placeholder="비고 (선택)" value={form.note} onChange={(e) => set('note')(e.target.value)} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary grow" onClick={submit}>{editingId ? '수정 저장' : '입금 추가'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>취소</button>}
          </div>
        </div>
      )}

      {settlement.cashDeposits.length === 0 && <p className="muted">등록된 현금 통장 입금이 없습니다.</p>}
      {settlement.cashDeposits.map((d) => (
        <div key={d.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{fmt(d.amount)}원 <span className="muted" style={{ fontSize: 12 }}>({d.status})</span></div>
            <div className="muted" style={{ fontSize: 13 }}>{d.depositDate}{d.note ? ` · ${d.note}` : ''}</div>
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => startEdit(d)}>수정</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm('이 입금 내역을 삭제할까요?')) deleteCashDeposit(settlementId, d.id) }}>삭제</button>
            </div>
          )}
        </div>
      ))}

      <SettlementSaveButtons settlementId={settlementId} previewMode={previewMode} locked={locked} />
    </div>
  )
}
