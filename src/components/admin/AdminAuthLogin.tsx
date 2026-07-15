import { useState } from 'react'
import { useAdminAuthStore } from '../../store/adminAuthStore'

const STATUS_LABEL: Record<string, string> = {
  loading: '확인 중...',
  unauthenticated: '로그인 필요',
  authenticated: '권한 확인 중...',
  authorizedAdmin: '관리자 인증됨',
  authError: '관리자 권한 없음',
}

/**
 * 관리자 전용 Firebase Auth 로그인 화면. 일반 회원 로그인(LoginScreen)과는 완전히 별개다.
 * 기존 관리자 PIN(adminStore)을 대체하지 않는다 — Firebase Auth는 서버(Firestore) 권한 확인용이고,
 * PIN은 이 로그인과 별도로 관리자 화면 진입·확정/취소 등 민감 작업의 2차 확인용으로 계속 쓴다.
 */
export function AdminAuthLogin() {
  const status = useAdminAuthStore((s) => s.status)
  const email = useAdminAuthStore((s) => s.email)
  const adminDisplayName = useAdminAuthStore((s) => s.adminDisplayName)
  const errorMessage = useAdminAuthStore((s) => s.errorMessage)
  const signIn = useAdminAuthStore((s) => s.signIn)
  const signOutAdmin = useAdminAuthStore((s) => s.signOutAdmin)

  const [inputEmail, setInputEmail] = useState('')
  const [inputPassword, setInputPassword] = useState('')

  return (
    <div className="card col-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>🔐 관리자 Firebase 로그인</span>
        <span
          style={{
            fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
            color: status === 'authorizedAdmin' ? '#0f6e56' : status === 'authError' ? '#c0392b' : '#888',
            background: status === 'authorizedAdmin' ? '#e1f5ee' : status === 'authError' ? '#fdeceb' : '#f0f0f0',
          }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {(status === 'unauthenticated' || status === 'authError') && (
        <>
          <input type="email" placeholder="관리자 이메일" value={inputEmail} onChange={(e) => setInputEmail(e.target.value)} />
          <input type="password" placeholder="비밀번호" value={inputPassword} onChange={(e) => setInputPassword(e.target.value)} />
          <button type="button" className="primary block" onClick={() => signIn(inputEmail, inputPassword)}>로그인</button>
        </>
      )}

      {errorMessage && <p className="info-msg" style={{ background: '#fdeceb', color: '#c0392b' }}>{errorMessage}</p>}

      {(status === 'authenticated' || status === 'authorizedAdmin' || status === 'authError') && email && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>
            {email}{adminDisplayName ? ` · ${adminDisplayName}` : ''}
          </span>
          <button type="button" onClick={() => signOutAdmin()}>로그아웃</button>
        </div>
      )}
    </div>
  )
}
