import { useState } from 'react'
import { useApp } from '../../store/appStore'
import { uploadToCloud, UploadCancelledError } from '../../lib/cloudSync'
import type { Game, LineupMatch, Member, Session } from '../../types'

// 정기모임 참가자 본인 경기 결과 입력 — 관리자가 아닌 일반회원 전용 UI.
// 보안 주의: 이 화면의 "참가자 본인만 입력 가능" 제한은 클라이언트 UI 수준일 뿐이다.
// 일반회원 로그인은 Firebase Auth가 아니라 로컬 이름 선택 방식이라(src/store/authStore.ts),
// Firestore 보안 규칙으로 "진짜 본인"임을 서버에서 강제할 방법이 없다. 실제 신뢰 경계는
// "이 모임 관리자만 확정한다"는 관리자 확인 절차(SettingsTab의 확인완료/수정요청)에 있다.

/** 같은 라운드·같은 두 선수(순서 무관)로 이미 저장된 경기가 있으면 그 게임을 반환한다. */
function findGameForMatch(games: Game[], match: LineupMatch): Game | undefined {
  return games.find((g) => g.round === match.round &&
    ((g.playerAId === match.aId && g.playerBId === match.bId) || (g.playerAId === match.bId && g.playerBId === match.aId)))
}

function MatchResultRow({ session, match, game, opponentName }: {
  session: Session
  match: LineupMatch
  game?: Game
  opponentName: string
}) {
  const addGame = useApp((s) => s.addGame)
  const resubmitGameResult = useApp((s) => s.resubmitGameResult)
  const [scoreA, setScoreA] = useState(String(game?.scoreA ?? ''))
  const [scoreB, setScoreB] = useState(String(game?.scoreB ?? ''))
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const sA = Math.max(0, parseInt(scoreA || '0', 10) || 0)
    const sB = Math.max(0, parseInt(scoreB || '0', 10) || 0)
    if (sA > match.handicapA || sB > match.handicapB) {
      alert('오류: 핸디보다 많은 점수 입력')
      return
    }
    const endType: Game['endType'] = sA >= match.handicapA || sB >= match.handicapB ? 'cleared' : 'time'
    setSaving(true)
    if (game) {
      resubmitGameResult(session.id, game.id, { scoreA: sA, scoreB: sB, endType })
    } else {
      addGame(session.id, {
        playerAId: match.aId, playerBId: match.bId,
        handicapA: match.handicapA, handicapB: match.handicapB,
        scoreA: sA, scoreB: sB, endType, round: match.round,
        pending: true, // 일반회원이 직접 입력한 정기모임 결과는 항상 관리자 확인 대기로 저장한다.
      })
    }
    // 번개모임 회원 입력과 동일하게, 저장 직후 클라우드에 반영한다.
    const st = useApp.getState()
    try {
      await uploadToCloud({ members: st.members, sessions: st.sessions, settings: st.settings, ledger: st.ledger })
    } catch (err) {
      if (!(err instanceof UploadCancelledError)) {
        alert('결과는 이 기기에 저장되었지만 클라우드 동기화에 실패했습니다.\n네트워크 확인 후 다시 시도해주세요.')
      }
    }
    setSaving(false)
  }

  const inputForm = (submitLabel: string) => (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input inputMode="numeric" placeholder="내 득점" value={scoreA}
          onChange={(e) => setScoreA(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 72, fontSize: 16 }} />
        <span className="vs">vs</span>
        <input inputMode="numeric" placeholder="상대 득점" value={scoreB}
          onChange={(e) => setScoreB(e.target.value.replace(/[^0-9]/g, ''))} style={{ width: 72, fontSize: 16 }} />
      </div>
      <button type="button" className="primary" disabled={saving} onClick={submit} style={{ fontSize: 15, padding: 12 }}>
        {saving ? '저장 중...' : submitLabel}
      </button>
    </>
  )

  return (
    <div className="card col-card">
      <span className="muted" style={{ fontSize: 13 }}>{match.round}라운드 · vs {opponentName}</span>
      {!game ? (
        inputForm('결과 제출')
      ) : game.pending && game.revisionRequested ? (
        <>
          <span style={{ fontSize: 14, color: '#c0392b', fontWeight: 600 }}>
            ✏️ 관리자가 수정을 요청했습니다. 결과를 다시 입력해주세요.
          </span>
          {inputForm('결과 다시 제출')}
        </>
      ) : game.pending ? (
        <span style={{ fontSize: 14, color: '#856404', fontWeight: 600 }}>
          ⏳ 관리자 확인 필요 — 제출한 결과 {game.scoreA} : {game.scoreB}
        </span>
      ) : (
        <span style={{ fontSize: 14, color: '#0f6e56', fontWeight: 600 }}>
          ✅ 확정됨 — {game.scoreA} : {game.scoreB}
        </span>
      )}
    </div>
  )
}

/**
 * 정기모임에서 로그인한 회원 본인이 참가자인 경기만 골라 결과 입력/상태 표시를 제공한다.
 * 게시된 대진표(session.lineup)에 본인이 없으면 아무것도 렌더링하지 않는다.
 */
export function MemberGameResultEntry({ session, members, memberId }: {
  session: Session
  members: Member[]
  memberId: string
}) {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? '알수없음'
  const myMatches = (session.lineup ?? []).filter((m) => m.aId === memberId || m.bId === memberId)
  if (myMatches.length === 0) return null

  return (
    <div className="col-card">
      <span style={{ fontWeight: 700, fontSize: 15 }}>내 경기 결과</span>
      {myMatches.map((m, i) => {
        const game = findGameForMatch(session.games, m)
        const opponentId = m.aId === memberId ? m.bId : m.aId
        return <MatchResultRow key={`${m.round}-${i}`} session={session} match={m} game={game} opponentName={name(opponentId)} />
      })}
    </div>
  )
}
