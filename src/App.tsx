import { useState } from 'react'
import { MembersTab } from './tabs/MembersTab'
import { MeetingTab } from './tabs/MeetingTab'
import { DashboardTab } from './tabs/DashboardTab'
import { SettingsTab } from './tabs/SettingsTab'

type Tab = 'members' | 'meeting' | 'dashboard' | 'settings'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'members', label: '회원', icon: '👥' },
  { key: 'meeting', label: '모임', icon: '🎱' },
  { key: 'dashboard', label: '대시보드', icon: '📊' },
  { key: 'settings', label: '설정', icon: '⚙️' },
]

export function App() {
  const [tab, setTab] = useState<Tab>('meeting')
  return (
    <div className="app">
      <main className="app-main">
        {tab === 'members' && <MembersTab />}
        {tab === 'meeting' && <MeetingTab />}
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'settings' && <SettingsTab />}
      </main>
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="nav-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span className="nav-label">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
