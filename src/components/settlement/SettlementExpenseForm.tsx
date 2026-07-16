import { useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { EXPENSE_CATEGORIES, DINNER_CATEGORY } from '../../lib/settlementConstants'
import type { ExpensePaymentMethod, SettlementExpense } from '../../types/settlement'
import { todayStr } from '../../lib/date'
import { SettlementSaveButtons } from './SettlementSaveButtons'
import { moneyInputStyle } from './moneyInputStyle'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

type FormState = {
  date: string; label: string; category: string; amount: string
  method: ExpensePaymentMethod; paidBy: string; clubShare: string; personalDonation: string; note: string
}

const emptyForm = (): FormState => ({
  date: todayStr(), label: '', category: EXPENSE_CATEGORIES[0], amount: '',
  method: '현금', paidBy: '', clubShare: '', personalDonation: '', note: '',
})

/** 회식비 카테고리를 고르면 일반 지출 폼을 그대로 제출하지 않고, 회식비 전용 입력으로 넘긴다(이중 입력 방지). */
export function SettlementExpenseForm({ settlementId, onRequestDinnerForm, previewMode = false }: {
  settlementId: string
  onRequestDinnerForm: () => void
  previewMode?: boolean
}) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addExpense = useSettlementStore((s) => s.addExpense)
  const updateExpense = useSettlementStore((s) => s.updateExpense)
  const deleteExpense = useSettlementStore((s) => s.deleteExpense)

  const [form, setForm] = useState<FormState>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!settlement) return null
  const locked = isLocked(settlement.status)

  const set = (field: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [field]: v }))

  const startEdit = (e: SettlementExpense) => {
    setEditingId(e.id)
    setForm({
      date: e.date, label: e.label, category: e.category, amount: String(e.amount),
      method: e.method, paidBy: e.paidBy ?? '', clubShare: String(e.clubShare),
      personalDonation: String(e.personalDonation), note: e.note ?? '',
    })
  }

  const onCategoryChange = (category: string) => {
    if (category === DINNER_CATEGORY) {
      setForm((f) => ({ ...f, category: EXPENSE_CATEGORIES[0] }))
      onRequestDinnerForm()
      return
    }
    set('category')(category)
  }

  const submit = () => {
    setError('')
    if (!form.label.trim()) { setError('항목명을 입력해주세요.'); return }
    const amount = parseAmt(form.amount)
    const clubShare = form.clubShare === '' ? amount : parseAmt(form.clubShare)
    const personalDonation = form.personalDonation === '' ? 0 : parseAmt(form.personalDonation)
    const expense = {
      date: form.date, label: form.label.trim(), category: form.category, amount,
      method: form.method, paidBy: form.paidBy.trim() || undefined,
      clubShare, personalDonation, note: form.note.trim() || undefined,
    }
    const res = editingId ? updateExpense(settlementId, editingId, expense) : addExpense(settlementId, expense)
    if (!res.ok) { setError(res.error); return }
    setForm(emptyForm())
    setEditingId(null)
  }

  return (
    <div className="col-card">
      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>{editingId ? '지출 수정' : '지출 추가'}</span>
          <input type="date" value={form.date} onChange={(e) => set('date')(e.target.value)} />
          <input placeholder="항목명 (예: 당구장 대관료)" value={form.label} onChange={(e) => set('label')(e.target.value)} style={{ fontSize: 16 }} />
          <select value={form.category} onChange={(e) => onCategoryChange(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted">금액</span>
            <input type="number" inputMode="numeric" min={0} value={form.amount} placeholder="0"
              onChange={(e) => set('amount')(e.target.value)} style={moneyInputStyle} />
          </div>
          <select value={form.method} onChange={(e) => set('method')(e.target.value)}>
            <option value="현금">현금</option>
            <option value="체크카드">체크카드</option>
            <option value="계좌이체">계좌이체</option>
            <option value="기타">기타</option>
          </select>
          <input placeholder="실제 결제자 (선택)" value={form.paidBy} onChange={(e) => set('paidBy')(e.target.value)} />
          {/* 모임 부담액·개인 찬조액은 한 줄에 나란히 두면 각 칸이 반쪽 폭이 되어 큰 금액이 좁게
              보인다 — 항상 한 줄에 하나씩, 카드 전체 폭으로 세로 배치한다. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>모임 부담액 (비우면 전액)</span>
            <input type="number" inputMode="numeric" min={0} value={form.clubShare} placeholder={form.amount || '0'}
              onChange={(e) => set('clubShare')(e.target.value)} style={moneyInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>개인 찬조액</span>
            <input type="number" inputMode="numeric" min={0} value={form.personalDonation} placeholder="0"
              onChange={(e) => set('personalDonation')(e.target.value)} style={moneyInputStyle} />
          </div>
          <input placeholder="비고 (선택)" value={form.note} onChange={(e) => set('note')(e.target.value)} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary grow" onClick={submit}>{editingId ? '수정 저장' : '지출 추가'}</button>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>취소</button>
            )}
          </div>
        </div>
      )}

      {settlement.expenses.length === 0 && <p className="muted">등록된 지출이 없습니다.</p>}
      {settlement.expenses.map((e) => (
        <div key={e.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{e.label} <span className="muted" style={{ fontSize: 12 }}>({e.category})</span></div>
            <div className="muted" style={{ fontSize: 13 }}>{e.date} · {e.method} · 모임부담 {fmt(e.clubShare)}원</div>
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => startEdit(e)}>수정</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm(`'${e.label}' 지출을 삭제할까요?`)) deleteExpense(settlementId, e.id) }}>삭제</button>
            </div>
          )}
        </div>
      ))}

      <SettlementSaveButtons settlementId={settlementId} previewMode={previewMode} locked={locked} />
    </div>
  )
}
