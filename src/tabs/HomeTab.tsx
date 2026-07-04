type Tab = 'members' | 'meeting' | 'dashboard' | 'settings'

interface Props {
  onNavigate: (tab: Tab) => void
}

export function HomeTab({ onNavigate }: Props) {
  const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL
  const logoSrc = base + 'ICON-SKKU.jpg'

  const menus: { tab: Tab; icon: string; label: string; desc: string }[] = [
    { tab: 'members',   icon: '👥', label: '회원',      desc: '에버리지 및 순위 조회' },
    { tab: 'meeting',   icon: '🎱', label: '모임',      desc: '경기 기록 및 결과 입력' },
    { tab: 'dashboard', icon: '📊', label: '대시보드',  desc: '승률 및 통계' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      <div style={{
        background: '#fff',
        padding: '40px 20px 28px',
        textAlign: 'center',
        borderBottom: '0.5px solid #e8e8e8',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 14 }}>
          <div style={{ flex: 1 }} />
          <img
            src={logoSrc}
            alt="성균관대학교 로고"
            style={{ flex: 3, maxWidth: '80%', height: 'auto', objectFit: 'contain' }}
          />
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ fontSize: 14, color: '#555', fontWeight: 400 }}>성균관대학교 부산동문</div>
        <div style={{ fontSize: 22, color: '#072B61', fontWeight: 600, marginTop: 2 }}>당신회</div>
      </div>

      <div style={{ flex: 1, padding: '28px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#fff' }}>
        <div style={{ display: 'flex', gap: 12 }}>
          {menus.map(({ tab, icon, label, desc }) => (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              style={{
                flex: 1,
                background: '#fff',
                border: '0.5px solid #e0e0e0',
                borderRadius: 14,
                padding: '20px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: '#E1F5EE',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26,
              }}>{icon}</div>
              <div style={{ fontWeight: 500, fontSize: 15, color: '#072B61' }}>{label}</div>
              <div style={{ fontSize: 11, color: '#888', lineHeight: 1.3 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
