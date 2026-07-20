import { useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { DINNER_CONTRIBUTOR_TITLE_PRESETS } from '../../lib/settlementConstants'
import type { DinnerContribution, DinnerContributionType, DinnerContributor, ExpensePaymentMethod } from '../../types/settlement'
import { SettlementSaveButtons } from './SettlementSaveButtons'
import { moneyInputStyle, compactMoneyInputStyle } from './moneyInputStyle'
import { MoneyInput } from '../MoneyInput'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

type ContributorDraft = { name: string; amount: string; title: string; customTitle: string }
const emptyContributor = (): ContributorDraft => ({ name: '', amount: '', title: DINNER_CONTRIBUTOR_TITLE_PRESETS[0], customTitle: '' })

type FormState = {
  dinnerRound: string; totalAmount: string; method: ExpensePaymentMethod; paidBy: string
  contributionType: DinnerContributionType; contributors: ContributorDraft[]; note: string
}
const emptyForm = (): FormState => ({
  dinnerRound: '', totalAmount: '', method: '현금', paidBy: '',
  contributionType: '모임회계지출', contributors: [], note: '',
})

function resolveTitle(c: ContributorDraft): string {
  return c.title === '직접 입력' ? (c.customTitle.trim() || '회원님') : c.title
}

export function DinnerContributionForm({ settlementId, previewMode = false }: { settlementId: string; previewMode?: boolean }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addDinnerContribution = useSettlementStore((s) => s.addDinnerContribution)
  const updateDinnerContribution = useSettlementStore((s) => s.updateDinnerContribution)
  const deleteDinnerContribution = useSettlementStore((s) => s.deleteDinnerContribution)

  const [form, setForm] = useState<FormState>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!settlement) return null
  const locked = isLocked(settlement.status)

  const set = <K extends keyof FormState>(field: K) => (v: FormState[K]) => setForm((f) => ({ ...f, [field]: v }))

  const contributorSum = form.contributors.reduce((s, c) => s + parseAmt(c.amount), 0)
  const totalAmount = parseAmt(form.totalAmount)
  const clubShare =
    form.contributionType === '모임회계지출' ? totalAmount :
    form.contributionType === '전액찬조' ? 0 :
    Math.max(0, totalAmount - contributorSum)

  const startEdit = (d: DinnerContribution) => {
    setEditingId(d.id)
    setForm({
      dinnerRound: String(d.dinnerRound), totalAmount: String(d.totalAmount), method: d.method, paidBy: d.paidBy ?? '',
      contributionType: d.contributionType,
      contributors: d.contributors.map((c) => ({ name: c.name, amount: String(c.amount), title: c.title && !DINNER_CONTRIBUTOR_TITLE_PRESETS.includes(c.title as never) ? '직접 입력' : (c.title ?? DINNER_CONTRIBUTOR_TITLE_PRESETS[0]), customTitle: c.title ?? '' })),
      note: d.note ?? '',
    })
  }

  const addContributorRow = () => setForm((f) => ({ ...f, contributors: [...f.contributors, emptyContributor()] }))
  const removeContributorRow = (idx: number) => setForm((f) => ({ ...f, contributors: f.contributors.filter((_, i) => i !== idx) }))
  const updateContributorRow = (idx: number, patch: Partial<ContributorDraft>) =>
    setForm((f) => ({ ...f, contributors: f.contributors.map((c, i) => (i === idx ? { ...c, ...patch } : c)) }))

  const submit = () => {
    setError('')
    const round = parseAmt(form.dinnerRound)
    if (round <= 0) { setError('회식 차수를 입력해주세요.'); return }
    const contributors: DinnerContributor[] = form.contributors
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), memberId: null, amount: parseAmt(c.amount), title: resolveTitle(c) }))

    const payload: Omit<DinnerContribution, 'id'> = {
      dinnerRound: round, totalAmount, method: form.method, paidBy: form.paidBy.trim() || undefined,
      clubShare, contributionType: form.contributionType, contributors, note: form.note.trim() || undefined,
    }
    const res = editingId ? updateDinnerContribution(settlementId, editingId, payload) : addDinnerContribution(settlementId, payload)
    if (!res.ok) { setError(res.error); return }
    setForm(emptyForm())
    setEditingId(null)
  }

  return (
    <div className="col-card">
      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>{editingId ? '회식비 수정' : '회식비 추가'} (차수별 전용 입력)</span>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>회식 차수</span>
              <input type="number" inputMode="numeric" min={1} value={form.dinnerRound} placeholder="1" onChange={(e) => set('dinnerRound')(e.target.value)} />
            </div>
            <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="muted" style={{ fontSize: 12 }}>전체 회식비</span>
              <MoneyInput ariaLabel="전체 회식비" value={form.totalAmount} placeholder="0" onChange={set('totalAmount')} style={{ ...moneyInputStyle, fontSize: 18 }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <select value={form.method} onChange={(e) => set('method')(e.target.value as ExpensePaymentMethod)} style={{ flex: 1, minWidth: 0 }}>
              <option value="현금">현금</option>
              <option value="체크카드">체크카드</option>
              <option value="계좌이체">계좌이체</option>
              <option value="기타">기타</option>
            </select>
            <input placeholder="실제 결제자 (선택)" value={form.paidBy} onChange={(e) => set('paidBy')(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          </div>

          <select value={form.contributionType} onChange={(e) => set('contributionType')(e.target.value as DinnerContributionType)}>
            <option value="모임회계지출">모임 회계 지출 (찬조자 없음)</option>
            <option value="일부찬조">일부 찬조</option>
            <option value="전액찬조">전액 찬조</option>
          </select>

          {form.contributionType !== '모임회계지출' && (
            <div className="col-card">
              <span className="muted" style={{ fontSize: 12 }}>찬조자 목록</span>
              {form.contributors.map((c, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input placeholder="이름" value={c.name} onChange={(e) => updateContributorRow(idx, { name: e.target.value })} style={{ flex: 1, minWidth: 80 }} />
                  <MoneyInput value={c.amount} placeholder="금액"
                    onChange={(v) => updateContributorRow(idx, { amount: v })} style={{ ...compactMoneyInputStyle, width: 110 }} />
                  <select value={c.title} onChange={(e) => updateContributorRow(idx, { title: e.target.value })} style={{ minWidth: 90 }}>
                    {DINNER_CONTRIBUTOR_TITLE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                    <option value="직접 입력">직접 입력</option>
                  </select>
                  {c.title === '직접 입력' && (
                    <input placeholder="호칭 직접 입력" value={c.customTitle} onChange={(e) => updateContributorRow(idx, { customTitle: e.target.value })} style={{ width: 100 }} />
                  )}
                  <button type="button" className="danger" onClick={() => removeContributorRow(idx)}>삭제</button>
                </div>
              ))}
              <button type="button" onClick={addContributorRow}>+ 찬조자 추가</button>
            </div>
          )}

          <div className="info-msg">
            전체 회식비 {fmt(totalAmount)}원 = 모임 회계 부담액 {fmt(clubShare)}원 + 찬조자 합계 {fmt(contributorSum)}원
          </div>

          <input placeholder="비고 (선택)" value={form.note} onChange={(e) => set('note')(e.target.value)} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary grow" onClick={submit}>{editingId ? '수정 저장' : '회식비 추가'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm()) }}>취소</button>}
          </div>
        </div>
      )}

      {settlement.dinnerContributions.length === 0 && <p className="muted">등록된 회식비가 없습니다.</p>}
      {[...settlement.dinnerContributions].sort((a, b) => a.dinnerRound - b.dinnerRound).map((d) => (
        <div key={d.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{d.dinnerRound}차 회식비 — {fmt(d.totalAmount)}원 ({d.contributionType})</div>
            <div className="muted" style={{ fontSize: 13 }}>모임부담 {fmt(d.clubShare)}원 · {d.method}{d.contributors.length > 0 ? ` · 찬조자 ${d.contributors.length}명` : ''}</div>
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => startEdit(d)}>수정</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm(`${d.dinnerRound}차 회식비를 삭제할까요?`)) deleteDinnerContribution(settlementId, d.id) }}>삭제</button>
            </div>
          )}
        </div>
      ))}

      <SettlementSaveButtons settlementId={settlementId} previewMode={previewMode} locked={locked} />
    </div>
  )
}
