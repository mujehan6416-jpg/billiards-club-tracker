import { useMemo, useState } from 'react'
import type { ArchivedTournament } from '../../data/tournamentArchive'
import type { Tournament } from '../../types/tournament'
import { archiveStageToMatches } from '../../logic/tournamentArchiveMatches'
import { countTournamentProgress } from '../../logic/tournamentMatch'
import { TournamentBracketView } from './TournamentBracketView'
import { TournamentBracketVisual } from './TournamentBracketVisual'
import { TournamentFinalResults } from './TournamentFinalResults'

/**
 * 완료된 대회의 "열람용 확정 결과" 화면. 읽기 전용이며 아무것도 저장하지 않는다.
 *
 * 화면은 기존 대회 결과 화면과 같은 컴포넌트(라운드별 보기 TournamentBracketView · 전체 대진표
 * TournamentBracketVisual · 최종 결과 TournamentFinalResults)를 그대로 쓴다. 데이터만 기록용 확정값
 * (data/tournamentArchive.ts)을 표시 전용으로 바꿔 넘긴다(logic/tournamentArchiveMatches.ts) — 대진 엔진·서버·통계와는
 * 연결되지 않는다.
 *
 * 전체 대진표는 오프라인 추첨 자리를 복원한 것이 아니다. "이 경기 승자가 다음 라운드 어느 경기에 나왔는가"라는
 * 실제 경기 흐름만으로 선을 잇는다(TournamentBracketVisual은 nextMatchId 연결만 따라 그린다).
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

const noop = () => {}

export function TournamentArchiveView({ tournament, onBack }: { tournament: ArchivedTournament; onBack: () => void }) {
  const stages = useMemo(
    () => tournament.stages.map((stage, i) => ({ stage, key: `${tournament.id}-${i}`, ...archiveStageToMatches(stage, `${tournament.id}-${i}`) })),
    [tournament],
  )
  const [activeKey, setActiveKey] = useState(stages[0]?.key)
  /** 기존 대회 화면과 같은 두 가지 보기 방식. 본선·리스타트전을 바꿔도 고른 보기 방식은 유지한다. */
  const [viewMode, setViewMode] = useState<'round' | 'full'>('round')
  const active = stages.find((s) => s.key === activeKey) ?? stages[0]

  // TournamentFinalResults가 받는 대회 정보 — 화면 표시("대회가 종료되었습니다.")에만 쓴다.
  const finished: Tournament = {
    id: tournament.id, name: tournament.name, date: tournament.date ?? '',
    timeLimitMinutes: tournament.timeLimitMinutes, status: 'finished', createdAt: '',
  }
  const isRestartStage = !!active && active !== stages[0]
  const progress = countTournamentProgress(active?.matches ?? [])

  return (
    <div className="tab">
      <button type="button" onClick={onBack} style={{ marginBottom: 4 }}>← 대회 목록</button>
      <h2 className="tab-title" style={{ marginBottom: 0 }}>{tournament.name}</h2>
      <span className="muted">
        {tournament.date ? `📅 ${formatKoreanDate(tournament.date)} · ` : ''}{tournament.timeLimitMinutes}분 경기
      </span>

      {/* 본선 / 리스타트전 전환 — 기존 대회 화면의 "라운드별 보기 / 전체 대진표" 전환 버튼과 같은 모양. */}
      {stages.length > 1 && (
        <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="본선·리스타트전 선택">
          {stages.map((s) => (
            <button
              key={s.key} type="button" aria-pressed={s.key === active?.key}
              className={s.key === active?.key ? 'primary grow' : 'grow'} style={{ fontSize: 16, fontWeight: 700, padding: 12 }}
              onClick={() => setActiveKey(s.key)}
            >
              {s.stage.title}
            </button>
          ))}
        </div>
      )}

      {active && (
        <section aria-label={active.stage.title} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 기존 대회 화면의 진행 현황 카드("7 / 7 경기 완료")와 같은 모양 — 실시간 연결 문구·새로고침은 기록용이라 없다. */}
          <div className="card">
            <span style={{ fontSize: 17, fontWeight: 800 }}>
              {progress.done} / {progress.total} 경기 완료
            </span>
          </div>
          {/* 기존 대회 화면의 "라운드별 보기 / 전체 대진표" 전환 버튼 그대로. */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button" aria-pressed={viewMode === 'round'}
              className={viewMode === 'round' ? 'primary grow' : 'grow'} style={{ fontSize: 16, fontWeight: 700, padding: 12 }}
              onClick={() => setViewMode('round')}
            >
              라운드별 보기
            </button>
            <button
              type="button" aria-pressed={viewMode === 'full'}
              className={viewMode === 'full' ? 'primary grow' : 'grow'} style={{ fontSize: 16, fontWeight: 700, padding: 12 }}
              onClick={() => setViewMode('full')}
            >
              전체 대진표
            </button>
          </div>
          {viewMode === 'round' ? (
            <TournamentBracketView key={active.key} matches={active.matches} nameOf={active.nameOf} roundLabelOf={active.roundLabelOf} />
          ) : (
            <>
              <TournamentBracketVisual key={active.key} matches={active.matches} nameOf={active.nameOf} roundLabelOf={active.roundLabelOf} />
              {active.joiners.map((j) => (
                <span key={j.roundLabel} className="muted" style={{ fontSize: 15 }}>
                  {j.roundLabel}부터 합류{isRestartStage ? '(본선 탈락자)' : ''}: {j.names.join(' · ')}
                </span>
              ))}
            </>
          )}
          <TournamentFinalResults
            tournament={finished} matches={active.matches} nameOf={active.nameOf}
            isAdmin={false} onFinish={noop} hideThirdPlace={isRestartStage}
          />
        </section>
      )}

      {/* 하이런 — 최종 결과 카드와 같은 모양으로 둔다. */}
      <div className="card col-card" style={{ gap: 10 }}>
        <span style={{ fontWeight: 800, fontSize: 19 }}>🎯 하이런</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{tournament.highRun.name} {tournament.highRun.value}</span>
      </div>
    </div>
  )
}
