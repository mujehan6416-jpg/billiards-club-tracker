import type { Tournament, TournamentParticipant } from '../../types/tournament'
import { countEntries, tournamentStatusLabel, type EntryCounts } from './tournamentDisplay'

const STATUS_BADGE_STYLE: Record<Tournament['status'], { bg: string; fg: string }> = {
  draft: { bg: '#e1f5ee', fg: '#0f6e56' },
  entryClosed: { bg: '#fff3cd', fg: '#856404' },
  drawReady: { bg: '#fff3cd', fg: '#856404' },
  bracketFixed: { bg: '#eef3fb', fg: '#072B61' },
  finished: { bg: '#f0f0f0', fg: '#666' },
  cancelled: { bg: '#fdeceb', fg: '#c0392b' },
}

/**
 * 대회 목록. 회원·관리자 공통 화면이다.
 * 아직 대진·경기 기능이 없으므로 그쪽으로 이어지는 버튼은 만들지 않는다.
 */
export function TournamentList({ tournaments, participantsByTournamentId, onSelect }: {
  tournaments: Tournament[]
  participantsByTournamentId: Record<string, TournamentParticipant[]>
  onSelect: (id: string) => void
}) {
  if (tournaments.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>아직 등록된 대회가 없습니다.</p>
  }

  const sorted = [...tournaments].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((t) => {
        const counts: EntryCounts = countEntries(participantsByTournamentId[t.id] ?? [])
        const badge = STATUS_BADGE_STYLE[t.status]
        return (
          <button
            key={t.id}
            className="card col-card"
            onClick={() => onSelect(t.id)}
            style={{ width: '100%', textAlign: 'left', alignItems: 'stretch', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#072B61' }}>{t.name}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
                background: badge.bg, color: badge.fg, whiteSpace: 'nowrap',
              }}>
                {tournamentStatusLabel(t.status)}
              </span>
            </div>
            <span className="muted" style={{ fontSize: 14 }}>📅 {t.date}</span>
            {t.status === 'draft' ? (
              <span className="muted" style={{ fontSize: 13 }}>
                참가 {counts.entered}명 · 미응답 {counts.noResponse}명
              </span>
            ) : t.participantCount !== undefined ? (
              <span className="muted" style={{ fontSize: 13 }}>참가자 {t.participantCount}명</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
