import { useSettlementStore } from '../../store/settlementStore'
import type { RegularSettlement } from '../../types/settlement'
import type { Session } from '../../types'

const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`

/**
 * 해당 세션(모임)에 연결된 "확정된" 정산 하나를 고른다. sessionId로 직접 연결된 정산을 우선하고,
 * 없으면 같은 날짜(meetingDate)의 확정 정산 중 가장 최근에 확정된 것을 쓴다. draft/revised/cancelled는
 * 절대 반환하지 않는다 — 일반회원에게는 confirmed 정산만 공개한다는 정책을 이 함수 하나로 강제한다.
 */
function pickConfirmedSettlement(settlements: RegularSettlement[], session: Session): RegularSettlement | null {
  const confirmed = settlements.filter((s) => s.status === 'confirmed')
  const bySession = confirmed.find((s) => s.sessionId === session.id)
  if (bySession) return bySession
  const byDate = confirmed.filter((s) => s.meetingDate === session.date)
  if (byDate.length === 0) return null
  return [...byDate].sort((a, b) => (b.confirmedAt ?? '').localeCompare(a.confirmedAt ?? ''))[0]
}

/**
 * 일반회원용 확정 정산 요약 카드 — 모임 상세 화면(대진 결과 바로 아래)에 표시한다.
 * 확정(confirmed)된 정산이 없으면 아무것도 렌더링하지 않는다(제목·빈 카드 모두 노출 안 함).
 * 관리자 전용 조작(임시저장/최종게시/확정/확정취소/수정/삭제)은 절대 포함하지 않는 읽기 전용 카드다.
 *
 * 현재 이 카드는 useSettlementStore의 로컬 settlements 배열만 읽는다 — Firestore의
 * clubs/skkubc/settlements 컬렉션은 보안 규칙상 관리자(isAdmin())만 read 가능해서, 일반회원
 * 세션에서는 아직 이 배열이 채워지지 않는다(별도 승인 후 공개 read 경로 추가 필요 — 최종 보고 참고).
 */
export function MemberSettlementSummary({ session }: { session: Session }) {
  const settlements = useSettlementStore((s) => s.settlements)
  const settlement = pickConfirmedSettlement(settlements, session)
  if (!settlement) return null

  const summary = useSettlementStore.getState().getPublicSummary(settlement.id)
  if (!summary) return null

  return (
    <div className="card col-card" style={{ marginTop: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: '#0f6e56' }}>🧾 정산 결과 ({summary.meetingName})</span>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="muted">총수입</span>
        <span style={{ fontWeight: 600 }}>{fmt(summary.totalIncome)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="muted">총지출</span>
        <span style={{ fontWeight: 600 }}>{fmt(summary.totalExpense)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
        <span style={{ fontWeight: 700 }}>모임 순익</span>
        <span style={{ fontWeight: 700, color: summary.netProfit >= 0 ? '#0f6e56' : '#c0392b' }}>{fmt(summary.netProfit)}</span>
      </div>

      <div className="muted" style={{ fontSize: 13 }}>회비 합계 {fmt(summary.duesTotal)} · 찬조 합계 {fmt(summary.donationTotal)}</div>
      <div className="muted" style={{ fontSize: 13 }}>현금 합계 {fmt(summary.cashIncomeTotal)} · 계좌이체 합계 {fmt(summary.transferIncomeTotal)}</div>

      {summary.expenseByCategory.length > 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          지출 분류: {summary.expenseByCategory.map((c) => `${c.category} ${fmt(c.amount)}`).join(' · ')}
        </div>
      )}

      {summary.dinnerSummary.roundCount > 0 && (
        <div className="muted" style={{ fontSize: 13 }}>
          회식비 {summary.dinnerSummary.roundCount}차 · 모임 부담 합계 {fmt(summary.dinnerSummary.clubShareTotal)}
        </div>
      )}

      {summary.thankYouMessages.length > 0 && (
        <div style={{ fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          {summary.thankYouMessages.map((t, i) => <div key={i}>{t}</div>)}
        </div>
      )}
    </div>
  )
}
