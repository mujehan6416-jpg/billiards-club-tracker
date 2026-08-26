import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { buildMemberLabels } from '../../logic/memberLabel'
import { deviceCode } from '../../lib/deviceCode'
import { AdminAuthLogin } from '../admin/AdminAuthLogin'
import {
  approveLinkRequest, fetchMemberLinks, fetchPendingRequests, rejectLinkRequest, setLinkActive,
} from '../../lib/memberLink'
import type { LinkRequestEntry, MemberLinkEntry } from '../../types/memberLink'

/**
 * 관리자용 "기기 연결 승인" 카드 (설정 탭).
 *
 * 이 작업은 반드시 Firebase 관리자 인증(admins/{uid}.active)이 있어야 한다 —
 * 기기 localStorage PIN은 서버가 신뢰할 수 없으므로 승인 권한의 근거로 쓰지 않는다.
 * Firestore 규칙에서도 같은 기준으로 막혀 있어서, PIN만으로는 요청 목록 조회조차 되지 않는다.
 */
export function DeviceLinkAdminCard() {
  const status = useAdminAuthStore((s) => s.status)
  const uid = useAdminAuthStore((s) => s.uid)
  const members = useApp((s) => s.members)
  const [requests, setRequests] = useState<LinkRequestEntry[]>([])
  const [links, setLinks] = useState<MemberLinkEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  const labels = useMemo(() => buildMemberLabels(members), [members])
  const labelOf = (memberId: string) =>
    labels.get(memberId) ?? members.find((m) => m.id === memberId)?.name ?? '(삭제된 회원)'

  const reload = useCallback(async () => {
    setLoading(true); setMessage('')
    try {
      const [reqs, lks] = await Promise.all([fetchPendingRequests(), fetchMemberLinks()])
      setRequests(reqs)
      setLinks(lks)
    } catch {
      setMessage('목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (status === 'authorizedAdmin') void reload()
  }, [status, reload])

  if (status !== 'authorizedAdmin') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>📱 기기 연결 승인</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>
          기기 연결 승인을 하려면 관리자 로그인이 필요합니다.
          (관리자 번호(PIN)만으로는 승인할 수 없습니다.)
        </span>
        <AdminAuthLogin />
      </div>
    )
  }

  const run = async (targetUid: string, action: () => Promise<void>, doneMessage: string) => {
    setBusyUid(targetUid); setMessage('')
    try {
      await action()
      await reload()
      setMessage(doneMessage)
    } catch {
      setMessage('처리하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusyUid(null) }
  }

  const activeLinks = links.filter((l) => l.link.active)
  const inactiveLinks = links.filter((l) => !l.link.active)

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>📱 기기 연결 승인 ({requests.length}건 대기)</span>
      <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        회원이 보낸 기기 연결 요청을 확인하고 승인합니다. 승인해도 관리자 권한은 부여되지 않습니다.
        <br />
        <b>기기 코드</b>는 연결 확인용 표시입니다. 회원 기기 화면에 보이는 코드와 같은 요청을 승인해 주세요.
      </span>

      {loading && <span className="muted">불러오는 중...</span>}

      {!loading && requests.length === 0 && (
        <span className="muted">대기 중인 연결 요청이 없습니다.</span>
      )}

      {requests.map(({ firebaseUid, request }) => (
        <div key={firebaseUid} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{labelOf(request.memberId)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            요청 시각 {new Date(request.requestedAt).toLocaleString('ko-KR')}
          </div>
          {/* 진단용 기기 코드 — 회원 기기 화면에 뜨는 코드와 같은 건지 맞춰보는 용도다.
              같은 회원이 여러 기기에서 요청했을 때 어느 기기인지 구분하는 데도 쓴다. */}
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            기기 코드: <b style={{ fontFamily: 'monospace', fontSize: 14, color: '#37474f' }}>{deviceCode(firebaseUid)}</b>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              className="primary" style={{ flex: 1, fontSize: 13 }} disabled={busyUid === firebaseUid}
              onClick={() => run(firebaseUid,
                () => approveLinkRequest(firebaseUid, request.memberId, uid ?? undefined),
                `${labelOf(request.memberId)} 님의 기기를 연결했습니다.`)}
            >
              {busyUid === firebaseUid ? '처리 중...' : '승인'}
            </button>
            <button
              style={{ flex: 1, fontSize: 13, color: '#c0392b', borderColor: '#e0a0a0' }}
              disabled={busyUid === firebaseUid}
              onClick={() => {
                if (!window.confirm(`${labelOf(request.memberId)} 님의 연결 요청을 거절할까요?\n회원이 다시 요청할 수 있습니다.`)) return
                void run(firebaseUid, () => rejectLinkRequest(firebaseUid), '연결 요청을 거절했습니다.')
              }}
            >
              거절
            </button>
          </div>
        </div>
      ))}

      {activeLinks.length > 0 && (
        <>
          <span style={{ fontWeight: 600, fontSize: 13, marginTop: 8 }}>연결된 기기 ({activeLinks.length})</span>
          {activeLinks.map(({ firebaseUid, link }) => (
            <div key={firebaseUid} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{labelOf(link.memberId)}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {new Date(link.linkedAt).toLocaleDateString('ko-KR')} 연결
                  {' · '}기기 코드 <b style={{ fontFamily: 'monospace', color: '#37474f' }}>{deviceCode(firebaseUid)}</b>
                </div>
              </div>
              <button
                style={{ fontSize: 12, color: '#c0392b', borderColor: '#e0a0a0' }}
                disabled={busyUid === firebaseUid}
                onClick={() => {
                  if (!window.confirm(`${labelOf(link.memberId)} 님의 이 기기 연결을 해제할까요?`)) return
                  void run(firebaseUid, () => setLinkActive(firebaseUid, false), '기기 연결을 해제했습니다.')
                }}
              >
                연결 해제
              </button>
            </div>
          ))}
        </>
      )}

      {inactiveLinks.length > 0 && (
        <>
          <span className="muted" style={{ fontSize: 13, marginTop: 8 }}>해제된 기기 ({inactiveLinks.length})</span>
          {inactiveLinks.map(({ firebaseUid, link }) => (
            <div key={firebaseUid} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ flex: 1, minWidth: 0, opacity: 0.7 }}>
                <div style={{ fontSize: 14 }}>{labelOf(link.memberId)}</div>
              </div>
              <button
                style={{ fontSize: 12 }} disabled={busyUid === firebaseUid}
                onClick={() => void run(firebaseUid, () => setLinkActive(firebaseUid, true), '기기 연결을 다시 사용하도록 했습니다.')}
              >
                다시 연결
              </button>
            </div>
          ))}
        </>
      )}

      {message && <span style={{ fontSize: 13, color: 'var(--green-dark)' }}>{message}</span>}
      <button className="block" disabled={loading} onClick={() => void reload()}>목록 새로고침</button>
    </div>
  )
}
