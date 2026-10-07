import type { ArchivedEntry, ArchivedStage, ArchivedTournament } from '../../data/tournamentArchive'
import { nameEmphasis } from './tournamentDisplay'

/**
 * 완료된 대회의 "열람용 확정 결과" 화면. 읽기 전용이며 아무것도 저장하지 않는다.
 * 대진 엔진·통계와 연결되지 않은 기록용 데이터(data/tournamentArchive.ts)만 그린다.
 */

/** "2026-10-05" → "2026년 10월 5일". 형식이 다르면 원문을 그대로 쓴다. */
export function formatKoreanDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : date
}

/** 대회 목록에 끼워 넣는 카드 — 기존 대회 카드(TournamentList)와 같은 모양. */
export function TournamentArchiveCard({ tournament, onSelect }: { tournament: ArchivedTournament; onSelect: (id: string) => void }) {
  return (
    <button
      className="card col-card"
      onClick={() => onSelect(tournament.id)}
      style={{ width: '100%', textAlign: 'left', alignItems: 'stretch', cursor: 'pointer' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 17, color: '#072B61' }}>{tournament.name}</span>
        <span style={{
          fontSize: 14, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
          background: '#f0f0f0', color: '#444', whiteSpace: 'nowrap',
        }}>
          완료
        </span>
      </div>
      {tournament.date && <span className="muted" style={{ fontSize: 15 }}>📅 {formatKoreanDate(tournament.date)}</span>}
      <span className="muted" style={{ fontSize: 15 }}>⏱ {tournament.timeLimitMinutes}분 경기</span>
      <span className="muted" style={{ fontSize: 15 }}>본선 · 리스타트전 결과 보기</span>
    </button>
  )
}

function EntryRow({ entry }: { entry: ArchivedEntry }) {
  if (entry.kind === 'bye') {
    return (
      <div className="card col-card" style={{ gap: 4 }} data-testid="archive-bye">
        <span style={{ fontSize: 17, fontWeight: 700 }}>{entry.name}</span>
        <span className="muted" style={{ fontSize: 15 }}>부전승 (경기 없이 다음 라운드 진출)</span>
      </div>
    )
  }
  const { winner, loser } = entry
  const win = nameEmphasis(true, true)
  const lose = nameEmphasis(true, false)
  return (
    <div className="card col-card" style={{ gap: 8 }} data-testid="archive-game">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ ...win, fontSize: 17 }}>{winner.name}</span>
        <span style={{ fontSize: 17, fontWeight: 800 }}>{winner.score}/{winner.target} <span style={{ fontSize: 15 }}>승</span></span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ ...lose, fontSize: 17 }}>{loser.name}</span>
        <span style={{ fontSize: 17, color: lose.color }}>{loser.score}/{loser.target}</span>
      </div>
    </div>
  )
}

function StageSection({ stage }: { stage: ArchivedStage }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label={stage.title}>
      <h3 style={{ margin: '8px 0 0', fontSize: 20, color: '#072B61' }}>{stage.title}</h3>

      <div className="card col-card" style={{ gap: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 18 }}>🏆 {stage.title} 최종 결과</span>
        {stage.placements.map((p) => (
          <span key={p.label} style={{ fontSize: 17, fontWeight: 700 }}>{p.label}: {p.name}</span>
        ))}
      </div>

      {stage.rounds.map((round) => (
        <div key={round.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h4 style={{ margin: '6px 0 0', fontSize: 18 }}>{stage.title} {round.label}</h4>
          {round.entries.map((entry, i) => <EntryRow key={i} entry={entry} />)}
        </div>
      ))}
    </section>
  )
}

export function TournamentArchiveView({ tournament, onBack }: { tournament: ArchivedTournament; onBack: () => void }) {
  return (
    <div className="tab">
      <button type="button" onClick={onBack} style={{ marginBottom: 4 }}>← 대회 목록</button>
      <h2 className="tab-title" style={{ marginBottom: 0 }}>{tournament.name}</h2>
      {tournament.date && (
        <div className="muted" style={{ fontSize: 15 }}>📅 {formatKoreanDate(tournament.date)}</div>
      )}
      <div className="muted" style={{ fontSize: 15 }}>⏱ {tournament.timeLimitMinutes}분 경기 · 대회 완료</div>
      <p className="muted" style={{ fontSize: 15, margin: 0 }}>
        경기 기록은 &quot;점수/목표&quot;로 표시됩니다. 이 화면은 확정된 결과를 보여 주는 기록용이며, 개인 전적·랭킹에는 반영되지 않습니다.
      </p>

      <div className="card col-card" style={{ gap: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 18 }}>하이런</span>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{tournament.highRun.name} {tournament.highRun.value}</span>
        {tournament.handicapNotes.map((n) => (
          <span key={n.name} className="muted" style={{ fontSize: 15 }}>{n.name} 핸디 기준 {n.handicap}</span>
        ))}
      </div>

      {tournament.stages.map((stage) => <StageSection key={stage.title} stage={stage} />)}
    </div>
  )
}
