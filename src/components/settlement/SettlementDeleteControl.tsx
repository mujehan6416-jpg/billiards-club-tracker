import { useState } from 'react'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { useSettlementStore } from '../../store/settlementStore'
import { reauthenticateAdmin, ReauthError } from '../../lib/adminAuth'
import type { RegularSettlement } from '../../types/settlement'

type Step = 'idle' | 'confirm-auth' | 'deleting'

/**
 * 선택한 정산 문서 1건을 관리자가 영구 삭제하는 위험 작업 UI.
 *
 * 삭제 범위: clubs/skkubc/settlements/{id} 문서 하나뿐이다. 정산은 "1건 = 문서 1개" 구조라
 * 함께 정리해야 할 연관 문서가 없다(settlementPublic 경로는 타입 정의만 있고 앱 어디에서도
 * 실제로 만들지 않는다). 다른 정산과 회계(ledger)는 전혀 건드리지 않는다.
 *
 * 권한: 기기 관리자 번호(PIN)만으로는 삭제할 수 없다. PIN은 이 기기 localStorage 값이라
 * 서버가 신뢰할 수 없기 때문이다. 그래서
 *   1. Firebase 관리자로 인증된 상태(admins/{uid}.active)여야 하고,
 *   2. 삭제 직전에 그 계정의 비밀번호를 다시 한 번 확인(re-authentication)해야 한다.
 * 재인증이 실패하면 삭제 함수를 아예 호출하지 않으므로 어떤 문서도 지워지지 않는다.
 *
 * previewMode(개발 미리보기)에서는 실제 삭제 액션을 호출하지 않고 차단 안내만 표시한다.
 */
export function SettlementDeleteControl({ settlement, previewMode = false }: {
  settlement: RegularSettlement
  previewMode?: boolean
}) {
  const deleteSettlement = useSettlementStore((s) => s.deleteSettlement)
  const adminStatus = useAdminAuthStore((s) => s.status)
  const adminEmail = useAdminAuthStore((s) => s.email)

  const [step, setStep] = useState<Step>('idle')
  const [password, setPassword] = useState('')
  const [ackConfirmed, setAckConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isConfirmed = settlement.status === 'confirmed'
  const statusLabel = isConfirmed ? '확정됨' : '작성 중(draft)'

  // Firebase 관리자 인증이 없으면 삭제 자체를 시작할 수 없다.
  if (adminStatus !== 'authorizedAdmin') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>🗑️ 정산 삭제</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>
          정산을 삭제하려면 관리자 로그인이 필요합니다.
          (관리자 번호(PIN)만으로는 삭제할 수 없습니다.)
        </span>
      </div>
    )
  }

  const startDelete = () => {
    setError('')
    setNotice('')
    if (previewMode) {
      setNotice('개발 미리보기에서는 정산을 삭제할 수 없습니다.')
      return
    }
    const warning = isConfirmed
      ? `⚠️ 이미 확정된 정산입니다.\n\n`
        + `${settlement.meetingDate} ${settlement.meetingName}\n상태: ${statusLabel}\n\n`
        + `확정 정산을 지우면 그 회차의 정산 결과가 사라지고 되돌릴 수 없습니다.\n정말 계속할까요?`
      : `정말 삭제하시겠습니까?\n\n`
        + `${settlement.meetingDate} ${settlement.meetingName}\n상태: ${statusLabel}\n\n`
        + `삭제한 정산은 복구할 수 없습니다.`
    if (!window.confirm(warning)) return
    setPassword('')
    setAckConfirmed(false)
    setStep('confirm-auth')
  }

  const cancelAuthStep = () => {
    setStep('idle')
    setPassword('')
    setAckConfirmed(false)
    setError('')
  }

  const submitDelete = async () => {
    setError('')
    // ① 지금 로그인한 관리자 계정의 비밀번호를 다시 확인한다. 실패하면 여기서 끝 — 삭제 없음.
    try {
      await reauthenticateAdmin(password)
    } catch (e) {
      setPassword('')
      setError(e instanceof ReauthError ? e.message : '확인하지 못했습니다. 다시 시도해 주세요.')
      return
    }
    // ② 재인증에 성공했을 때만 실제 삭제로 넘어간다.
    setPassword('')
    setStep('deleting')
    const result = await deleteSettlement(settlement.id)
    if (result.ok) {
      setStep('idle')
      setAckConfirmed(false)
      setNotice('정산이 삭제되었습니다.')
    } else {
      setStep('confirm-auth')
      setError(result.error)
    }
  }

  const canSubmit = step === 'confirm-auth' && !!password && (!isConfirmed || ackConfirmed)

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🗑️ 정산 삭제</span>

      {/* 무엇을 지우는지 날짜·제목·상태로 분명히 보여준다. */}
      <div style={{ fontSize: 14, lineHeight: 1.6 }}>
        <div>날짜: <b>{settlement.meetingDate}</b></div>
        <div>제목: <b>{settlement.meetingName}</b></div>
        <div>
          상태:{' '}
          <b style={{ color: isConfirmed ? '#c0392b' : undefined }}>{statusLabel}</b>
        </div>
      </div>

      {step === 'idle' && (
        <button type="button" className="danger block" onClick={startDelete}>
          정산 삭제
        </button>
      )}

      {step !== 'idle' && (
        <div className="col-card" style={{ background: '#fdeceb', padding: 10, borderRadius: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#c0392b' }}>
            관리자 비밀번호를 다시 입력해 주세요
          </span>
          <span className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {adminEmail} 계정의 비밀번호입니다. (관리자 번호(PIN)가 아닙니다.)
          </span>

          {isConfirmed && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, lineHeight: 1.5 }}>
              <input
                type="checkbox"
                checked={ackConfirmed}
                onChange={(e) => setAckConfirmed(e.target.checked)}
                disabled={step === 'deleting'}
                style={{ marginTop: 3 }}
              />
              <span>확정된 정산을 삭제한다는 것을 이해했습니다.</span>
            </label>
          )}

          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="관리자 비밀번호"
            aria-label="관리자 비밀번호"
            disabled={step === 'deleting'}
            style={{ fontSize: 16 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={cancelAuthStep} disabled={step === 'deleting'} style={{ flex: 1 }}>
              취소
            </button>
            <button
              type="button" className="danger" onClick={() => void submitDelete()}
              disabled={!canSubmit}
              style={{ flex: 1 }}
            >
              {step === 'deleting' ? '삭제 중...' : '정산 영구 삭제'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{error}</p>}
      {notice && <p className="info-msg">{notice}</p>}
    </div>
  )
}
