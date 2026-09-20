import { NoticeBoard } from '../components/notice/NoticeBoard'

type Tab = 'members' | 'meeting' | 'dashboard' | 'settings' | 'tournament'

interface Props {
  onNavigate: (tab: Tab) => void
}

export function HomeTab({ onNavigate }: Props) {
  const menus: { tab: Tab; icon: string; label: string; desc: string }[] = [
    { tab: 'members',    icon: '👥', label: '회원',      desc: '에버리지 및 순위 조회' },
    { tab: 'meeting',    icon: '🎱', label: '모임',      desc: '경기 기록 및 결과 입력' },
    { tab: 'dashboard',  icon: '📊', label: '통계',      desc: '승률 및 통계' },
    { tab: 'tournament', icon: '🏆', label: '대회',      desc: '대회 참가 및 관리' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: '#fff' }}>
      {/* 예전에는 이 자리에 학교 로고 이미지가 있었다. 지금은 모임 공지 게시판을 둔다 —
          홈을 열자마자 새 공지를 바로 보게 하는 것이 목적이고, 바깥 서비스와 연동하거나
          데이터를 주고받지는 않는다(공지는 이 앱의 Firestore 경로에만 저장된다). */}
      <div style={{
        background: '#fff',
        padding: '20px 16px 18px',
        borderBottom: '0.5px solid #e8e8e8',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 13, color: '#555', textAlign: 'center' }}>성균관대학교 부산동문</div>
        <div style={{ fontSize: 20, color: '#072B61', fontWeight: 600, marginTop: 2, marginBottom: 14, textAlign: 'center' }}>당신회</div>
        <NoticeBoard />
      </div>

      <div style={{ flex: 1, padding: '24px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {menus.map(({ tab, icon, label, desc }) => (
            <button
              key={tab}
              onClick={() => onNavigate(tab)}
              style={{
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
