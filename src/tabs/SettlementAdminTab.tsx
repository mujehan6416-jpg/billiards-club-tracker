import { useEffect, useRef } from 'react'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { useSettlementStore } from '../store/settlementStore'
import { AdminAuthLogin } from '../components/admin/AdminAuthLogin'
import { SettlementSyncControls } from '../components/admin/SettlementSyncControls'
import { SettlementTab } from './SettlementTab'

/**
 * 정기모임 정산 운영 진입점. App.tsx에서 기존 PIN 관리자 모드(useAdmin().isAdmin)일 때만
 * 노출되는 "정산" 버튼을 눌러야 도달한다(일반 회원에게는 이 화면 자체가 존재하지 않는 것과 같다).
 * 여기 진입해도 Firebase 관리자 인증(authorizedAdmin)을 통과하기 전에는 정산 데이터에 접근할 수 없다
 * — PIN(화면 진입 통제) → Firebase Auth(실제 Firestore 서버 권한)의 2단계 구조.
 */
export function SettlementAdminTab({ onBack }: { onBack: () => void }) {
  const status = useAdminAuthStore((s) => s.status)
  const currentId = useSettlementStore((s) => s.currentId)
  const loadSettlements = useSettlementStore((s) => s.loadSettlements)
  const loadedOnceRef = useRef(false)

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  useEffect(() => {
    if (status === 'authorizedAdmin' && !loadedOnceRef.current) {
      loadedOnceRef.current = true
      loadSettlements()
    }
  }, [status, loadSettlements])

  return (
    <div className="tab">
      <button type="button" onClick={onBack} style={{ marginBottom: 10 }}>← 뒤로</button>

      {status !== 'authorizedAdmin' ? (
        <div className="col-card">
          <h2 className="tab-title" style={{ marginBottom: 0 }}>🧾 정기모임 정산 — 관리자 로그인</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            정산 데이터는 관리자 전용입니다. Firebase 관리자 이메일과 비밀번호로 로그인해주세요.
          </p>
          <AdminAuthLogin />
        </div>
      ) : (
        <>
          <SettlementTab />
          {currentId && <SettlementSyncControls settlementId={currentId} />}
        </>
      )}
    </div>
  )
}
