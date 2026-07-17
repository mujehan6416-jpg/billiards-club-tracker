import { useEffect, useState } from 'react'
import { useSettlementStore } from '../store/settlementStore'
import { MemberSettlementSummary } from '../components/settlement/MemberSettlementSummary'
import { canRematchRound } from '../logic/matching'
import {
  devMeetingMembers, buildDemoLineup, buildInitialDemoGames,
  buildConfirmedSettlementSession, buildDraftSettlementSession, buildNoSettlementSession,
  buildConfirmedSettlementForMeeting, buildDraftSettlementForMeeting,
} from './meetingDevSeed'
import type { Game, Session } from '../types'

// 개발 전용 임시 미리보기. main.tsx에서 import.meta.env.DEV + ?devMeeting=1 일 때만 로드된다.
// 실제 useApp(회원·모임)·Firestore(cloudSync)를 전혀 건드리지 않는다 — 경기결과·재매칭·관리자
// 확인/수정요청은 전부 이 컴포넌트의 로컬 state로만 시뮬레이션한다(운영 저장 액션 미호출).
// 일반회원/관리자 "보기 전환"도 실제 로그인 화면(LoginScreen/AdminLogin)을 전혀 거치지 않고
// 화면 안의 버튼으로만 바뀐다 — 실제 회원 목록이 노출될 가능성 자체를 없앤다.
// 정산 공개 카드(MemberSettlementSummary)만 실제 컴포넌트를 그대로 재사용한다 — 이 컴포넌트는
// useSettlementStore(=persist 미적용, Firestore 미접근)만 읽으므로 안전하다.

const MEMBER_ID = 'dev-mem-1'
const nameOf = (id: string) => devMeetingMembers.find((m) => m.id === id)?.name ?? id

function findGame(games: Game[], round: number, aId: string, bId: string): Game | undefined {
  return games.find((g) => g.round === round &&
    ((g.playerAId === aId && g.playerBId === bId) || (g.playerAId === bId && g.playerBId === aId)))
}

const DEMO_LINEUP = buildDemoLineup()

const SETTLEMENT_SCENARIOS = [
  { key: 'confirmed', label: '확정됨', session: buildConfirmedSettlementSession() },
  { key: 'draft', label: '작성 중', session: buildDraftSettlementSession() },
  { key: 'none', label: '정산 없음', session: buildNoSettlementSession() },
] as const

function MatchScoreForm({ label, onSubmit, initialA, initialB }: {
  label: string; onSubmit: (scoreA: number, scoreB: number) => void; initialA?: number; initialB?: number
}) {
  const [a, setA] = useState(initialA !== undefined ? String(initialA) : '')
  const [b, setB] = useState(initialB !== undefined ? String(initialB) : '')
  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input inputMode="numeric" placeholder="내 득점" value={a} onChange={(e) => setA(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 72, fontSize: 16 }} />
        <span className="vs">vs</span>
        <input inputMode="numeric" placeholder="상대 득점" value={b} onChange={(e) => setB(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 72, fontSize: 16 }} />
      </div>
      <button type="button" className="primary" style={{ fontSize: 15, padding: 12 }}
        onClick={() => onSubmit(Math.max(0, parseInt(a || '0', 10) || 0), Math.max(0, parseInt(b || '0', 10) || 0))}>
        {label}
      </button>
    </>
  )
}

