import { useState } from 'react'
import { useAdmin } from '../../store/adminStore'
import { useSettlementStore } from '../../store/settlementStore'
import type { RegularSettlement } from '../../types/settlement'

type Step = 'idle' | 'confirm-pin' | 'deleting'

/**
 * 정산 선택 목록에서 현재 선택된 정산 문서 자체를 관리자가 영구 삭제하는 위험 작업 UI.
 * 1단계 경고는 기존 다른 삭제 기능(MeetingTab, LedgerTab, SettlementSyncControls)과 동일하게
 * window.confirm을 재사용한다. 2단계 관리자 번호 재확인은 useAdmin().login (기존 PIN 비교 로직,
 * adminStore.ts)을 그대로 재사용한다 — 별도의 새 비밀번호 체계를 만들지 않는다.
 * previewMode(개발 미리보기)에서는 실제 삭제 액션을 호출하지 않고 차단 안내만 표시한다.
 */
export function SettlementDeleteControl({ settlement, previewMode = false }: {
  settlement: RegularSettlement
  previewMode?: boolean
}) {
  const deleteSettlement = useSettlementStore((s) => s.deleteSettlement)
  const [step, setStep] = useState<Step>('idle')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const label = `${settlement.meetingDate} ${settlement.meetingName} (${settlement.status})`

  const startDelete = () => {
    setError('')
    setNotice('')
    if (previewMode) {
      setNotice('개발 미리보기에서는 정산을 삭제할 수 없습니다.')
      return
    }
    const confirmed = window.confirm(`정말 삭제하시겠습니까?\n\n${label}\n\n삭제한 정산은 복구할 수 없습니다.`)
    if (!confirmed) return
    setPin('')
    setStep('confirm-pin')
  }

  const cancelPinStep = () => {
    setStep('idle')
    setPin('')
    setError('')
  }

  const submitDelete = async () => {
    if (!useAdmin.getState().login(pin)) {
      setError('관리자 번호가 일치하지 않습니다.')
      setPin('')
      return
    }
    setPin('')
    setError('')
    setStep('deleting')
    const result = await deleteSettlement(settlement.id)
    if (result.ok) {
      setStep('idle')
      setNotice('정산이 삭제되었습니다.')
    } else {
      setStep('confirm-pin')
      setError(result.error)
    }
  }

  return (
    <div className="card col-card">
      <span className="muted" style={{ fontSize: 12 }}>선택한 정산: {label}</span>

      {step === 'idle' && (
        <button type="button" className="danger block" onClick={startDelete}>
          정산 삭제
        </button>
      )}

      {step !== 'idle' && (
        <div className="col-card" style={{ background: '#fdeceb', padding: 10, borderRadius: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#c0392b' }}>관리자 번호를 다시 입력해주세요</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="관리자 번호"
            disabled={step === 'deleting'}
            style={{ fontSize: 16 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={cancelPinStep} disabled={step === 'deleting'} style={{ flex: 1 }}>
              취소
            </button>
            <button
              type="button" className="danger" onClick={submitDelete}
              disabled={step === 'deleting' || !pin}
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
