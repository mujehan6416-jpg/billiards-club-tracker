import { useMemo, useState } from 'react'
import type { Member } from '../types'
import { buildMemberLabels } from '../logic/memberLabel'
import { AdminPinButton } from '../components/AdminPinButton'

interface Props {
  members: Member[]
  onLogin: (id: string, name: string) => void
  onAdminLogin?: (pin: string) => boolean
}

// 마지막으로 로그인한 회원 (기기별 정보 — 앱 상태와 분리 저장)
// id가 기본 키, 이름은 클라우드 동기화 등으로 id가 바뀌었을 때의 예비 키
const LAST_LOGIN_KEY = 'billiards-last-login-id'
const LAST_LOGIN_NAME_KEY = 'billiards-last-login-name'

/**
 * 회원 화면 접근용 로그인 화면.
 *
 * 이 기기가 이미 회원-기기 연결(memberLinks)로 확인된 경우에는 App.tsx가 이 화면을 아예
 * 보여주지 않고 자동으로 로그인한다 — 실제 신뢰 경계는 그 연결(관리자 승인)에 있지,
 * 여기서 이름을 고르는 것 자체는 아니기 때문이다(비밀번호로 "본인 확인"을 흉내 내지 않는다).
 *
 * 그래서 이 화면은 두 경우에만 보인다: ① 이 기기가 아직 회원과 연결되지 않았지만 전체
 * 회원 목록을 읽을 수 있는 경우(예: 진짜 Firebase 관리자 기기인데 개인 연결이 없는 경우),
 * ② GUEST로 둘러보고 싶은 경우. 이름을 고르는 것은 순전히 "이 화면에 무엇을 표시할지"를
 * 정하는 것이고, 실제 쓰기 권한은 언제나 Firestore 규칙(연결된 활성 회원인지)이 정한다.
 */
export function LoginScreen({ members, onLogin, onAdminLogin }: Props) {
  const sorted = [...members.filter((m) => m.active)].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  // 마지막 로그인 회원이 활성 회원이면 리스트 맨 위로 (없으면 기존 정렬 그대로)
  const lastId = localStorage.getItem(LAST_LOGIN_KEY)
  const lastName = localStorage.getItem(LAST_LOGIN_NAME_KEY)
  const lastMember = sorted.find((m) => m.id === lastId)
    ?? (lastName ? sorted.find((m) => m.name === lastName) : undefined)
    ?? null
  const active = lastMember
    ? [lastMember, ...sorted.filter((m) => m.id !== lastMember.id)]
    : sorted
  // 선택값은 이름이 아니라 회원 고유 ID다 — 동명이인이 있어도 각자 본인으로 표시된다.
  const [selectedId, setSelectedId] = useState(lastMember?.id ?? '')
  const [error, setError] = useState('')

  const logoSrc = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL + 'ICON-SKKU.jpg'

  const isGuest = selectedId === '__guest__'
  // 동명이인이 있을 때만 구분정보를 덧붙인 이름표 (없으면 기존처럼 이름만)
  const labels = useMemo(() => buildMemberLabels(active), [active])

  const tryContinue = () => {
    if (isGuest) { onLogin('__guest__', 'GUEST'); return }
    const member = active.find((m) => m.id === selectedId)
    if (!member) { setError('이름을 선택해 주세요.'); return }
    localStorage.setItem(LAST_LOGIN_KEY, member.id)
    localStorage.setItem(LAST_LOGIN_NAME_KEY, member.name)
    onLogin(member.id, member.name)
  }

  return (
    <div style={{
      height: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#fff', padding: '4px 20px',
      position: 'relative', gap: 4,
    }}>
      <AdminPinButton onAdminLogin={onAdminLogin} />

      {/* 로고 */}
      <img src={logoSrc} alt="로고" style={{ width: '150%', maxWidth: 720, height: 'auto', objectFit: 'contain', marginBottom: '-21vw' }} />

      {/* 로그인 카드 */}
      <div style={{
        background: '#fff', borderRadius: 16, padding: '20px 20px',
        width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
        border: '0.5px solid #e0e0e0',
      }}>
        {lastMember && (
          <div style={{
            fontSize: 15, lineHeight: 1.5, color: '#072B61', background: '#eef3fb',
            borderRadius: 8, padding: '10px 12px',
          }}>
            👤 최근: <b>{labels.get(lastMember.id) ?? lastMember.name}</b>
          </div>
        )}
        <select
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); setError('') }}
          style={{ width: '100%' }}
        >
          <option value="">이름 선택</option>
          {active.map((m) => (
            <option key={m.id} value={m.id}>
              {labels.get(m.id) ?? m.name}{lastMember && m.id === lastMember.id ? ' (최근)' : ''}
            </option>
          ))}
          <option value="__guest__">GUEST</option>
        </select>

        {error && <span style={{ fontSize: 13, color: '#c0392b' }}>{error}</span>}

        <button className="primary block" onClick={tryContinue}>시작하기</button>
      </div>

      {/* 클럽명 */}
      <div style={{ fontSize: 26, color: '#555' }}>성균관대학교 부산동문</div>
      <div style={{ fontSize: 36, fontWeight: 700, color: '#072B61' }}>당신회</div>
    </div>
  )
}