function MemberView({ games, submit }: { games: Game[]; submit: (round: number, aId: string, bId: string, scoreA: number, scoreB: number) => void }) {
  const myMatches = DEMO_LINEUP.filter((m) => m.aId === MEMBER_ID || m.bId === MEMBER_ID)
  return (
    <div className="col-card">
      <span style={{ fontWeight: 700, fontSize: 15 }}>내 경기 결과 (보는 사람: {nameOf(MEMBER_ID)})</span>
      {myMatches.map((m, i) => {
        const game = findGame(games, m.round, m.aId, m.bId)
        const opponentId = m.aId === MEMBER_ID ? m.bId : m.aId
        return (
          <div key={i} className="card col-card">
            <span className="muted" style={{ fontSize: 13 }}>{m.round}라운드 · vs {nameOf(opponentId)}</span>
            {!game ? (
              <MatchScoreForm label="결과 제출" onSubmit={(a, b) => submit(m.round, m.aId, m.bId, a, b)} />
            ) : game.pending && game.revisionRequested ? (
              <>
                <span style={{ fontSize: 14, color: '#c0392b', fontWeight: 600 }}>✏️ 관리자가 수정을 요청했습니다. 결과를 다시 입력해주세요.</span>
                <MatchScoreForm label="결과 다시 제출" initialA={game.playerAId === m.aId ? game.scoreA : game.scoreB} initialB={game.playerAId === m.aId ? game.scoreB : game.scoreA}
                  onSubmit={(a, b) => submit(m.round, m.aId, m.bId, a, b)} />
              </>
            ) : game.pending ? (
              <span style={{ fontSize: 14, color: '#856404', fontWeight: 600 }}>⏳ 관리자 확인 필요 — 제출한 결과 {game.scoreA} : {game.scoreB}</span>
            ) : (
              <span style={{ fontSize: 14, color: '#0f6e56', fontWeight: 600 }}>✅ 확정됨 — {game.scoreA} : {game.scoreB}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AdminView({ games, confirmGame, requestRevision, resetGames }: {
  games: Game[]
  confirmGame: (id: string) => void
  requestRevision: (id: string) => void
  resetGames: () => void
}) {
  const pendingGames = games.filter((g) => g.pending)
  const fakeSession = { games } as unknown as Session
  const round1Locked = !canRematchRound(fakeSession, 1)
  const round2Locked = !canRematchRound(fakeSession, 2)

  return (
    <div className="col-card">
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>📤 경기결과 승인 대기 ({pendingGames.length}건)</span>
        {pendingGames.length === 0 && <p className="muted">승인 대기 중인 결과가 없습니다.</p>}
        {pendingGames.map((g) => (
          <div key={g.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
              {g.round}라운드 — {nameOf(g.playerAId)} {g.scoreA} : {g.scoreB} {nameOf(g.playerBId)}
              {g.revisionRequested && (
                <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 3, background: '#fdeceb', color: '#c0392b', fontWeight: 600 }}>
                  수정 요청됨 — 참가자 재제출 대기
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="primary" style={{ fontSize: 12 }} onClick={() => confirmGame(g.id)}>확인 완료</button>
              <button style={{ fontSize: 12 }} disabled={g.revisionRequested} onClick={() => requestRevision(g.id)}>
                {g.revisionRequested ? '수정 요청됨' : '수정 요청'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>완료된 경기</span>
        {games.length === 0 && <p className="muted">등록된 경기 결과가 없습니다.</p>}
        {[1, 2].map((round) => {
          const rows = games.filter((g) => g.round === round)
          if (rows.length === 0) return null
          return (
            <div key={round}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#072B61', margin: '6px 0 4px' }}>{round}라운드</div>
              {rows.map((g) => (
                <div key={g.id} className="muted" style={{ fontSize: 13 }}>
                  {nameOf(g.playerAId)} {g.scoreA} : {g.scoreB} {nameOf(g.playerBId)}
                  {g.pending && <span style={{ marginLeft: 6, color: '#856404' }}>(승인대기)</span>}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>1·2라운드 재매칭</span>
        <button className="block" style={{ fontSize: 16, padding: 13 }} disabled={round1Locked}>🔀 1라운드 자동매칭</button>
        {round1Locked && <p className="muted" style={{ fontSize: 13, color: '#c0392b' }}>이미 1라운드 결과가 있어 재매칭할 수 없습니다.</p>}
        <button className="block" style={{ fontSize: 16, padding: 13 }} disabled={round2Locked}>🔀 2라운드 자동매칭</button>
        {round2Locked && <p className="muted" style={{ fontSize: 13, color: '#c0392b' }}>이미 2라운드 결과가 있어 재매칭할 수 없습니다.</p>}
        <button type="button" onClick={resetGames} style={{ fontSize: 13 }}>결과 초기화 (재매칭 가능 상태 보기)</button>
      </div>
    </div>
  )
}

export default function DevMeetingPreview() {
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [games, setGames] = useState<Game[]>(buildInitialDemoGames())
  const [scenario, setScenario] = useState<(typeof SETTLEMENT_SCENARIOS)[number]['key']>('confirmed')

  useEffect(() => {
    useSettlementStore.setState({
      settlements: [buildConfirmedSettlementForMeeting(), buildDraftSettlementForMeeting()],
      currentId: null, syncStatus: 'idle', lastSyncError: null,
    })
  }, [])

  const submit = (round: number, aId: string, bId: string, scoreA: number, scoreB: number) => {
    setGames((prev) => {
      const existing = findGame(prev, round, aId, bId)
      if (existing) {
        return prev.map((g) => g.id === existing.id
          ? { ...g, scoreA: g.playerAId === aId ? scoreA : scoreB, scoreB: g.playerAId === aId ? scoreB : scoreA, pending: true, revisionRequested: false }
          : g)
      }
      return [...prev, {
        id: `dev-g-${Date.now()}`, playerAId: aId, playerBId: bId, handicapA: 20, handicapB: 20,
        scoreA, scoreB, endType: 'time' as const, playedAt: new Date().toISOString(), round, pending: true,
      }]
    })
  }
  const confirmGame = (id: string) => setGames((prev) => prev.map((g) => g.id === id ? { ...g, pending: false, revisionRequested: false } : g))
  const requestRevision = (id: string) => setGames((prev) => prev.map((g) => g.id === id ? { ...g, pending: true, revisionRequested: true } : g))
  const resetGames = () => setGames([])

  const activeScenario = SETTLEMENT_SCENARIOS.find((s) => s.key === scenario)!

  return (
    <div className="app">
      <div style={{ background: '#fff3cd', color: '#7a5c00', padding: '10px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
        ⚠ 개발 미리보기 상태입니다 — 전부 가상 데이터이며 실제 저장·전송은 절대 일어나지 않습니다.
        <br />
        실제 회원 로그인 화면으로 이동하지 않고, 아래 버튼으로만 "일반회원/관리자" 보기를 바꿉니다.
      </div>

      <div className="app-main" style={{ paddingBottom: 24 }}>
        <div className="card col-card">
          <span style={{ fontWeight: 700 }}>보기 전환</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={role === 'member' ? 'primary grow' : 'grow'} onClick={() => setRole('member')}>일반회원({nameOf(MEMBER_ID)})</button>
            <button className={role === 'admin' ? 'primary grow' : 'grow'} onClick={() => setRole('admin')}>관리자</button>
          </div>
        </div>

        {role === 'member' && <MemberView games={games} submit={submit} />}
        {role === 'admin' && <AdminView games={games} confirmGame={confirmGame} requestRevision={requestRevision} resetGames={resetGames} />}

        <div className="card col-card">
          <span style={{ fontWeight: 700 }}>일반회원 확정 정산 공개 — 정산 상태 시나리오</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {SETTLEMENT_SCENARIOS.map((s) => (
              <button key={s.key} className={scenario === s.key ? 'primary grow' : 'grow'} onClick={() => setScenario(s.key)}>{s.label}</button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            confirmed일 때만 아래 카드가 보여야 하고, draft·없음일 때는 카드 자체가 안 보여야 합니다.
            (실제 운영에서는 Firestore 규칙상 일반회원이 정산을 읽을 수 없어 이 카드가 뜨지 않습니다 — 여기서는 UI만 가상 데이터로 확인합니다.)
          </p>
          {role === 'member' && <MemberSettlementSummary session={activeScenario.session} />}
          {role === 'admin' && <p className="muted" style={{ fontSize: 13 }}>일반회원 화면에서만 표시됩니다 — "일반회원" 보기로 전환해 확인하세요.</p>}
        </div>
      </div>
    </div>
  )
}
