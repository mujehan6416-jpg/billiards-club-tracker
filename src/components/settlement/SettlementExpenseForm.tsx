import { useEffect, useState } from 'react'
import { useSettlementStore, isLocked } from '../../store/settlementStore'
import { EXPENSE_CATEGORIES, displayExpenseCategory } from '../../lib/settlementConstants'
import { calcDefaultExpenseClubShare, prefillExpenseClubShare, validateExpenseShares } from '../../logic/settlement'
import type { ExpensePaymentMethod, SettlementExpense } from '../../types/settlement'
import { SettlementSaveButtons } from './SettlementSaveButtons'
import { moneyInputStyle } from './moneyInputStyle'
import { MoneyInput } from '../MoneyInput'

const fmt = (n: number) => n.toLocaleString('ko-KR')
const parseAmt = (v: string) => Math.max(0, parseInt(v.replace(/[^0-9]/g, '') || '0', 10))

type FormState = {
  date: string; label: string; category: string; amount: string
  method: ExpensePaymentMethod; paidBy: string; clubShare: string; personalDonation: string; note: string
}

// 새 지출 입력 폼의 기본 날짜는 브라우저의 "오늘"이 아니라 선택된 정산(모임)의 날짜다 — 모임이
// 끝난 다음 날 정산을 입력하는 경우가 많아, 오늘 날짜가 기본값이면 실제 지출일과 다른 날짜가
// 매번 잘못 채워졌었다.
const emptyForm = (date: string): FormState => ({
  date, label: '', category: EXPENSE_CATEGORIES[0], amount: '',
  method: '현금', paidBy: '', clubShare: '', personalDonation: '', note: '',
})

