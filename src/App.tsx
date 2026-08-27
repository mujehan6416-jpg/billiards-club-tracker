import { useEffect, useRef, useState } from 'react'
import { MembersTab } from './tabs/MembersTab'
import { MeetingTab } from './tabs/MeetingTab'
import { DashboardTab } from './tabs/DashboardTab'
import { SettingsTab } from './tabs/SettingsTab'
import { LedgerTab } from './tabs/LedgerTab'
import { HomeTab } from './tabs/HomeTab'
import { LoginScreen } from './tabs/LoginScreen'
import { DeviceConnectScreen } from './tabs/DeviceConnectScreen'
import { SettlementAdminTab } from './tabs/SettlementAdminTab'
import { TournamentTab } from './tabs/TournamentTab'
import { useAdmin } from './store/adminStore'
import { useAdminAuthStore } from './store/adminAuthStore'
import { useAuth } from './store/authStore'
import { useApp } from './store/appStore'
import { downloadFromCloud, markSynced } from './lib/cloudSync'
import { USE_SPLIT_FIRESTORE, loadSplitAppState } from './lib/splitFirestore'
import { ensureAppAuth, keepAppAuthAlive, currentAuthUid } from './lib/appAuth'
import { fetchMyLink } from './lib/memberLink'
import { AdminAuthLogin } from './components/admin/AdminAuthLogin'
import type { AppState } from './types'

/** Firebase 요청이 권한 거부(permission-denied)로 실패했는지 — 연결 안 된 기기의 정상적인 상태다. */
function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'permission-denied'
}

/**
 * 이 기기에 서버(원격)보다 많은 기록이 있는지 — 덮어쓰기 전에 사용자에게 확인받을지 판단한다.
 * legacy(clubs/skkubc 문서)든 split(loadSplitAppState)이든 결과가 똑같은 AppState 모양이라
 * 같은 기준으로 비교할 수 있다.
 */
function isLocalAheadOf(local: AppState, remote: AppState): boolean {
  const gameCount = (ss: { games: unknown[] }[]) => ss.reduce((n, s) => n + s.games.length, 0)
  return (
    gameCount(local.sessions) > gameCount(remote.sessions) ||
    local.sessions.length > remote.sessions.length ||
    local.ledger.length > (remote.ledger ?? []).length
  )
}

// 'settlement'은 일부러 TABS(하단 탭바) 배열에 넣지 않는다 — 일반 회원 화면에는 전혀 노출되지 않고,
// 아래 TopBar의 관리자 모드(PIN) 전용 버튼으로만 진입 가능하다.
type Tab = 'home' | 'members' | 'meeting' | 'dashboard' | 'settings' | 'ledger' | 'settlement' | 'tournament'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home',      label: '홈',   icon: '🏠' },
  { key: 'members',   label: '회원', icon: '👥' },
  { key: 'meeting',   label: '모임', icon: '🎱' },
  { key: 'dashboard', label: '통계', icon: '📊' },
  { key: 'settings',  label: '설정', icon: '⚙️' },
]

