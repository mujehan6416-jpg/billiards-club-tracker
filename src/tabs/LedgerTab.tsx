import { useEffect, useState } from 'react'
import { useApp } from '../store/appStore'
import { useAdmin } from '../store/adminStore'
import { todayStr } from '../lib/date'
import { uploadToCloud } from '../lib/cloudSync'
import type { LedgerRecord } from '../types'
import { MoneyInput } from '../components/MoneyInput'

const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))
const fmt = (n: number) => n.toLocaleString('ko-KR')

type FormFields = {
  note: string
  inCashMembership: string
  inCashDonation: string
  inTransferMembership: string
  inTransferDonation: string
  inCardDonation: string
  inAnnualFee: string
  outCash: string
  outCard: string
  outTransfer: string
}

const emptyForm = (): FormFields => ({
  note: '', inCashMembership: '', inCashDonation: '',
  inTransferMembership: '', inTransferDonation: '',
  inCardDonation: '', inAnnualFee: '',
  outCash: '', outCard: '', outTransfer: '',
})

function recordToForm(r: LedgerRecord): FormFields {
  const s = (n: number) => n ? String(n) : ''
  return {
    note: r.note ?? '',
    inCashMembership: s(r.inCashMembership),
    inCashDonation: s(r.inCashDonation),
    inTransferMembership: s(r.inTransferMembership),
    inTransferDonation: s(r.inTransferDonation),
    inCardDonation: s(r.inCardDonation),
    inAnnualFee: s(r.inAnnualFee),
    outCash: s(r.outCash),
    outCard: s(r.outCard),
    outTransfer: s(r.outTransfer),
  }
}

export function LedgerTab() {
  const { isAdmin } = useAdmin()
  if (!isAdmin) {
    return (
      <div className="tab">
        <h2 className="tab-title">📒 장부</h2>
        <div className="card"><span className="muted">관리자만 접근할 수 있습니다.</span></div>
      </div>
    )
  }
  return <LedgerContent />
}

function AmtInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 80 }}>
      <span style={{ fontSize: 11, color: '#888' }}>{label}</span>
      <MoneyInput ariaLabel={label} value={value} onChange={onChange} style={{ width: '100%' }} />
    </div>
  )
}

function TotalRow({ label, amount, highlight, color }: {
  label: string; amount: number; highlight?: boolean; color?: string
}) {
  const c = color ?? (highlight ? '#072B61' : '#555')
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: '#666' }}>{label}</span>
      <span style={{ fontWeight: highlight ? 700 : 600, fontSize: highlight ? 15 : 13, color: c }}>
        {fmt(amount)}원
      </span>
    </div>
  )
}

