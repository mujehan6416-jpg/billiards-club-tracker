import type { Tournament, TournamentParticipant } from '../../types/tournament'

/**
 * 회원 본인의 참가/불참 카드. 대회 목록에서 대회를 선택하면 관리자 화면보다 먼저 보여준다.
 *
 * 서버 권한은 Firestore 규칙(participants 블록의 memberSetsOwnEntryStatus)이 강제한다 —
 * 여기서 버튼을 숨기거나 비활성화하는 것은 사용자 경험을 위한 것이지 보안 경계가 아니다.
 */
export function TournamentEntryCard({ tournament, participant, onSetEntryStatus, busy }: {
  tournament: Tournament
  participant: TournamentParticipant | undefined
  onSetEntryStatus: (status: 'entered' | 'declined') => void
  busy?: boolean
}) {
  const acceptingEntries = tournament.status === 'draft'

  if (!participant) {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>
          아직 참가자 명단에 등록되지 않았습니다. 참가를 원하시면 관리자에게 알려 주세요.
        </span>
      </div>
    )
  }

  const handicapLine = participant.tournamentHandicap !== participant.baseHandicapSnapshot
    ? `대회 핸디: ${participant.tournamentHandicap} (기본 핸디 ${participant.baseHandicapSnapshot})`
    : `대회 핸디: ${participant.tournamentHandicap}`

  if (participant.entryStatus === 'excluded') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span style={{ fontSize: 15, color: '#c0392b', fontWeight: 600 }}>
          관리자가 이번 대회 참가자에서 제외했습니다.
        </span>
      </div>
    )
  }

  if (!acceptingEntries) {
    const statusText = participant.entryStatus === 'entered' ? '참가' : participant.entryStatus === 'declined' ? '불참' : '미응답'
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
        <span style={{ fontSize: 15, color: '#072B61', fontWeight: 600 }}>현재 선택: {statusText}</span>
        <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          참가자가 확정되어 더 이상 변경할 수 없습니다.
        </span>
        {participant.entryStatus === 'entered' && (
          <span className="muted" style={{ fontSize: 13 }}>{handicapLine}</span>
        )}
      </div>
    )
  }

  const currentLabel = participant.entryStatus === 'entered' ? '참가'
    : participant.entryStatus === 'declined' ? '불참'
    : '아직 선택 안 함'

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 700, fontSize: 15 }}>내 참가 여부</span>
      <span style={{ fontSize: 15, color: '#072B61', fontWeight: 600 }}>현재 선택: {currentLabel}</span>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          className={participant.entryStatus === 'entered' ? 'primary grow' : 'grow'}
          disabled={busy}
          onClick={() => onSetEntryStatus('entered')}
          style={{ fontSize: 16, padding: 14 }}
        >
          참가합니다
        </button>
        <button
          type="button"
          className={participant.entryStatus === 'declined' ? 'primary grow' : 'grow'}
          disabled={busy}
          onClick={() => onSetEntryStatus('declined')}
          style={{ fontSize: 16, padding: 14 }}
        >
          참가하지 않습니다
        </button>
      </div>
      {participant.entryStatus === 'entered' && (
        <span className="muted" style={{ fontSize: 13 }}>{handicapLine}</span>
      )}
    </div>
  )
}
