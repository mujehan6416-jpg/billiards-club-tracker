import { useState } from 'react'
import { MembersTab } from './tabs/MembersTab'
import { MeetingTab } from './tabs/MeetingTab'
import { DashboardTab } from './tabs/DashboardTab'
import { SettingsTab } from './tabs/SettingsTab'
import { useAdmin } from './store/adminStore'

type Tab = 'members' | 'meeting' | 'dashboard' | 'settings'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'members', label: '회원', icon: '👥' },
  { key: 'meeting', label: '모임', icon: '🎱' },
  { key: 'dashboard', label: '대시보드', icon: '📊' },
  { key: 'settings', label: '설정', icon: '⚙️' },
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
        background: 'var(--color-bg, #fff)', borderRadius: 12, padding: '24px 20px',
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

function AdminBanner() {
  const { isAdmin, logout } = useAdmin()
  const [showPin, setShowPin] = useState(false)
  if (!isAdmin) return null
  return (
    <>
      <div style={{
        background: '#0f6e56', color: '#fff', fontSize: 12,
        padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span>🔑 관리자 모드</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowPin(true)}
            title="PIN 변경"
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 13, padding: '2px 7px', borderRadius: 4, lineHeight: 1 }}
          >🔒</button>
          <button
            onClick={logout}
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
          >로그아웃</button>
        </div>
      </div>
      {showPin && <PinModal onClose={() => setShowPin(false)} />}
    </>
  )
}

export function App() {
  const [tab, setTab] = useState<Tab>('meeting')
  return (
    <div className="app">
      <AdminBanner />
      <main className="app-main">
        {tab === 'members' && <MembersTab />}
        {tab === 'meeting' && <MeetingTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="nav-icon" aria-hidden="true">{t.icon}</span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
