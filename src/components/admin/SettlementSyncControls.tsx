import { AdminAuthLogin } from './AdminAuthLogin'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { useSettlementStore } from '../../store/settlementStore'

const SYNC_LABEL: Record<string, string> = {
  idle: '대기', loading: '불러오는 중...', saving: '저장 중...', error: '오류',
}

/**
 * 관리자 Firebase 로그인 상태 표시 + 정산 Firestore 동기화 버튼 모음.
 * 운영 화면(SettlementAdminTab)과 개발 미리보기(DevSettlementPreview) 양쪽에서 재사용한다.
 * 실제 Firestore(clubs/skkubc/settlements)를 호출하므로 title로 맥락(운영/가상 테스트)을 구분해서 보여준다.
 */
export function SettlementSyncControls({ settlementId, title = '☁ Firestore 동기화' }: { settlementId: string; title?: string }) {
  const status = useAdminAuthStore((s) => s.status)
  const adminDisplayName = useAdminAuthStore((s) => s.adminDisplayName)
  const syncStatus = useSettlementStore((s) => s.syncStatus)
  const lastSyncError = useSettlementStore((s) => s.lastSyncError)
  const loadSettlements = useSettlementStore((s) => s.loadSettlements)
  const saveDraft = useSettlementStore((s) => s.saveDraft)
  const confirmSettlement = useSettlementStore((s) => s.confirmSettlement)
  const reviseSettlement = useSettlementStore((s) => s.reviseSettlement)
  const cancelSettlement = useSettlementStore((s) => s.cancelSettlement)

  const authorized = status === 'authorizedAdmin'
  const actorDisplayName = adminDisplayName ?? '관리자'

  return (
    <div className="col-card">
      <AdminAuthLogin />

      <div className="card col-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
          <span className="muted" style={{ fontSize: 12 }}>{SYNC_LABEL[syncStatus]}</span>
        </div>
        {!authorized && (
          <p className="muted" style={{ fontSize: 12 }}>관리자로 Firebase 로그인해야 아래 버튼을 쓸 수 있습니다.</p>
        )}
        {lastSyncError && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{lastSyncError}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" disabled={!authorized} onClick={() => loadSettlements()}>목록 다시 불러오기</button>
          <button type="button" disabled={!authorized} onClick={() => saveDraft(settlementId)}>수정 저장 (draft/revised)</button>
          <button type="button" disabled={!authorized} onClick={() => confirmSettlement(settlementId, actorDisplayName)}>확정 저장</button>
          <button type="button" disabled={!authorized} onClick={() => reviseSettlement(settlementId, actorDisplayName, '수정 필요')}>수정 전환(revised) 저장</button>
          <button
            type="button" className="danger" disabled={!authorized}
            onClick={() => { if (window.confirm('이 정산을 취소 상태로 저장할까요?')) cancelSettlement(settlementId, actorDisplayName, '취소') }}
          >
            취소 저장
          </button>
        </div>
      </div>
    </div>
  )
}
