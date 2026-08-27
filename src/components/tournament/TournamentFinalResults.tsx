import { calculateFinalPlacements } from '../../logic/tournamentMatch'
import type { Tournament, TournamentMatch } from '../../types/tournament'

/**
 * 결승이 공식 확정되면 우승·준우승·공동 3위를 보여준다. 순위 자체는 순수 함수
 * calculateFinalPlacements(1단계에서 이미 구현·테스트됨)를 그대로 재사용한다.
 *
 * 대회 문서 상태(tournament.status)가 아직 'finished'가 아니어도, 결승 경기 자체가
 * 공식 확정되었으면 결과를 미리 보여줄 수 있다 — "대회 마감" 버튼은 관리자가 이 화면을
 * 보고 눌러야 나오는 별도 동작이다(마감 전에도 결과는 이미 사실이다).
 */
export function TournamentFinalResults({
  tournament, matches, nameOf, isAdmin, busy, onFinish,
}: {
  tournament: Tournament
  matches: TournamentMatch[]
  nameOf: (participantId: string | null) => string
  isAdmin: boolean
  busy?: boolean
  onFinish: () => void
}) {
  const placements = calculateFinalPlacements(matches)
  if (!placements.championParticipantId) return null

  return (
    <div className="card col-card" style={{ gap: 8 }}>
      <span style={{ fontWeight: 700, fontSize: 16 }}>🏆 대회 최종 결과</span>
      <span style={{ fontSize: 16, fontWeight: 700 }}>우승: {nameOf(placements.championParticipantId)}</span>
      <span style={{ fontSize: 15 }}>준우승: {nameOf(placements.runnerUpParticipantId)}</span>
      {placements.thirdPlaceParticipantIds.length > 0 && (
        <span style={{ fontSize: 15 }}>
          공동 3위: {placements.thirdPlaceParticipantIds.map((id) => nameOf(id)).join(', ')}
        </span>
      )}
      {isAdmin && tournament.status !== 'finished' && (
        <button
          className="primary block" style={{ fontSize: 15, padding: 12 }} disabled={busy}
          onClick={() => { if (window.confirm('대회를 최종 마감하시겠습니까? 마감 후에도 결과는 그대로 유지됩니다.')) onFinish() }}
        >
          대회 최종 마감
        </button>
      )}
      {tournament.status === 'finished' && (
        <span className="muted" style={{ fontSize: 13 }}>대회가 종료되었습니다.</span>
      )}
    </div>
  )
}
