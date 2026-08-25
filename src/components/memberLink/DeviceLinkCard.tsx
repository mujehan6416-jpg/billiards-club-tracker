import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/authStore'
import { currentAuthUid } from '../../lib/appAuth'
import { cancelMyRequest, createLinkRequest, fetchMyLink, fetchMyRequest } from '../../lib/memberLink'

type LinkState =
  | { kind: 'loading' }
  | { kind: 'linked' }
  | { kind: 'inactive' }
  | { kind: 'requested' }
  | { kind: 'none' }
  | { kind: 'unavailable' } // 인증 전 등 — 카드 자체를 숨긴다

/**
 * 일반회원용 "이 기기 연결" 카드 (설정 탭).
 *
 * 지금은 부가 기능이다 — 연결하지 않아도 앱은 지금까지와 똑같이 쓸 수 있고, 기존 로그인·데이터
 * 접근 방식은 전혀 바뀌지 않는다. 다음 보안 단계에서 이 연결이 실제 접근 권한의 기준이 된다.
 *
 * 이 화면에 오려면 이미 기존 방식으로 로그인한 상태이므로 회원을 따로 고르지 않고 로그인한
 * 회원으로 요청한다. 다만 그 비밀번호 확인은 화면 안에서만 이뤄지므로 보안 근거로 삼지 않는다 —
 * 이 연결을 실제로 확정하는 것은 관리자의 승인이다.
 */
export function DeviceLinkCard() {
  const { memberId, memberName, isGuest } = useAuth()
  const [state, setState] = useState<LinkState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // GUEST와 관리자 PIN 모드('__admin__')는 실제 회원이 아니라 연결 대상이 아니다.
  const realMemberId = !isGuest && memberId && memberId !== '__admin__' ? memberId : null

  const refresh = useCallback(async () => {
    const uid = currentAuthUid()
    if (!uid || !realMemberId) { setState({ kind: 'unavailable' }); return }
    try {
      const link = await fetchMyLink(uid)
      if (link) { setState({ kind: link.active ? 'linked' : 'inactive' }); return }
      const request = await fetchMyRequest(uid)
      setState({ kind: request ? 'requested' : 'none' })
    } catch {
      setState({ kind: 'unavailable' })
    }
  }, [realMemberId])

  useEffect(() => { void refresh() }, [refresh])

  if (state.kind === 'loading' || state.kind === 'unavailable') return null

  const request = async () => {
    const uid = currentAuthUid()
    if (!uid || !realMemberId) return
    setBusy(true); setError('')
    try {
      await createLinkRequest(uid, realMemberId)
      setState({ kind: 'requested' })
    } catch {
      setError('연결 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const cancel = async () => {
    const uid = currentAuthUid()
    if (!uid) return
    setBusy(true); setError('')
    try {
      await cancelMyRequest(uid)
      setState({ kind: 'none' })
    } catch {
      setError('요청을 취소하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>📱 이 기기 연결</span>

      {state.kind === 'linked' && (
        <span className="muted" style={{ lineHeight: 1.5 }}>
          ✅ 이 기기는 <b>{memberName}</b> 님으로 연결되어 있습니다.
        </span>
      )}

      {state.kind === 'inactive' && (
        <>
          <span className="muted" style={{ lineHeight: 1.5 }}>
            이 기기의 연결이 해제된 상태입니다. 다시 사용하려면 관리자에게 문의해 주세요.
          </span>
        </>
      )}

      {state.kind === 'requested' && (
        <>
          <span className="muted" style={{ lineHeight: 1.5 }}>
            ⏳ 관리자 승인 대기 중입니다. 승인되면 이 기기가 <b>{memberName}</b> 님으로 연결됩니다.
          </span>
          <button className="block" disabled={busy} onClick={cancel}>
            {busy ? '처리 중...' : '요청 취소'}
          </button>
        </>
      )}

      {state.kind === 'none' && (
        <>
          <span className="muted" style={{ lineHeight: 1.5 }}>
            이 기기를 <b>{memberName}</b> 님의 회원정보와 연결해 주세요.
            관리자가 승인하면 연결됩니다. 지금 연결하지 않아도 앱은 그대로 사용할 수 있습니다.
          </span>
          <button className="primary block" disabled={busy} onClick={request}>
            {busy ? '요청 중...' : '이 기기 연결 요청'}
          </button>
        </>
      )}

      {error && <span style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}
