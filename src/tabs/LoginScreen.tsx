import { useState } from 'react'
import type { Member } from '../types'

interface Props {
  members: Member[]
  onLogin: (id: string, name: string) => void
}

export function LoginScreen({ members, onLogin }: Props) {
  const active = [...members.filter((m) => m.active)].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const logoSrc = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL + 'ICON-SKKU.jpg'

  const tryLogin = () => {
    const member = active.find((m) => m.name === name)
    if (!member) { setError('이름을 선택해 주세요.'); return }
    const pw = member.password ?? '0000'
    if (password !== pw) { setError('비밀번호가 틀렸습니다.'); return }
    onLogin(member.id, member.name)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: '24px 20px',
    }}>
      <div style={{ display: 'flex', width: '100%', maxWidth: 360, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        <div style={{ flex: 1 }} />
        <img src={logoSrc} alt="로고" style={{ flex: 3, maxWidth: '120%', height: 'auto', objectFit: 'contain' }} />
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>성균관대학교 부산동문</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: '#072B61', marginBottom: 28 }}>당신회</div>

      <div style={{
        background: '#fff', borderRadius: 16, padding: '24px 20px',
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
    </div>
  )
}