function LedgerContent() {
  const ledger = useApp((s) => s.ledger)
  const upsertLedger = useApp((s) => s.upsertLedger)
  const deleteLedger = useApp((s) => s.deleteLedger)

  const [date, setDate] = useState(todayStr())
  const [form, setForm] = useState<FormFields>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const existing = ledger.find((r) => r.date === date)
    if (existing) {
      setForm(recordToForm(existing))
      setEditingId(existing.id)
    } else {
      setForm(emptyForm())
      setEditingId(null)
    }
    setMsg('')
  }, [date])

  const set = (field: keyof FormFields) => (v: string) =>
    setForm((prev) => ({ ...prev, [field]: v }))

  const n = (field: keyof Omit<FormFields, 'note'>) => parseAmt(form[field])

  // 합계 계산
  const membershipTotal = n('inCashMembership') + n('inTransferMembership') // 연회비 제외
  const donationTotal = n('inCashDonation') + n('inTransferDonation') + n('inCardDonation')
  const incomeTotal = membershipTotal + n('inAnnualFee') + n('inCashDonation') + n('inTransferDonation') // 카드찬조 제외
  const expenseTotal = n('outCash') + n('outCard') + n('outTransfer')

  const doSave = async () => {
    setSaving(true)
    setMsg('')
    upsertLedger({
      id: editingId ?? undefined,
      date,
      note: form.note || undefined,
      inCashMembership: n('inCashMembership'),
      inCashDonation: n('inCashDonation'),
      inTransferMembership: n('inTransferMembership'),
      inTransferDonation: n('inTransferDonation'),
      inCardDonation: n('inCardDonation'),
      inAnnualFee: n('inAnnualFee'),
      outCash: n('outCash'),
      outCard: n('outCard'),
      outTransfer: n('outTransfer'),
    })
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
      setMsg('저장 완료')
    } catch {
      setMsg('로컬 저장 완료 (클라우드 저장 실패)')
    }
    setSaving(false)
  }

  const doDelete = async () => {
    if (!editingId) return
    if (!window.confirm(`${date} 장부 기록을 삭제할까요?`)) return
    deleteLedger(editingId)
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
    } catch { /* ignore */ }
    setForm(emptyForm())
    setEditingId(null)
    setMsg('삭제됨')
  }

  // 전체 누계
  const allMembership = ledger.reduce((s, r) => s + r.inCashMembership + r.inTransferMembership, 0) // 연회비 제외
  const allAnnualFee = ledger.reduce((s, r) => s + r.inAnnualFee, 0)
  const allDonation = ledger.reduce((s, r) => s + r.inCashDonation + r.inTransferDonation + r.inCardDonation, 0)
  const allIncome = ledger.reduce((s, r) => s + r.inCashMembership + r.inTransferMembership + r.inAnnualFee + r.inCashDonation + r.inTransferDonation, 0)
  const allExpense = ledger.reduce((s, r) => s + r.outCash + r.outCard + r.outTransfer, 0)

  const sorted = [...ledger].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="tab">
      <h2 className="tab-title">📒 장부</h2>

      {/* 날짜 + 메모 */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>📅 날짜</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1 }} />
          {editingId && (
            <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: '#e1f5ee', color: '#0f6e56', fontWeight: 600 }}>
              수정 중
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>📝 메모</span>
          <input
            type="text" placeholder="예: 26차 정기모임" value={form.note}
            onChange={(e) => set('note')(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      {/* 수입 */}
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14, color: '#0f6e56' }}>💰 수입</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#888' }}>현금</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <AmtInput label="회비" value={form.inCashMembership} onChange={set('inCashMembership')} />
            <AmtInput label="찬조금" value={form.inCashDonation} onChange={set('inCashDonation')} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#888' }}>계좌이체</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <AmtInput label="회비" value={form.inTransferMembership} onChange={set('inTransferMembership')} />
            <AmtInput label="찬조금" value={form.inTransferDonation} onChange={set('inTransferDonation')} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <AmtInput label="카드 찬조" value={form.inCardDonation} onChange={set('inCardDonation')} />
          <AmtInput label="이달 연회비" value={form.inAnnualFee} onChange={set('inAnnualFee')} />
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
          <TotalRow label="회비 합계 (현금+계좌이체)" amount={membershipTotal} />
          <TotalRow label="연회비" amount={n('inAnnualFee')} />
          <TotalRow label="찬조금 합계 (카드찬조 포함)" amount={donationTotal} />
          <TotalRow label="수입 합계 (카드찬조 제외)" amount={incomeTotal} highlight color="#0f6e56" />
        </div>
      </div>

      {/* 지출 */}
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14, color: '#c0392b' }}>💸 지출</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <AmtInput label="현금" value={form.outCash} onChange={set('outCash')} />
          <AmtInput label="체크카드" value={form.outCard} onChange={set('outCard')} />
          <AmtInput label="계좌이체" value={form.outTransfer} onChange={set('outTransfer')} />
        </div>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
          <TotalRow label="지출 합계" amount={expenseTotal} highlight color="#c0392b" />
        </div>
      </div>

      {/* 저장/삭제 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary block" style={{ flex: 1 }} disabled={saving} onClick={doSave}>
          {saving ? '저장 중...' : editingId ? '수정 저장' : '저장'}
        </button>
        {editingId && (
          <button style={{ color: '#c0392b', borderColor: '#e0a0a0' }} onClick={doDelete}>삭제</button>
        )}
      </div>
      {msg && <p className="info-msg">{msg}</p>}

      {/* 전체 누계 */}
      {ledger.length > 0 && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>📊 전체 누계</span>
          <TotalRow label="회비 누계 (현금+계좌이체)" amount={allMembership} />
          <TotalRow label="연회비 누계" amount={allAnnualFee} />
          <TotalRow label="찬조금 누계 (카드찬조 포함)" amount={allDonation} />
          <TotalRow label="수입 누계 (카드찬조 제외)" amount={allIncome} />
          <TotalRow label="지출 누계" amount={allExpense} />
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <TotalRow
              label="잔액 (수입 - 지출)"
              amount={allIncome - allExpense}
              highlight
              color={allIncome - allExpense >= 0 ? '#072B61' : '#c0392b'}
            />
          </div>
        </div>
      )}

      {/* 장부 이력 */}
      {sorted.length > 0 && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>📋 장부 이력</span>
          {sorted.map((r) => {
            const rIncome = r.inCashMembership + r.inTransferMembership + r.inAnnualFee + r.inCashDonation + r.inTransferDonation
            const rExpense = r.outCash + r.outCard + r.outTransfer
            const balance = rIncome - rExpense
            return (
              <div
                key={r.id}
                style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4, cursor: 'pointer' }}
                onClick={() => setDate(r.date)}
              >
                <div style={{ fontWeight: 600, fontSize: 13, color: r.date === date ? '#072B61' : 'inherit' }}>
                  {r.date}{r.note ? ` (${r.note})` : ''}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 3, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
                  <span>수입 <b style={{ color: '#0f6e56' }}>{fmt(rIncome)}원</b></span>
                  <span>지출 <b style={{ color: '#c0392b' }}>{fmt(rExpense)}원</b></span>
                  <span>잔액 <b style={{ color: balance >= 0 ? '#072B61' : '#c0392b' }}>{fmt(balance)}원</b></span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
