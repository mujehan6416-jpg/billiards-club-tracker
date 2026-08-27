import { useEffect, useState } from 'react'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { TournamentTab } from '../tabs/TournamentTab'
import {
  buildTournamentDevMembers,
  buildDraftTournament, buildDraftTournamentParticipants,
  buildConfirmedTournament, buildConfirmedTournamentParticipants,
} from './tournamentDevSeed'

// 대회 토너먼트 4A(대회 생성·참가 신청·참가자 관리) 개발 전용 미리보기. main.tsx에서
// import.meta.env.DEV + ?devTournament=1 일 때만 로드된다. TournamentTab을 previewMode로
// 렌더링하므로 Firestore를 전혀 호출하지 않는다 — 모든 쓰기는 컴포넌트 로컬 state 시뮬레이션이다.
// 실제 useApp(회원) 저장소도 건드리지 않고, 가상 회원 10명(가상회원1~10)만 이 파일 안에서 쓴다.

const devMembers = buildTournamentDevMembers()
const draftTournament = buildDraftTournament()
const confirmedTournament = buildConfirmedTournament()

export default function DevTournamentPreview() {
  // 회원/관리자 화면을 둘 다 미리 볼 수 있도록 로컬 토글을 둔다(실제 로그인 흐름을 타지 않는다).
  const [viewAs, setViewAs] = useState<'member' | 'admin'>('member')

  const applyViewAs = (next: 'member' | 'admin') => {
    setViewAs(next)
    if (next === 'admin') {
      useAdmin.setState({ isAdmin: true })
      useAdminAuthStore.setState({
        status: 'authorizedAdmin', uid: 'dev-admin-uid', email: 'dev-admin@example.test',
        adminDisplayName: '가상관리자', errorMessage: null,
      })
      useAuth.setState({ memberId: 'dev-tm-1', memberName: '가상회원1', isGuest: false })
    } else {
      useAdmin.setState({ isAdmin: false })
      useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
      useAuth.setState({ memberId: 'dev-tm-5', memberName: '가상회원5', isGuest: false })
    }
  }

  useEffect(() => { applyViewAs('member') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <div style={{ background: '#fff3cd', color: '#7a5c00', padding: '10px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
        ⚠ 개발 미리보기입니다. 실제 Firestore에 저장되지 않고, 새로고침하면 내용이 사라집니다.
        <br />
        실제 회원 데이터는 사용되지 않습니다(가상회원1~10).
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
        <button className={viewAs === 'member' ? 'primary grow' : 'grow'} onClick={() => applyViewAs('member')}>
          👤 회원(가상회원5)으로 보기
        </button>
        <button className={viewAs === 'admin' ? 'primary grow' : 'grow'} onClick={() => applyViewAs('admin')}>
          🔑 관리자로 보기
        </button>
      </div>
      <div className="app-main" style={{ paddingBottom: 24 }}>
        <TournamentTab
          previewMode
          devMembers={devMembers}
          devTournaments={[draftTournament, confirmedTournament]}
          devParticipants={{
            [draftTournament.id]: buildDraftTournamentParticipants(devMembers),
            [confirmedTournament.id]: buildConfirmedTournamentParticipants(devMembers),
          }}
        />
      </div>
    </div>
  )
}
