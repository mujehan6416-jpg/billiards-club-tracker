import { useEffect, useMemo, useState } from 'react'
import { AdminPinButton } from '../components/AdminPinButton'
import { fetchMemberIndex } from '../lib/splitFirestore'
import { cancelMyRequest, createLinkRequest, fetchMyLink, fetchMyRequest } from '../lib/memberLink'
import { currentAuthUid } from '../lib/appAuth'
import { deviceCode } from '../lib/deviceCode'
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
  // "승인됐는지 다시 확인"을 눌렀는데 아직 이 기기가 승인되지 않은 상태. 예전에는 이 경우
  // 화면이 똑같이 다시 그려지기만 해서 눌러도 아무 일도 없는 것처럼 보였다.
  const [notApprovedYet, setNotApprovedYet] = useState(false)

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
    setBusy(true); setError(''); setNotApprovedYet(false)
    try {
      await cancelMyRequest(uid)
      await load()
    } catch {
      setError('요청을 취소하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 승인됐는지 이 기기 기준으로 직접 확인한다.
   *
   * 예전에는 이 버튼이 곧바로 onRetry()(앱 전체 다시 읽기)만 불렀다. 그래서 아직 승인 전이면
   * 똑같은 화면이 다시 그려질 뿐이라, 눌러도 아무 반응이 없는 것처럼 보였다. 게다가 관리자가
   * 분명히 승인했는데도 이 화면에 머무는 경우(= 승인이 "다른 기기 요청" 앞으로 처리된 경우)를
   * 사용자가 알 방법이 전혀 없었다.
   *
   * 연결 승인은 기기마다 따로 이뤄지고, 그 기준은 이 기기의 서버 인증 정보다. 사파리에서 열 때와
   * 홈 화면 앱으로 열 때가 서로 다른 기기로 취급되거나(iOS), 저장 공간이 비워지면 같은 iPad라도
   * 다른 기기로 잡힌다. 그때는 승인이 예전 요청 앞으로만 남아 이 기기에는 반영되지 않는다.
   * 그래서 여기서 memberLinks(이 기기의 연결 문서)를 직접 확인하고, 없으면 그 사실과 함께
   * 다시 요청하는 방법을 안내한다.
   */
  const recheck = async () => {
    const uid = currentAuthUid()
    // 서버 인증이 아직/이미 없는 상태라면 여기서 막지 말고 앱 쪽에 넘긴다 — 앱 부팅 흐름이
    // 인증을 다시 확보한 뒤 처음부터 다시 확인해 준다(그 편이 스스로 회복될 확률이 높다).
    if (!uid) { onRetry(); return }
    setBusy(true); setError(''); setNotApprovedYet(false)
    try {
      const link = await fetchMyLink(uid)
      if (link?.active) {
        onRetry() // 승인 확인 — 앱이 데이터를 다시 읽어 그 회원으로 시작한다
        return
      }
      setNotApprovedYet(true)
    } catch {
      setError('확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
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

        {/* 목록을 받아오긴 했는데 고를 이름이 하나도 없는 경우 — 서버에 이름 목록이 아직
            만들어지지 않았을 때 생긴다(관리자가 설정 탭에서 한 번 만들어 주면 해결된다).
            이때 빈 선택칸만 보여주면 사용자는 "왜 이름이 없지?" 하고 막히므로 이유를 알려준다. */}
        {status.kind === 'picking' && active.length === 0 && (
          <>
            <span className="muted" style={{ lineHeight: 1.5 }}>
              회원 이름 목록이 아직 준비되지 않았습니다.<br />
              관리자에게 <b>이름 목록 만들기</b>를 요청해 주세요.
            </span>
            <button className="primary block" onClick={() => void load()}>다시 확인</button>
          </>
        )}

        {status.kind === 'picking' && active.length > 0 && (
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
            {/* 진단용 기기 코드 — 관리자 화면의 요청 목록에 뜨는 코드와 같은지 맞춰보는 용도다.
                연결이 잘 되면 없어도 되는 표시라, 문제 해결 뒤에는 지워도 된다. */}
            <span style={{
              fontSize: 14, lineHeight: 1.5, color: '#37474f',
              background: '#eceff1', borderRadius: 8, padding: '10px 12px',
            }}>
              이 기기 코드: <b style={{ fontFamily: 'monospace', fontSize: 16 }}>{deviceCode(currentAuthUid())}</b>
              <br />
              <span className="muted" style={{ fontSize: 12 }}>
                연결 확인용 표시입니다. 관리자 화면에 보이는 코드와 같은지 확인해 주세요.
              </span>
            </span>
            {notApprovedYet && (
              <span style={{
                fontSize: 14, lineHeight: 1.6, color: '#8a6d00',
                background: '#fff8e1', borderRadius: 8, padding: '10px 12px',
              }}>
                아직 이 기기는 승인되지 않았습니다.<br />
                관리자가 이미 승인했다고 하면, 승인이 <b>다른 기기의 요청</b>에 적용됐을 수 있습니다.
                아래 <b>요청 취소</b>를 누른 뒤 이름을 다시 선택해 요청해 주세요.
              </span>
            )}
            {error && <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>}
            <button className="primary block" disabled={busy} onClick={() => void recheck()}>
              {busy ? '확인 중...' : '승인됐는지 다시 확인'}
            </button>
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
