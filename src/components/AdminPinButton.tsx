import { useState } from 'react'

/**
 * 로그인류 화면(우상단) 공통 "관리자 로그인" 톱니바퀴 + PIN 모달.
 *
 * LoginScreen(이미 연결된 기기용)과 DeviceConnectScreen(아직 연결 안 된 기기용) 양쪽에서
 * 똑같이 쓰인다 — 관리자 PIN 입력은 회원 연결 여부와 무관하게 항상 접근 가능해야 한다.
 */
export function AdminPinButton({ onAdminLogin }: { onAdminLogin?: (pin: string) => boolean }) {
  const [showModal, setShowModal] = useState(false)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  if (!onAdminLogin) return null

  const tryLogin = () => {
    if (onAdminLogin(pin)) {
      setShowModal(false)
    } else {
      setError(true)
      setPin('')
    }
  }

  return (
    <>
      <button
        onClick={() => { setShowModal(true); setPin(''); setError(false) }}
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

      {showModal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowModal(false)}
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
              value={pin}
              autoFocus
              onChange={(e) => { setPin(e.target.value); setError(false) }}
              onKeyDown={(e) => e.key === 'Enter' && tryLogin()}
              style={{ width: '100%' }}
            />
            {error && <span style={{ fontSize: 13, color: '#c0392b' }}>PIN이 틀렸습니다.</span>}
            <button className="primary block" onClick={tryLogin}>로그인</button>
            <button className="block" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </div>
      )}
    </>
  )
}
