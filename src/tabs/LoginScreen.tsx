import { useState } from 'react'
import type { Member } from '../types'

interface Props {
  members: Member[]
  onLogin: (id: string, name: string) => void
  onAdminLogin?: (pin: string) => boolean
}

export function LoginScreen({ members, onLogin, onAdminLogin }: Props) {
  const active = [...members.filter((m) => m.active)].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showAdminModal, setShowAdminModal] = useState(false)
  const [adminPin, setAdminPin] = useState('')
  const [adminError, setAdminError] = useState(false)

  const logoSrc = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL + 'ICON-SKKU.jpg'

  const tryLogin = () => {
    const member = active.find((m) => m.name === name)
    if (!member) { setError('이름을 선택해 주세요.'); return }
    const pw = member.password ?? '0000'
    if (password !== pw) { setError('비밀번호가 틀렸습니다.'); return }
    onLogin(member.id, member.name)
  }

  const tryAdminLogin = () => {
    if (onAdminLogin?.(adminPin)) {
      setShowAdminModal(false)
    } else {
      setAdminError(true)
      setAdminPin('')
    }
  }

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: '16px 20px',
      position: 'relative', gap: 8,
    }}>
      {/* 관리자 아이콘 — 우상단 */}
      <button
        onClick={() => { setShowAdminModal(true); setAdminPin(''); setAdminError(false) }}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: 22, padding: 6, color: '#aaa',
          lineHeight: 1,
        }}
        title="관리자 로그인"
      >
        ⚙️
      </button>

      {/* 로고 */}
      <img src={logoSrc} alt="로고" style={{ width: '150%', maxWidth: 720, height: 'auto', objectFit: 'contain' }} />

      {/* 로그인 카드 */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '20px 20px',
        width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
        border: '0.5px solid #e0e0e0',
      }}>
        <select
          value={name}
          onChange={(e) => { setName(e.target.value); setError('') }}
          style={{ width: '100%' }}
        >
          <option value="">이름 선택</option>
          {active.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>

        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && tryLogin()}
          style={{ width: '100%' }}
        />

        {error && <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>}

        <button className="primary block" onClick={tryLogin}>로그인</button>
      </div>

      {/* 클럽명 */}
      <div style={{ fontSize: 26, color: '#555' }}>성균관대학교 부산동문</div>
      <div style={{ fontSize: 36, fontWeight: 700, color: '#072B61' }}>당신회</div>

      {/* 관리자 PIN 모달 */}
      {showAdminModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowAdminModal(false)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 16, padding: '28px 24px',
              width: 280, display: 'flex', flexDirection: 'column', gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontWeight: 700, fontSize: 16, textAlign: 'center' }}>🔑 관리자 로그인</span>
            <input
              type="password"
              placeholder="PIN 입력"
              value={adminPin}
              autoFocus
              onChange={(e) => { setAdminPin(e.target.value); setAdminError(false) }}
              onKeyDown={(e) => e.key === 'Enter' && tryAdminLogin()}
              style={{ width: '100%' }}
            />
            {adminError && <span style={{ fontSize: 13, color: '#c0392b' }}>PIN이 틀렸습니다.</span>}
            <button className="primary block" onClick={tryAdminLogin}>로그인</button>
            <button className="block" onClick={() => setShowAdminModal(false)}>취소</button>
          </div>
        </div>
      )}
    </div>
  )
}
