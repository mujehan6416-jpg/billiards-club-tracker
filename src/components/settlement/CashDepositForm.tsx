import { useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { CashOnHandSummary } from './CashOnHandSummary'
import { todayStr } from '../../lib/date'
import type { CashDeposit, CashDepositStatus } from '../../types/settlement'
import { SettlementSaveButtons } from './SettlementSaveButtons'
import { moneyInputStyle } from './moneyInputStyle'
import { MoneyInput } from '../MoneyInput'

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

  // 입금액을 입력 중이면(입금확인 상태일 때만 현금이 실제로 줄어든다) "이번 입금액 / 입금 후 보유 현금"도 보여준다.
  // 수정 중인 입금확인 내역은 이미 "통장에 입금한 금액"에 들어 있으므로 그 금액을 되돌려서 계산한다.
  const typedAmount = parseAmt(form.amount)
  const editedDeposit = editingId ? settlement.cashDeposits.find((d) => d.id === editingId) : undefined
  const pendingDeposit =
    !locked && form.status === '입금확인' && typedAmount > 0
      ? { amount: typedAmount, replaces: editedDeposit?.status === '입금확인' ? editedDeposit.amount : 0 }
      : undefined

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
      <span style={{ fontWeight: 700, fontSize: 16, padding: '0 4px' }}>② 현금을 통장에 입금</span>
      <p className="muted" style={{ fontSize: 13, whiteSpace: 'pre-line', padding: '0 4px' }}>
        {'현재 보유하고 있는 현금 중 통장에 입금한 금액을 기록해 주세요.\n입금한 금액만큼 보유 현금은 줄고 통장 잔액은 늘어납니다.'}
      </p>
      <CashOnHandSummary settlement={settlement} pendingDeposit={pendingDeposit} />

      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>{editingId ? '현금 통장 입금 수정' : '현금 통장 입금 추가'}</span>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>입금일</span>
          <input type="date" aria-label="입금일" value={form.depositDate} onChange={(e) => set('depositDate')(e.target.value)} />
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>입금 금액</span>
          <MoneyInput value={form.amount} placeholder="입금액" onChange={set('amount')} style={moneyInputStyle} />
          <select value={form.status} onChange={(e) => set('status')(e.target.value)}>
            <option value="입금전">입금전</option>
            <option value="입금예정">입금예정</option>
            <option value="입금확인">입금확인</option>
            <option value="취소">취소</option>
          </select>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>메모</span>
          <input placeholder="메모 (선택)" value={form.note} onChange={(e) => set('note')(e.target.value)} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary grow" onClick={submit}>{editingId ? '수정 저장' : '통장 입금 저장'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>취소</button>}
          </div>
        </div>
      )}

      {settlement.cashDeposits.length === 0 && <p className="muted">등록된 현금 통장 입금이 없습니다.</p>}
      {settlement.cashDeposits.map((d) => (
        <div key={d.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>현금을 통장에 입금</div>
            <div style={{ fontWeight: 600 }}>{fmt(d.amount)}원 <span className="muted" style={{ fontSize: 12 }}>({d.status})</span></div>
            <div className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>입금일 {d.depositDate}{d.note ? ` · ${d.note}` : ''}</div>
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {/* 좁은 화면에서 "수 / 정"처럼 글자가 세로로 쪼개지지 않도록 줄바꿈을 막고 터치 높이를 확보한다 */}
              <button type="button" onClick={() => startEdit(d)} style={{ whiteSpace: 'nowrap', minHeight: 44 }}>수정</button>
              <button type="button" className="danger" style={{ whiteSpace: 'nowrap', minHeight: 44 }} onClick={() => { if (window.confirm('이 입금 내역을 삭제할까요?')) deleteCashDeposit(settlementId, d.id) }}>삭제</button>
            </div>
          )}
        </div>
      ))}

      <SettlementSaveButtons settlementId={settlementId} previewMode={previewMode} locked={locked} />
    </div>
  )
}
