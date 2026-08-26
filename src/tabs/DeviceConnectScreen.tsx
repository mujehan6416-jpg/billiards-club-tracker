import { useEffect, useMemo, useState } from 'react'
import { AdminPinButton } from '../components/AdminPinButton'
import { fetchMemberIndex } from '../lib/splitFirestore'
import { cancelMyRequest, createLinkRequest, fetchMyRequest } from '../lib/memberLink'
import { currentAuthUid } from '../lib/appAuth'
import { buildMemberLabels } from '../logic/memberLabel'
import type { MemberIndexEntry } from '../types/splitFirestore'

type Status =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'picking'; index: MemberIndexEntry[] }
  | { kind: 'requested'; memberName: string }

/**
 * 아직 이 기기가 어느 회원과도 연결되지 않은 상태에서 보여주는 화면.
 *
 * 연결되지 않은 기기는 Firestore 규칙상 members/sessions/ledger/config를 전혀 읽을 수 없다
 * (관리자도, 연결된 회원도 아니므로). 그래서 여기서는 그 데이터를 전혀 쓰지 않고, 딱 하나
 * 열려 있는 memberIndex(이름·구분정보·활성 여부만 담은 최소 목록)만 읽어서 "내가 누구인지"
 * 고르게 한다. 실제 연결은 관리자가 승인해야 이뤄진다 — 이 화면은 요청만 만든다.
 */
export function DeviceConnectScreen({ onAdminLogin, onRetry }: {
  onAdminLogin?: (pin: string) => boolean
  onRetry: () => void
}) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    setStatus({ kind: 'loading' })
    const uid = currentAuthUid()
    if (!uid) { setStatus({ kind: 'error' }); return }
    try {
      const existing = await fetchMyRequest(uid)
      if (existing) {
        const index = await fetchMemberIndex().catch(() => [] as MemberIndexEntry[])
        const me = index.find((m) => m.id === existing.memberId)
        setStatus({ kind: 'requested', memberName: me?.name ?? '선택한 회원' })
        return
      }
      const index = await fetchMemberIndex()
      setStatus({ kind: 'picking', index })
    } catch {
      setStatus({ kind: 'error' })
    }
  }

  useEffect(() => { void load() }, [])

  const active = useMemo(
    () => (status.kind === 'picking' ? [...status.index.filter((m) => m.active)].sort((a, b) => a.name.localeCompare(b.name, 'ko')) : []),
    [status],
  )
  const labels = useMemo(() => buildMemberLabels(active), [active])

  const request = async () => {
    const uid = currentAuthUid()
    if (!uid || !selectedId) { setError('이름을 선택해 주세요.'); return }
    setBusy(true); setError('')
    try {
      await createLinkRequest(uid, selectedId)
      const me = active.find((m) => m.id === selectedId)
      setStatus({ kind: 'requested', memberName: me?.name ?? '선택한 회원' })
    } catch {
      setError('연결 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    const uid = currentAuthUid()
    if (!uid) return
    setBusy(true); setError('')
    try {
      await cancelMyRequest(uid)
      await load()
    } catch {
      setError('요청을 취소하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const logoSrc = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL + 'ICON-SKKU.jpg'

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: '4px 20px',
      position: 'relative', gap: 4,
    }}>
      <AdminPinButton onAdminLogin={onAdminLogin} />

      <img src={logoSrc} alt="로고" style={{ width: '150%', maxWidth: 720, height: 'auto', objectFit: 'contain', marginBottom: '-21vw' }} />

      <div style={{
        background: '#fff', borderRadius: 16, padding: '20px 20px',
        width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
        border: '0.5px solid #e0e0e0',
      }}>
        <span style={{ fontWeight: 700, fontSize: 16, textAlign: 'center' }}>📱 처음 사용하는 기기입니다</span>

        {status.kind === 'loading' && (
          <span className="muted" style={{ textAlign: 'center' }}>확인 중...</span>
        )}

        {status.kind === 'error' && (
          <>
            <span className="muted" style={{ lineHeight: 1.5, textAlign: 'center' }}>
              회원 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.
            </span>
            <button className="primary block" onClick={() => void load()}>다시 시도</button>
          </>
        )}

        {status.kind === 'picking' && (
          <>
            <span className="muted" style={{ lineHeight: 1.5 }}>
              본인의 이름을 선택하고 연결을 요청하면, 관리자가 승인한 뒤 이 기기로 이용할 수 있습니다.
            </span>
            <select
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setError('') }}
              style={{ width: '100%' }}
            >
              <option value="">이름 선택</option>
              {active.map((m) => (
                <option key={m.id} value={m.id}>{labels.get(m.id) ?? m.name}</option>
              ))}
            </select>
            {error && <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>}
            <button className="primary block" disabled={busy} onClick={request}>
              {busy ? '요청 중...' : '이 기기 연결 요청'}
            </button>
          </>
        )}

        {status.kind === 'requested' && (
          <>
            <span className="muted" style={{ lineHeight: 1.5 }}>
              ⏳ <b>{status.memberName}</b> 님으로 연결을 요청했습니다.<br />
              관리자 승인을 기다려 주세요.
            </span>
            {error && <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>}
            <button className="primary block" onClick={onRetry}>승인됐는지 다시 확인</button>
            <button className="block" disabled={busy} onClick={cancel}>
              {busy ? '처리 중...' : '요청 취소'}
            </button>
          </>
        )}
      </div>

      <div style={{ fontSize: 26, color: '#555' }}>성균관대학교 부산동문</div>
      <div style={{ fontSize: 36, fontWeight: 700, color: '#072B61' }}>당신회</div>
    </div>
  )
}
