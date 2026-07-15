import { useEffect, useState } from 'react'
import { MembersTab } from './tabs/MembersTab'
import { MeetingTab } from './tabs/MeetingTab'
import { DashboardTab } from './tabs/DashboardTab'
import { SettingsTab } from './tabs/SettingsTab'
import { LedgerTab } from './tabs/LedgerTab'
import { HomeTab } from './tabs/HomeTab'
import { LoginScreen } from './tabs/LoginScreen'
import { SettlementAdminTab } from './tabs/SettlementAdminTab'
import { useAdmin } from './store/adminStore'
import { useAuth } from './store/authStore'
import { useApp } from './store/appStore'
import { downloadFromCloud, markSynced } from './lib/cloudSync'

// 'settlement'은 일부러 TABS(하단 탭바) 배열에 넣지 않는다 — 일반 회원 화면에는 전혀 노출되지 않고,
// 아래 TopBar의 관리자 모드(PIN) 전용 버튼으로만 진입 가능하다.
type Tab = 'home' | 'members' | 'meeting' | 'dashboard' | 'settings' | 'ledger' | 'settlement'

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
  const [exitReady, setExitReady] = useState(false)
  const [backToast, setBackToast] = useState(false)
  const { memberId, logout: memberLogout } = useAuth()
  const members = useApp((s) => s.members)
  const replaceAll = useApp((s) => s.replaceAll)
  const cleanupOldPending = useApp((s) => s.cleanupOldPending)
  const { login } = useAuth()
  const { login: adminLogin } = useAdmin()

  // memberId가 바뀔 때마다(최초 진입 + 로그아웃 후 재로그인 각각) 다시 내려받는다.
  // 기존에는 deps가 []라 앱을 완전히 새로 열 때만 클라우드를 다시 확인했고, 같은 브라우저
  // 탭 안에서 로그아웃 후 재로그인하면(페이지 새로고침 없이) 재조회가 전혀 일어나지 않아
  // 다른 기기가 그 사이 저장한 최신 결과가 보이지 않는 문제가 있었다(재접속 시 결과 미표시).
  useEffect(() => {
    setSyncing(true)
    cleanupOldPending()
    downloadFromCloud()
      .then((cloud) => {
        if (!cloud) return
        // 이 기기에 클라우드보다 많은 기록이 있으면(업로드 누락 가능성) 덮어쓰기 전에 확인
        const local = useApp.getState()
        const gameCount = (ss: { games: unknown[] }[]) => ss.reduce((n, s) => n + s.games.length, 0)
        const localAhead =
          gameCount(local.sessions) > gameCount(cloud.state.sessions) ||
          local.sessions.length > cloud.state.sessions.length ||
          local.ledger.length > (cloud.state.ledger ?? []).length
        if (localAhead && !window.confirm(
          '이 기기에 클라우드보다 많은 기록이 저장되어 있습니다.\n클라우드 데이터로 덮어쓰면 이 기기의 최근 기록이 사라질 수 있습니다.\n클라우드 데이터를 불러올까요?',
        )) return
        replaceAll(cloud.state)
        markSynced(cloud.updatedAt)
      })
      .catch(() => {})
      .finally(() => setSyncing(false))
  }, [memberId])

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

  if (syncing) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f3', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 28 }}>🎱</div>
        <div style={{ fontSize: 14, color: '#072B61', fontWeight: 500 }}>당신회</div>
        <div style={{ fontSize: 12, color: '#aaa' }}>데이터 동기화 중...</div>
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
