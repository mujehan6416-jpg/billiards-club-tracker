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

function AdminBanner() {
  const { isAdmin, logout } = useAdmin()
  if (!isAdmin) return null
  return (
    <div style={{
      background: '#0f6e56', color: '#fff', fontSize: 12,
      padding: '5px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    }}>
      <span>🔑 관리자 모드</span>
      <button
        onClick={logout}
        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.5)', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
      >
        로그아웃
      </button>
    </div>
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
