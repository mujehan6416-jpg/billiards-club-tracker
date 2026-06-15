import { useEffect, useState } from 'react'
import { MembersTab } from './tabs/MembersTab'
import { MeetingTab } from './tabs/MeetingTab'
import { DashboardTab } from './tabs/DashboardTab'
import { SettingsTab } from './tabs/SettingsTab'
import { HomeTab } from './tabs/HomeTab'
import { LoginScreen } from './tabs/LoginScreen'
import { useAdmin } from './store/adminStore'
import { useAuth } from './store/authStore'
import { useApp } from './store/appStore'
import { downloadFromCloud } from './lib/cloudSync'

type Tab = 'home' | 'members' | 'meeting' | 'dashboard' | 'settings'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'home',      label: '홈',       icon: '🏠' },
  { key: 'members',   label: '회원',     icon: '👥' },
  { key: 'meeting',   label: '모임',     icon: '🎱' },
  { key: 'dashboard', label: '대시보드', icon: '📊' },
  { key: 'settings',  label: '설정',     icon: '⚙️' },
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

function TopBar() {
  const { isAdmin, logout: adminLogout } = useAdmin()
  const { memberName } = useAuth()
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
  const { memberId, logout: memberLogout } = useAuth()
  const members = useApp((s) => s.members)
  const replaceAll = useApp((s) => s.replaceAll)
  const { login } = useAuth()

  useEffect(() => {
    downloadFromCloud()
      .then((state) => { if (state) replaceAll(state) })
      .catch(() => {})
      .finally(() => setSyncing(false))
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
    return <LoginScreen members={members} onLogin={login} />
  }

  return (
    <div className="app">
      <TopBar />
      <main className="app-main">
        {tab === 'home'      && <HomeTab onNavigate={setTab} />}
        {tab === 'members'   && <MembersTab />}
        {tab === 'meeting'   && <MeetingTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'settings'  && <SettingsTab />}
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="nav-icon" aria-hidden="true">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
        <button onClick={() => { if (window.confirm('앱을 종료할까요?')) memberLogout() }}>
          <span className="nav-icon" aria-hidden="true">⏻</span>
          <span className="nav-label">종료</span>
        </button>
      </nav>
    </div>
  )
}
