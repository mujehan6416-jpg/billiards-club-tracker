import { useState } from 'react'
import { useSettlementStore } from '../../store/settlementStore'
import { useAuth } from '../../store/authStore'

const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`
const parseAmt = (v: string) => parseInt(v.replace(/[^0-9-]/g, '') || '0', 10)

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중', confirmed: '확정됨', revised: '수정 중(재확정 대기)', cancelled: '취소됨',
}

function ConfirmButton({ label, message, danger, disabled, onConfirm }: {
  label: string; message: string; danger?: boolean; disabled?: boolean; onConfirm: () => void
}) {
  return (
    <button
      type="button" className={danger ? 'danger' : 'primary'} disabled={disabled}
      onClick={() => { if (window.confirm(message)) onConfirm() }}
    >
      {label}
    </button>
  )
}

export function SettlementSummary({ settlementId, previewMode = false }: { settlementId: string; previewMode?: boolean }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  const getSummary = useSettlementStore((s) => s.getSummary)
  const updatePrevBankBalance = useSettlementStore((s) => s.updatePrevBankBalance)
  const updateOtherBankAdjustment = useSettlementStore((s) => s.updateOtherBankAdjustment)
  const confirmSettlement = useSettlementStore((s) => s.confirmSettlement)
  const reviseSettlement = useSettlementStore((s) => s.reviseSettlement)
  const cancelSettlement = useSettlementStore((s) => s.cancelSettlement)
  const syncStatus = useSettlementStore((s) => s.syncStatus)
  const { memberName } = useAuth()
  const [error, setError] = useState('')

  if (!settlement) return null
  const summary = getSummary(settlementId)
  if (!summary) return null
  const { income, expense, profit, cash, bank } = summary
  const actorDisplayName = memberName ?? '관리자'
  const locked = settlement.status === 'confirmed' || settlement.status === 'cancelled'
  const saving = syncStatus === 'saving'

  // previewMode(개발 미리보기 전용): 이중 방어 — 버튼은 비활성화돼 있지만, 혹시라도 호출되면 여기서도 막는다.
  // 실제 저장은 changeStatus(로컬 전용)가 아니라 confirmSettlement/reviseSettlement/cancelSettlement를 호출해야
  // Firestore에 반영된다(로컬 상태 전이 후 pushToCloud까지 수행하는 기존 store 액션을 그대로 재사용).
  const doTransition = async (to: 'confirmed' | 'revised' | 'cancelled') => {
    if (previewMode || saving) return
    setError('')
    const reason = to === 'cancelled' ? window.prompt('취소 사유를 입력해주세요 (선택)') ?? undefined : undefined
    const res =
      to === 'confirmed' ? await confirmSettlement(settlementId, actorDisplayName) :
      to === 'revised' ? await reviseSettlement(settlementId, actorDisplayName, reason) :
      await cancelSettlement(settlementId, actorDisplayName, reason)
    if (!res.ok) setError(res.error)
  }

  return (
    <div className="col-card">
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>정산 상태</span>
        <span style={{ fontWeight: 700, color: settlement.status === 'confirmed' ? '#0f6e56' : settlement.status === 'cancelled' ? '#c0392b' : '#072B61' }}>
          {STATUS_LABEL[settlement.status]}
        </span>
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14, color: '#0f6e56' }}>💰 수입 집계</span>
        <div className="muted" style={{ fontSize: 13 }}>회비 현금 {fmt(income.duesCash)} · 회비 계좌이체(확인) {fmt(income.duesTransferConfirmed)}</div>
        <div className="muted" style={{ fontSize: 13 }}>찬조 현금 {fmt(income.donationCash)} · 찬조 계좌이체(확인) {fmt(income.donationTransferConfirmed)}</div>
        {(income.duesTransferUnconfirmed + income.donationTransferUnconfirmed) > 0 && (
          <div style={{ fontSize: 13, color: '#c0392b', fontWeight: 600 }}>
            <div>⚠ 계좌이체 미확인 합계 {fmt(income.duesTransferUnconfirmed + income.donationTransferUnconfirmed)}</div>
            <div>입금 확인 전 금액은 총수입에서 제외됩니다.</div>
          </div>
        )}
        <div style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6 }}>총수입 {fmt(profit.totalIncome)}</div>
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14, color: '#c0392b' }}>💸 지출 집계</span>
        <div className="muted" style={{ fontSize: 13 }}>현금 {fmt(expense.cash)} · 체크카드 {fmt(expense.card)} · 계좌이체 {fmt(expense.transfer)} · 기타 {fmt(expense.other)}</div>
        <div className="muted" style={{ fontSize: 13 }}>(회식비 모임부담 {fmt(expense.dinnerClubShare)} 포함)</div>
        <div style={{ fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: 6 }}>총지출 {fmt(profit.totalExpense)}</div>
      </div>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700 }}>모임 순익</span>
        <span style={{ fontWeight: 700, fontSize: 18, color: profit.netProfit >= 0 ? '#0f6e56' : '#c0392b' }}>{fmt(profit.netProfit)}</span>
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14 }}>현금 관리</span>
        <div className="muted" style={{ fontSize: 13 }}>현금 수입 {fmt(cash.cashIncome)} · 현금 지출 {fmt(cash.cashExpense)}</div>
        <div className="muted" style={{ fontSize: 13 }}>입금 전 잔액 {fmt(cash.cashBalanceBeforeDeposit)} · 통장 입금 {fmt(cash.confirmedDeposit)}</div>
        <div style={{ fontWeight: 700 }}>입금 후 현금 잔액 {fmt(cash.cashBalanceAfterDeposit)}</div>
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14 }}>통장 잔액 (관리자 전용 — 회원 공유문에는 절대 포함되지 않음)</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>전월 통장 잔액</span>
          <input
            type="number" inputMode="numeric" disabled={locked} value={settlement.prevBankBalance || ''}
            placeholder="0" onChange={(e) => updatePrevBankBalance(settlementId, parseAmt(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>기타 통장 조정액(±)</span>
          <input
            type="number" disabled={locked} value={settlement.otherBankAdjustment || ''}
            placeholder="0" onChange={(e) => updateOtherBankAdjustment(settlementId, parseAmt(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>
        <div className="muted" style={{ fontSize: 13 }}>확인된 계좌이체 수입 {fmt(bank.confirmedTransferIncome)} · 통장 입금액 {fmt(bank.confirmedCashDeposit)}</div>
        <div className="muted" style={{ fontSize: 13 }}>체크카드 지출 {fmt(bank.cardExpense)} · 계좌이체 지출 {fmt(bank.transferExpense)}</div>
        {bank.unconfirmedTransferAmount > 0 && (
          <div style={{ fontSize: 13, color: '#c0392b', fontWeight: 600 }}>
            <div>⚠ 계좌이체 미확인 합계 {fmt(bank.unconfirmedTransferAmount)}</div>
            <div>입금 확인 전 금액은 총수입에서 제외됩니다.</div>
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700 }}>현재 통장 잔액</span>
          <span style={{ fontWeight: 700, fontSize: 18 }}>{fmt(bank.currentBalance)}</span>
        </div>
      </div>

      {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 14 }}>정산 상태 변경</span>
        <p className="muted" style={{ fontSize: 12 }}>
          지금은 관리자 PIN(화면 잠금)만으로 막고 있어 완전한 서버 보안은 아닙니다 — 실제 운영 전 확인이 필요합니다.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {settlement.status === 'draft' && (
            <ConfirmButton label="정산 확정" message="정산을 확정할까요? 확정 후에는 입력 필드가 잠깁니다." disabled={previewMode || saving} onConfirm={() => doTransition('confirmed')} />
          )}
          {settlement.status === 'revised' && (
            <ConfirmButton label="다시 확정" message="수정한 내용으로 다시 확정할까요?" disabled={previewMode || saving} onConfirm={() => doTransition('confirmed')} />
          )}
          {settlement.status === 'confirmed' && (
            <ConfirmButton label="정산 수정" message="확정을 풀고 수정 상태로 되돌릴까요?" disabled={previewMode || saving} onConfirm={() => doTransition('revised')} />
          )}
          {(settlement.status === 'draft' || settlement.status === 'confirmed' || settlement.status === 'revised') && (
            <ConfirmButton danger label="정산 취소" message="이 정산을 취소할까요? 데이터는 삭제되지 않고 취소 이력이 남습니다." disabled={previewMode || saving} onConfirm={() => doTransition('cancelled')} />
          )}
        </div>
      </div>

      {settlement.revisionLog.length > 0 && (
        <div className="card col-card">
          <span style={{ fontWeight: 700, fontSize: 14 }}>변경 이력</span>
          {settlement.revisionLog.map((r, i) => (
            <div key={i} className="muted" style={{ fontSize: 12, borderTop: i > 0 ? '1px solid var(--border)' : undefined, paddingTop: i > 0 ? 4 : 0 }}>
              {new Date(r.changedAt).toLocaleString('ko-KR')} · {r.fromStatus} → {r.toStatus} · {r.actorDisplayName}{r.reason ? ` · ${r.reason}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