// 회식비 전용 탭(DinnerContributionForm)은 제거되었다 — 회식비도 지출 분류(EXPENSE_CATEGORIES)
// 중 하나이므로 이 폼에서 다른 분류와 똑같이 등록한다. 이전에는 '회식비' 선택 시 별도 폼으로
// 넘겼지만(onRequestDinnerForm), 이제는 그럴 필요가 없다 — 다만 과거에 그 별도 폼(dinnerContributions)
// 으로 저장된 데이터는 지우거나 옮기지 않는다(집계 함수가 두 출처를 합산 — logic/settlement.ts 참고).
//
// [버그 수정] 회식비 탭 제거 직후에는 dinnerContributions(레거시 회식비)를 볼 수 있는 화면이
// 전혀 없었다 — 그 결과 관리자가 "회식비가 없어졌다"고 착각해 지출 탭에 같은 회식비를 새로
// 또 등록하면서(expenses에 신규 항목 생성), 레거시 원본은 그대로 남아 총지출·회식비 합계가
// 두 배로 집계되는 사고가 실제로 발생했다. addExpense는 오직 이 폼의 submit()에서만 호출되므로
// (grep으로 확인) 코드가 자동으로 복사하는 경로는 없다 — 전부 사람이 직접 중복 입력한 것이다.
// 근본 해결은 "복사됐을 만한 항목을 추측해서 지우는 것"이 아니라(금액이 같아도 실제로는 서로
// 다른 회식비일 수 있음), 레거시 회식비를 여기서 다시 볼 수 있게 하는 것이다 — 그래야 관리자가
// 새로 등록하기 전에 이미 있다는 걸 알 수 있고, 이미 중복 입력된 경우에도 둘 중 무엇을 지울지
// 직접 판단해서 삭제할 수 있다. 수정(금액 등 변경)까지는 다시 만들지 않고 조회+삭제만 제공한다
// (여러 찬조자 입력 등 원래 폼의 복잡한 편집 UI를 되살리는 것은 이번 수정 범위 밖).
export function SettlementExpenseForm({ settlementId, previewMode = false }: {
  settlementId: string
  previewMode?: boolean
}) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const addExpense = useSettlementStore((s) => s.addExpense)
  const updateExpense = useSettlementStore((s) => s.updateExpense)
  const deleteExpense = useSettlementStore((s) => s.deleteExpense)
  const deleteDinnerContribution = useSettlementStore((s) => s.deleteDinnerContribution)

  const [form, setForm] = useState<FormState>(() => emptyForm(settlement?.meetingDate ?? ''))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // 다른 정산을 선택해도 이 컴포넌트는 다시 마운트되지 않으므로(같은 "지출" 탭 안에서 settlementId
  // prop만 바뀜), 새 지출을 입력 중이 아닐 때(=수정 중이 아닐 때)만 날짜를 새 정산의 날짜로 맞춘다.
  useEffect(() => {
    if (!editingId && settlement) setForm((f) => ({ ...f, date: settlement.meetingDate }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settlementId])

  if (!settlement) return null
  const locked = isLocked(settlement.status)

  const set = (field: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [field]: v }))

  const startEdit = (e: SettlementExpense) => {
    setEditingId(e.id)
    setForm({
      date: e.date, label: e.label, category: displayExpenseCategory(e.category), amount: String(e.amount),
      method: e.method, paidBy: e.paidBy ?? '',
      clubShare: prefillExpenseClubShare(e.amount, e.clubShare, e.personalDonation),
      personalDonation: String(e.personalDonation), note: e.note ?? '',
    })
  }

  const submit = () => {
    setError('')
    if (!form.label.trim()) { setError('항목명을 입력해주세요.'); return }
    const amount = parseAmt(form.amount)
    const personalDonation = form.personalDonation === '' ? 0 : parseAmt(form.personalDonation)
    const clubShare = form.clubShare === '' ? calcDefaultExpenseClubShare(amount, personalDonation) : parseAmt(form.clubShare)
    const check = validateExpenseShares(amount, clubShare, personalDonation)
    if (!check.ok) { setError(check.error); return }
    const expense = {
      date: form.date, label: form.label.trim(), category: form.category, amount,
      method: form.method, paidBy: form.paidBy.trim() || undefined,
      clubShare, personalDonation, note: form.note.trim() || undefined,
    }
    const res = editingId ? updateExpense(settlementId, editingId, expense) : addExpense(settlementId, expense)
    if (!res.ok) { setError(res.error); return }
    setForm(emptyForm(settlement.meetingDate))
    setEditingId(null)
  }

  return (
    <div className="col-card">
      {!locked && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>{editingId ? '지출 수정' : '지출 추가'}</span>
          <input type="date" value={form.date} onChange={(e) => set('date')(e.target.value)} />
          <input placeholder="항목명 (예: 당구장 대관료)" value={form.label} onChange={(e) => set('label')(e.target.value)} style={{ fontSize: 16 }} />
          <select value={form.category} onChange={(e) => set('category')(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted">금액</span>
            <MoneyInput ariaLabel="금액" value={form.amount} placeholder="0" onChange={set('amount')} style={moneyInputStyle} />
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
            <MoneyInput ariaLabel="모임 부담액" value={form.clubShare} placeholder={form.amount || '0'} onChange={set('clubShare')} style={moneyInputStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>개인 찬조액</span>
            <MoneyInput ariaLabel="개인 찬조액" value={form.personalDonation} placeholder="0" onChange={set('personalDonation')} style={moneyInputStyle} />
          </div>
          <input placeholder="비고 (선택)" value={form.note} onChange={(e) => set('note')(e.target.value)} />
          {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary grow" onClick={submit}>{editingId ? '수정 저장' : '지출 추가'}</button>
            {editingId && (
              <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm(settlement.meetingDate)) }}>취소</button>
            )}
          </div>
        </div>
      )}

      {settlement.expenses.length === 0 && <p className="muted">등록된 지출이 없습니다.</p>}
      {settlement.expenses.map((e) => (
        <div key={e.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{e.label} <span className="muted" style={{ fontSize: 12 }}>({displayExpenseCategory(e.category)})</span></div>
            <div className="muted" style={{ fontSize: 13 }}>
              {e.date} · {e.method} · 총액 {fmt(e.amount)}원 · 모임부담 {fmt(e.clubShare)}원
              {e.personalDonation > 0 && ` · 개인찬조 ${fmt(e.personalDonation)}원`}
            </div>
          </div>
          {!locked && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={() => startEdit(e)}>수정</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm(`'${e.label}' 지출을 삭제할까요?`)) deleteExpense(settlementId, e.id) }}>삭제</button>
            </div>
          )}
        </div>
      ))}

      {settlement.dinnerContributions.length > 0 && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>기존 회식비 (이전 회식비 탭에서 등록된 데이터)</span>
          <p className="muted" style={{ fontSize: 12 }}>
            총지출·회식비 합계에 이미 포함돼 있습니다. 위 지출 목록에 같은 회식비를 다시 등록하면 두 번 집계되니 주의해주세요.
          </p>
          {settlement.dinnerContributions.map((d) => (
            <div key={d.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{d.dinnerRound}차 회식비 — {fmt(d.totalAmount)}원 <span className="muted" style={{ fontSize: 12 }}>({d.contributionType})</span></div>
                <div className="muted" style={{ fontSize: 13 }}>
                  모임부담 {fmt(d.clubShare)}원 · {d.method}{d.contributors.length > 0 ? ` · 찬조자 ${d.contributors.length}명` : ''}
                </div>
              </div>
              {!locked && (
                <button type="button" className="danger" aria-label={`${d.dinnerRound}차 회식비(기존) 삭제`}
                  onClick={() => { if (window.confirm(`${d.dinnerRound}차 회식비를 삭제할까요?`)) deleteDinnerContribution(settlementId, d.id) }}>
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <SettlementSaveButtons settlementId={settlementId} previewMode={previewMode} locked={locked} />
    </div>
  )
}
