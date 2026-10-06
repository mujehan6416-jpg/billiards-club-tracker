import { useSettlementStore } from '../../store/settlementStore'
import { buildFundMovementLog } from '../../logic/settlement'

// 통장 거래내역과 대조하기 위한 "자금이동 내역" — 통장에서 현금 인출(bankCashWithdrawals)과
// 현금을 통장에 입금(cashDeposits, 입금확인)을 날짜순으로 한 번에 보여준다. 읽기 전용(입력·저장 없음)이라
// 같은 거래를 두 번 입력하게 만들지 않는다. 한 건 = 한 카드(좁은 폰 화면에서도 가로 스크롤 없음):
//   2026-09-30 · 현금 인출
//   통장 → 현금 1,200,000원
//   메모
// 정렬·집계는 logic/settlement.ts의 buildFundMovementLog를 그대로 쓴다(여기서는 표시만 한다).

const fmt = (n: number) => n.toLocaleString('ko-KR')

const KIND_LABEL = {
  withdrawal: { hint: '현금 인출', flow: '통장 → 현금', color: '#b9770e' },
  deposit: { hint: '현금 입금', flow: '현금 → 통장', color: '#0f6e56' },
} as const

export function FundMovementLog({ settlementId }: { settlementId: string }) {
  const settlement = useSettlementStore((s) => s.getById(settlementId))
  if (!settlement) return null
  const log = buildFundMovementLog(settlement)
  const withdrawalTotal = log.filter((e) => e.kind === 'withdrawal').reduce((a, e) => a + e.amount, 0)
  const depositTotal = log.filter((e) => e.kind === 'deposit').reduce((a, e) => a + e.amount, 0)

  return (
    <div className="card col-card" data-testid="fund-movement-log">
      <span style={{ fontWeight: 700, fontSize: 16 }}>📒 자금이동 내역</span>
      <p className="muted" style={{ fontSize: 13, whiteSpace: 'pre-line' }}>
        {'통장에서 현금을 인출하거나 현금을 다시 통장에 입금한 내역입니다.\n통장 거래내역과 날짜·금액을 대조할 때 확인할 수 있습니다.'}
      </p>
      {log.length === 0 && <p className="muted">등록된 자금이동이 없습니다.</p>}
      {log.map((e) => {
        const k = KIND_LABEL[e.kind]
        return (
          <div
            key={`${e.kind}-${e.id}`} className="card"
            style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: `6px solid ${k.color}` }}
          >
            <div style={{ fontWeight: 700, fontSize: 16, color: k.color, overflowWrap: 'anywhere' }}>{e.date} · {k.hint}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{k.flow} {fmt(e.amount)}원</div>
            <div className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{e.note ? e.note : '메모 없음'}</div>
          </div>
        )
      })}
      {log.length > 0 && (
        <div className="info-msg" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14 }}>
          <span>인출 합계 {fmt(withdrawalTotal)}원 (통장 → 현금)</span>
          <span>입금 합계 {fmt(depositTotal)}원 (현금 → 통장)</span>
        </div>
      )}
    </div>
  )
}
