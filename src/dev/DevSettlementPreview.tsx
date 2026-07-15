import { useEffect, useState } from 'react'
import { useSettlementStore } from '../store/settlementStore'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { SettlementTab } from '../tabs/SettlementTab'
import { SettlementSyncControls } from '../components/admin/SettlementSyncControls'
import { buildScenarioA, buildScenarioB, buildScenarioC, buildScenarioCMembers, buildScenarioCSession } from './settlementDevSeed'

// 개발 전용 임시 미리보기. main.tsx에서 import.meta.env.DEV + ?devSettlement=1 일 때만 로드된다.
// 실제 useApp(회원·모임) 저장소는 전혀 건드리지 않는다.
// useSettlementStore(메모리 전용)에 가상 시나리오 3건을 채워 넣고,
// 시나리오 C는 Member/Session 연결 흐름 검증용 가상 회원 8명·가상 세션 1건을 SettlementTab에 props로만 주입한다.
//
// ⚠ 아래 "Firestore 동기화 테스트" 패널은 기본으로 접혀 있고, 관리자로 실제 Firebase 로그인 후
// 버튼을 직접 눌러야만 실제 clubs/skkubc/settlements 컬렉션에 읽기/쓰기가 일어난다.
// 반드시 가상 정산(dev-scenario-*)에 대해서만 사용하고, 실제 회원 실명·회비·통장 잔액은 입력하지 않는다.
const devMembers = buildScenarioCMembers()
const devSession = buildScenarioCSession()

export default function DevSettlementPreview() {
  const [showSyncPanel, setShowSyncPanel] = useState(false)
  const currentId = useSettlementStore((s) => s.currentId)

  useEffect(() => {
    const { settlements } = useSettlementStore.getState()
    if (settlements.some((s) => s.id === 'dev-scenario-a')) return
    useSettlementStore.setState({
      settlements: [buildScenarioA(), buildScenarioB(), buildScenarioC()],
      currentId: 'dev-scenario-a',
    })
  }, [])

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  return (
    <div className="app">
      <div style={{ background: '#fff3cd', color: '#7a5c00', padding: '10px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
        ⚠ 개발 미리보기 상태입니다. 정산 편집 내용은 기본적으로 서버에 저장되지 않습니다.
        <br />
        새로고침하면 내용이 사라질 수 있습니다. (실제 회원 데이터는 사용되지 않습니다)
        <br />
        아래 "Firestore 동기화 테스트"를 열면 실제 Firebase 프로젝트와 통신합니다 — 가상 정산에만 사용하세요.
      </div>
      <div className="app-main" style={{ paddingBottom: 24 }}>
        <SettlementTab devMembers={devMembers} devSessions={[devSession]} />

        <div className="card">
          <button type="button" className="block" onClick={() => setShowSyncPanel((v) => !v)}>
            {showSyncPanel ? '☁ Firestore 동기화 테스트 닫기' : '☁ Firestore 동기화 테스트 열기 (실제 Firebase 통신 주의)'}
          </button>
        </div>
        {showSyncPanel && currentId && (
          <SettlementSyncControls settlementId={currentId} title="☁ Firestore 동기화 테스트 (가상 정산 전용)" />
        )}
        {showSyncPanel && !currentId && <p className="muted">먼저 위에서 정산을 선택하거나 생성해주세요.</p>}
      </div>
    </div>
  )
}
