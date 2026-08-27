import { useEffect, useState } from 'react'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { TournamentTab } from '../tabs/TournamentTab'
import type { Tournament, TournamentDrawMapping, TournamentMatch, TournamentParticipant } from '../types/tournament'
import {
  buildTournamentDevMembers,
  buildDraftTournament, buildDraftTournamentParticipants,
  buildConfirmedTournament, buildConfirmedTournamentParticipants,
  buildScenarioA, buildScenarioB, buildScenarioC, buildScenarioD, buildScenarioE, buildScenarioG,
  buildScenarioH, buildScenarioI, buildScenarioJ, buildScenarioK, buildScenarioL, buildScenarioM,
  buildScenarioN, buildScenarioO,
} from './tournamentDevSeed'

// 대회 토너먼트 4A·4B(대회 생성부터 대진 확정까지) 개발 전용 미리보기. main.tsx에서
// import.meta.env.DEV + ?devTournament=1 일 때만 로드된다. TournamentTab을 previewMode로
// 렌더링하므로 Firestore를 전혀 호출하지 않는다 — 모든 쓰기는 컴포넌트 로컬 state 시뮬레이션이다.
// 실제 useApp(회원) 저장소도 건드리지 않고, 가상 회원 16명(가상회원1~16)만 이 파일 안에서 쓴다.

const devMembers = buildTournamentDevMembers()

const draftTournament = buildDraftTournament()
const confirmedTournament = buildConfirmedTournament()
const scenarioA = buildScenarioA() // 8명 → 8강, 부전승 없음
const scenarioB = buildScenarioB() // 11명 → 16강, 부전승 5
const scenarioC = buildScenarioC() // 16명 → 16강, 부전승 없음
const scenarioD = buildScenarioD() // 추첨 준비 완료, 번호 일부만 입력
const scenarioE = buildScenarioE() // 추첨 준비 완료, 번호 전부 입력(대진표 확인 가능)
const scenarioG = buildScenarioG() // 대진 확정 완료(대진 확정 취소 가능 상태 겸용)
const scenarioH = buildScenarioH() // 결과 입력됨, 상대 확인 대기
const scenarioI = buildScenarioI() // 상대 확인까지 끝남, 관리자 승인 대기
const scenarioJ = buildScenarioJ() // 관리자 직권 확인, 관리자 승인 대기
const scenarioK = buildScenarioK() // 상대가 수정 요청
const scenarioL = buildScenarioL() // 달성률 동률, 관리자가 승자 지정 필요
const scenarioM = buildScenarioM() // 4강 한쪽만 확정
const scenarioN = buildScenarioN() // 4강 양쪽 확정(정상 진행 가능)
const scenarioO = buildScenarioO() // 대회 종료(최종 결과 화면)

const allTournaments: Tournament[] = [
  draftTournament, confirmedTournament,
  scenarioA.tournament, scenarioB.tournament, scenarioC.tournament,
  scenarioD.tournament, scenarioE.tournament, scenarioG.tournament,
  scenarioH.tournament, scenarioI.tournament, scenarioJ.tournament, scenarioK.tournament,
  scenarioL.tournament, scenarioM.tournament, scenarioN.tournament, scenarioO.tournament,
]

const initialParticipants: Record<string, TournamentParticipant[]> = {
  [draftTournament.id]: buildDraftTournamentParticipants(devMembers),
  [confirmedTournament.id]: buildConfirmedTournamentParticipants(devMembers),
  [scenarioA.tournament.id]: scenarioA.participants,
  [scenarioB.tournament.id]: scenarioB.participants,
  [scenarioC.tournament.id]: scenarioC.participants,
  [scenarioD.tournament.id]: scenarioD.participants,
  [scenarioE.tournament.id]: scenarioE.participants,
  [scenarioG.tournament.id]: scenarioG.participants,
  [scenarioH.tournament.id]: scenarioH.participants,
  [scenarioI.tournament.id]: scenarioI.participants,
  [scenarioJ.tournament.id]: scenarioJ.participants,
  [scenarioK.tournament.id]: scenarioK.participants,
  [scenarioL.tournament.id]: scenarioL.participants,
  [scenarioM.tournament.id]: scenarioM.participants,
  [scenarioN.tournament.id]: scenarioN.participants,
  [scenarioO.tournament.id]: scenarioO.participants,
}

const initialMatches: Record<string, TournamentMatch[]> = {
  [scenarioG.tournament.id]: scenarioG.matches,
  [scenarioH.tournament.id]: scenarioH.matches,
  [scenarioI.tournament.id]: scenarioI.matches,
  [scenarioJ.tournament.id]: scenarioJ.matches,
  [scenarioK.tournament.id]: scenarioK.matches,
  [scenarioL.tournament.id]: scenarioL.matches,
  [scenarioM.tournament.id]: scenarioM.matches,
  [scenarioN.tournament.id]: scenarioN.matches,
  [scenarioO.tournament.id]: scenarioO.matches,
}

const initialDrawMappings: Record<string, TournamentDrawMapping> = {
  [scenarioD.tournament.id]: scenarioD.drawMapping,
  [scenarioE.tournament.id]: scenarioE.drawMapping,
}

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
        실제 회원 데이터는 사용되지 않습니다(가상회원1~16). 시나리오 A~O는 각각 별도 대회로 들어 있습니다
        (H~O: 경기 결과 입력·확인·관리자 승인·다음 라운드 진출·대회 종료 흐름).
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
          devTournaments={allTournaments}
          devParticipants={initialParticipants}
          devMatches={initialMatches}
          devDrawMappings={initialDrawMappings}
        />
      </div>
    </div>
  )
}