function PinModal({ onClose }: { onClose: () => void }) {
  const { changePin } = useAdmin()
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [newPin2, setNewPin2] = useState('')
  const [msg, setMsg] = useState('')

  const doChange = () => {
    if (newPin !== newPin2) { setMsg('새 PIN이 일치하지 않습니다.'); return }
    if (newPin.length < 4) { setMsg('PIN은 4자리 이상이어야 합니다.'); return }
    if (changePin(oldPin, newPin)) { setMsg('변경되었습니다.'); setTimeout(onClose, 800) }
    else setMsg('현재 PIN이 틀렸습니다.')
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: '24px 20px',
        width: 280, display: 'flex', flexDirection: 'column', gap: 10
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>🔒 PIN 변경</span>
        <input type="password" placeholder="현재 PIN" value={oldPin}
          onChange={(e) => setOldPin(e.target.value)} style={{ width: '100%' }} />
        <input type="password" placeholder="새 PIN" value={newPin}
          onChange={(e) => setNewPin(e.target.value)} style={{ width: '100%' }} />
        <input type="password" placeholder="새 PIN 확인" value={newPin2}
          onChange={(e) => setNewPin2(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doChange()}
          style={{ width: '100%' }} />
        {msg && <span style={{ fontSize: 13, color: msg.includes('변경') ? '#1d9e75' : 'var(--danger)' }}>{msg}</span>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary block" style={{ flex: 1 }} onClick={doChange}>변경</button>
          <button className="block" style={{ flex: 1 }} onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  )
}

function TopBar({ onOpenSettlement }: { onOpenSettlement: () => void }) {
  const { isAdmin, logout: adminLogout } = useAdmin()
  const { memberName, isGuest } = useAuth()
  const [showPin, setShowPin] = useState(false)

  if (isAdmin) {
    return (
      <>
        <div style={{
          background: '#0f6e56', color: '#fff', fontSize: 12,
          padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <span>🔑 관리자 모드 {memberName && `· ${memberName}`}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={onOpenSettlement} title="정기모임 정산"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 13, padding: '2px 7px', borderRadius: 4 }}>🧾 정산</button>
            <button onClick={() => setShowPin(true)} title="PIN 변경"
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 13, padding: '2px 7px', borderRadius: 4 }}>🔒</button>
            <button onClick={adminLogout}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}>관리자 해제</button>
          </div>
        </div>
        {showPin && <PinModal onClose={() => setShowPin(false)} />}
      </>
    )
  }

  if (isGuest) {
    return (
      <div style={{
        background: '#888', color: '#fff', fontSize: 12,
        padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span>🔍 GUEST 모드 (읽기 전용)</span>
      </div>
    )
  }

  return (
    <div style={{
      background: '#072B61', color: '#fff', fontSize: 12,
      padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    }}>
      <span>👤 {memberName} 님</span>
    </div>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [syncing, setSyncing] = useState(true)
  // 서버 인증(익명)을 확보하지 못한 상태 — 이때는 데이터를 내려받지 않고 안내 화면을 보여준다
  const [authFailed, setAuthFailed] = useState(false)
  // split 모드(USE_SPLIT_FIRESTORE=true)에서 split 읽기가 권한 거부 외의 이유(네트워크 등)로
  // 실패한 상태 — legacy로 조용히 넘어가지 않는다(그러면 두 저장 구조가 서로 다른 내용을 가진
  // 채로 갈라질 수 있다). 이 상태면 화면을 아예 보여주지 않으므로 이 기기에서 어떤 write도
  // 일어나지 않는다.
  const [splitReadError, setSplitReadError] = useState(false)
  // 이 기기가 아직 어느 회원과도 연결되지 않아(permission-denied) 데이터를 전혀 읽을 수 없는 상태.
  const [needsDeviceLink, setNeedsDeviceLink] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [exitReady, setExitReady] = useState(false)
  const [backToast, setBackToast] = useState(false)
  const { memberId, logout: memberLogout } = useAuth()
  const members = useApp((s) => s.members)
  const replaceAll = useApp((s) => s.replaceAll)
  const cleanupOldPending = useApp((s) => s.cleanupOldPending)
  const { login } = useAuth()
  const { isAdmin, login: adminLogin, logout: adminLogout } = useAdmin()
  // PIN(관리자 화면 진입용)과 별개로, 실제 서버 관리자 쓰기 권한은 Firebase 관리자 로그인
  // (admins/{uid}.active)에서만 나온다 — 아래 렌더링에서 이 상태를 확인해 PIN만 입력한
  // 기기가 그대로 관리자 화면으로 들어가지 못하게 막는다(adminStore.ts:3, adminAuthStore.ts 참고).
  const adminAuthStatus = useAdminAuthStore((s) => s.status)
  // memberLinks 기준 자동 로그인은 앱 세션당 한 번만 시도한다 — 그렇지 않으면 로그아웃해도
  // 이 기기가 여전히 연결돼 있어서 매번 같은 회원으로 곧바로 다시 로그인돼 로그아웃 자체가
  // 불가능해진다.
  const autoLoginAttempted = useRef(false)
  // Firebase 관리자 로그인이 막 완료된 순간에만 한 번 재시도한다(split 읽기가 permission-denied로
  // 막혀 있던 상태였을 수 있으므로) — status가 authorizedAdmin을 유지하는 동안 계속 재시도하지
  // 않도록 이 값으로 한 번만 걸러낸다.
  const wasAuthorizedAdmin = useRef(false)

  // memberId가 바뀔 때마다(최초 진입 + 로그아웃 후 재로그인 각각) 다시 내려받는다.
  // 기존에는 deps가 []라 앱을 완전히 새로 열 때만 클라우드를 다시 확인했고, 같은 브라우저
  // 탭 안에서 로그아웃 후 재로그인하면(페이지 새로고침 없이) 재조회가 전혀 일어나지 않아
  // 다른 기기가 그 사이 저장한 최신 결과가 보이지 않는 문제가 있었다(재접속 시 결과 미표시).
  useEffect(() => {
    let cancelled = false
    setSyncing(true)
    setAuthFailed(false)
    setSplitReadError(false)
    setNeedsDeviceLink(false)
    cleanupOldPending()

    const run = async () => {
      // ① 서버 인증(익명)을 먼저 확보한다. 실패하면 서버 데이터를 내려받지 않는다 —
      //    지금은 규칙이 공개라 받아올 수는 있지만, 인증 없이 도는 상태를 남기지 않는다.
      try {
        await ensureAppAuth()
      } catch {
        if (!cancelled) { setAuthFailed(true); setSyncing(false) }
        return
      }
      if (cancelled) return

      // ②-split: split을 기본 read 경로로 쓴다. 실패하면 legacy로 조용히 넘어가지 않고
      // 화면에 오류를 명확히 보여주고 멈춘다(write 진행 금지) — 조용히 legacy로 넘어가면 두
      // 저장 구조가 서로 다른 내용을 가진 채로 갈라질 수 있다. permission-denied는 "아직 이
      // 기기가 연결되지 않음"이라는 정상적인 상태이므로 다른 오류(네트워크 등)와 구분해서
      // 처리한다 — 연결 안내 화면으로 보내지, 오류 화면을 보여주지 않는다.
      if (USE_SPLIT_FIRESTORE) {
        try {
          const splitState = await loadSplitAppState()
          if (cancelled) return
          const local = useApp.getState()
          if (isLocalAheadOf(local, splitState) && !window.confirm(
            '이 기기에 서버보다 많은 기록이 저장되어 있습니다.\n서버 내용으로 덮어쓰면 이 기기의 최근 기록이 사라질 수 있습니다.\n서버 내용을 불러올까요?',
          )) return
          replaceAll(splitState)

          // 이 기기가 실제로 승인된 회원 기기인지 memberLinks 기준으로 확인해서, 확인되면
          // 이름 선택·비밀번호 없이 곧바로 그 회원으로 시작한다(권장 방향: memberLinks를
          // 신원 기준으로 사용). 세션당 한 번만 시도한다 — 로그아웃 후 다시 시도하면 매번
          // 같은 회원으로 되돌아가 로그아웃이 불가능해진다.
          if (!autoLoginAttempted.current) {
            autoLoginAttempted.current = true
            const uid = currentAuthUid()
            if (uid) {
              const myLink = await fetchMyLink(uid).catch(() => null)
              if (myLink?.active) {
                const me = splitState.members.find((m) => m.id === myLink.memberId && m.active)
                if (me) login(me.id, me.name)
              }
            }
          }
        } catch (err) {
          if (cancelled) return
          if (isPermissionDenied(err)) setNeedsDeviceLink(true)
          else setSplitReadError(true)
        } finally {
          if (!cancelled) setSyncing(false)
        }
        return
      }

      // ②-legacy: 인증이 끝난 뒤에만 서버 데이터를 내려받는다(다운로드 실패는 기존과 동일하게 넘어간다).
      try {
        const cloud = await downloadFromCloud()
        if (cancelled || !cloud) return
        // 이 기기에 서버보다 많은 기록이 있으면(업로드 누락 가능성) 덮어쓰기 전에 확인
        const local = useApp.getState()
        if (isLocalAheadOf(local, cloud.state) && !window.confirm(
          '이 기기에 서버보다 많은 기록이 저장되어 있습니다.\n서버 내용으로 덮어쓰면 이 기기의 최근 기록이 사라질 수 있습니다.\n서버 내용을 불러올까요?',
        )) return
        replaceAll(cloud.state)
        markSynced(cloud.updatedAt)
      } catch {
        // 네트워크 오류 등 — 기존 동작 그대로 이 기기에 저장된 내용으로 계속 사용한다
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }

    void run()
    return () => { cancelled = true }
  }, [memberId, retryCount])

  // 관리자가 정산에서 로그아웃하면 Firebase 사용자가 사라지므로 익명 인증을 다시 확보한다.
  useEffect(() => keepAppAuthAlive(), [])

  // Firebase 관리자 인증 상태 구독을 앱 시작과 함께 확보한다 — PIN 관리자 게이트(아래 렌더링)가
  // 이 상태를 바로 참조할 수 있어야 하기 때문이다.
  useEffect(() => useAdminAuthStore.getState().init(), [])

  // PIN 관리자 상태에서 Firebase 관리자 인증이 막 완료되면, 그 전에 permission-denied로
  // 막혀 있었을 split 읽기를 다시 시도한다(관리자 인증 전에는 이 기기가 members/sessions 등을
  // 전혀 읽지 못했을 수 있다 — firestore.rules의 isAdmin() 조건 참고).
  useEffect(() => {
    if (isAdmin && adminAuthStatus === 'authorizedAdmin' && !wasAuthorizedAdmin.current) {
      wasAuthorizedAdmin.current = true
      setRetryCount((n) => n + 1)
    }
    if (adminAuthStatus !== 'authorizedAdmin') wasAuthorizedAdmin.current = false
  }, [isAdmin, adminAuthStatus])

  // 안드로이드 뒤로 가기 버튼 — 2회 연속 눌러야 종료
  useEffect(() => {
    // 더미 히스토리를 쌓아두면 뒤로 가기가 popstate 이벤트로 감지됨
    history.pushState(null, '', location.href)
    let ready = false
    let timer: ReturnType<typeof setTimeout>
    const handlePop = () => {
      if (ready) {
        // 두 번째 뒤로 가기 → 실제로 뒤로 보내 앱 종료
        return
      }
      // 첫 번째 뒤로 가기 → 다시 더미 상태 쌓고 토스트 표시
      history.pushState(null, '', location.href)
      ready = true
      setBackToast(true)
      timer = setTimeout(() => { ready = false; setBackToast(false) }, 2000)
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      clearTimeout(timer)
    }
  }, [])

  if (authFailed) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f3', flexDirection: 'column', gap: 14, padding: '0 24px' }}>
        <div style={{ fontSize: 28 }}>🎱</div>
        <div style={{ fontSize: 14, color: '#072B61', fontWeight: 500 }}>당신회</div>
        <div style={{ fontSize: 15, color: '#c0392b', textAlign: 'center', lineHeight: 1.6 }}>
          서버 연결을 준비하지 못했습니다.<br />인터넷 연결을 확인한 뒤 다시 시도해 주세요.
        </div>
        <button className="primary" style={{ fontSize: 16, padding: '12px 26px' }}
          onClick={() => setRetryCount((n) => n + 1)}>
          다시 시도
        </button>
      </div>
    )
  }

  // PIN(관리자 화면 진입)만 통과하고 Firebase 관리자 인증(admins/{uid}.active)이 아직 안 된 상태.
  // 이 상태로 그냥 넘어가면 회원 수정·경기 확정·CSV·회계 등 관리자 저장이 나중에 조용히
  // permission-denied로 실패하므로, 여기서 먼저 막고 Firebase 관리자 로그인을 안내한다.
  // (legacy 모드에서는 Rules가 공개라 이 확인이 필요 없으므로 USE_SPLIT_FIRESTORE일 때만 막는다.)
  if (isAdmin && USE_SPLIT_FIRESTORE && adminAuthStatus !== 'authorizedAdmin') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f3', flexDirection: 'column', gap: 14, padding: '24px 24px' }}>
        <div style={{ fontSize: 28 }}>🎱</div>
        <div style={{ fontSize: 14, color: '#072B61', fontWeight: 500 }}>당신회</div>
        <div style={{ fontSize: 15, color: '#072B61', textAlign: 'center', lineHeight: 1.6 }}>
          관리자 번호(PIN) 확인은 됐습니다.<br />
          회원·경기·회계 저장 같은 실제 관리자 작업을 하려면 아래에서<br />
          관리자 계정으로 한 번 더 로그인해 주세요.
        </div>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <AdminAuthLogin />
        </div>
        <button
          onClick={() => { adminLogout(); memberLogout() }}
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, textDecoration: 'underline', padding: 8 }}
        >
          관리자 번호(PIN) 해제하고 나가기
        </button>
      </div>
    )
  }

  if (splitReadError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f3', flexDirection: 'column', gap: 14, padding: '0 24px' }}>
        <div style={{ fontSize: 28 }}>🎱</div>
        <div style={{ fontSize: 14, color: '#072B61', fontWeight: 500 }}>당신회</div>
        <div style={{ fontSize: 15, color: '#c0392b', textAlign: 'center', lineHeight: 1.6 }}>
          최신 내용을 서버에서 불러오지 못했습니다.<br />인터넷 연결을 확인한 뒤 다시 시도해 주세요.
        </div>
        <button className="primary" style={{ fontSize: 16, padding: '12px 26px' }}
          onClick={() => setRetryCount((n) => n + 1)}>
          다시 시도
        </button>
      </div>
    )
  }

  if (needsDeviceLink) {
    return (
      <DeviceConnectScreen
        onRetry={() => setRetryCount((n) => n + 1)}
        onAdminLogin={(pin) => {
          if (adminLogin(pin)) { login('__admin__', '관리자'); return true }
          return false
        }}
      />
    )
  }

  if (syncing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f3', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 28 }}>🎱</div>
        <div style={{ fontSize: 14, color: '#072B61', fontWeight: 500 }}>당신회</div>
        <div style={{ fontSize: 12, color: '#aaa' }}>서버 연결 준비 중...</div>
      </div>
    )
  }

  if (!memberId) {
    return (
      <LoginScreen
        members={members}
        onLogin={login}
        onAdminLogin={(pin) => {
          if (adminLogin(pin)) { login('__admin__', '관리자'); return true }
          return false
        }}
      />
    )
  }

  return (
    <div className="app">
      <TopBar onOpenSettlement={() => setTab('settlement')} />
      {backToast && (
        <div style={{
          position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 20,
          padding: '10px 20px', fontSize: 14, fontWeight: 500, zIndex: 9999,
          whiteSpace: 'nowrap', pointerEvents: 'none',
        }}>
          한 번 더 누르면 종료됩니다
        </div>
      )}
      <main className="app-main">
        {tab === 'home'      && <HomeTab onNavigate={setTab} />}
        {tab === 'members'   && <MembersTab />}
        {tab === 'meeting'   && <MeetingTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'settings'  && <SettingsTab />}
        {tab === 'ledger'    && <LedgerTab />}
        {tab === 'settlement' && <SettlementAdminTab onBack={() => setTab('home')} />}
        {tab === 'tournament' && <TournamentTab />}
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="nav-icon" aria-hidden="true">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
        <button onClick={() => {
          if (exitReady) { memberLogout(); return }
          setExitReady(true)
          setTimeout(() => setExitReady(false), 2000)
        }} style={exitReady ? { color: '#c0392b' } : undefined}>
          <span className="nav-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v10" />
              <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
            </svg>
          </span>
          <span className="nav-label">{exitReady ? '한번더!' : '종료'}</span>
        </button>
      </nav>
    </div>
  )
}
