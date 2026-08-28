import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { TournamentMatch } from '../../types/tournament'
import { roundConfirmedLabel, roundLabel } from './tournamentDisplay'
import { isTournamentRoundOfficial } from '../../logic/tournamentMatch'

/**
 * 전체 대진표를 라운드별 열로 한 화면에 펼친 시각화. 라운드별 카드 보기(TournamentBracketView)와
 * 달리 "누가 어디서 올라와 누구와 만나는지"를 한눈에 훑어보는 용도다.
 *
 * ⚠ 32강 전체를 좁은 모바일 폭에 욱여넣지 않는다 — 이 컴포넌트 하나만 가로 스크롤되고,
 * 페이지 전체는 스크롤되지 않는다(바깥 div의 overflowX만 스크롤).
 *
 * 선을 그어 연결하는 대신, 같은 라운드 안에서 matchNumber 순서(=대진 생성 시점에 이미
 * "홀수 번째 승자는 다음 경기 A 자리, 짝수 번째는 B 자리"로 정해진 순서)대로 위에서 아래로
 * 나열해 인접한 두 경기가 다음 라운드의 같은 경기로 이어진다는 것을 열 순서로 보여준다.
 * matchNumber 순서 자체가 이미 대진 구조를 반영하므로, 이 화면은 그 순서를 그대로 옮기기만
 * 하면 된다 — 별도 연결선 계산을 다시 하지 않는다(로직 중복 방지).
 */
export function TournamentBracketVisual({
  matches, nameOf, highlightMemberId, onSelectMatch, selectedMatchId,
}: {
  matches: TournamentMatch[]
  nameOf: (participantId: string | null) => string
  highlightMemberId?: string
  onSelectMatch?: (match: TournamentMatch) => void
  selectedMatchId?: string | null
}) {
  const rounds = useMemo(() => {
    const byRound = new Map<number, TournamentMatch[]>()
    for (const m of matches) {
      if (!byRound.has(m.roundNumber)) byRound.set(m.roundNumber, [])
      byRound.get(m.roundNumber)!.push(m)
    }
    return [...byRound.entries()]
      .sort(([a], [b]) => a - b)
      .map(([roundNumber, list]) => ({
        roundNumber,
        label: roundLabel(list[0].playerCountInRound),
        confirmed: isTournamentRoundOfficial(matches, roundNumber),
        matches: list.sort((a, b) => a.matchNumber - b.matchNumber),
      }))
  }, [matches])

  if (rounds.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>대진 정보가 없습니다.</p>
  }

  const isMine = (m: TournamentMatch) =>
    !!highlightMemberId && (m.playerAMemberId === highlightMemberId || m.playerBMemberId === highlightMemberId)

  /** 한 슬롯 안에 선수 한 명. 승자는 굵게, 부전승은 배경으로 구분한다. */
  const slot = (m: TournamentMatch, side: 'A' | 'B'): ReactNode => {
    const participantId = side === 'A' ? m.playerAParticipantId : m.playerBParticipantId
    const isWinner = m.status === 'official' && m.officialWinnerParticipantId === participantId
    const isBye = m.resultType === 'bye'
    return (
      <span style={{ fontWeight: isWinner ? 800 : 500, opacity: participantId ? 1 : 0.5 }}>
        {participantId ? nameOf(participantId) : '미정'}
        {isBye && ' (부전승)'}
      </span>
    )
  }

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', gap: 20, minWidth: 'max-content' }}>
        {rounds.map((r) => (
          <div key={r.roundNumber} style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 168 }}>
            <span style={{ fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
              {r.confirmed ? `✅ ${roundConfirmedLabel(r.matches[0].playerCountInRound)}` : r.label}
            </span>
            {r.matches.map((m) => {
              const selected = selectedMatchId === m.id
              const mine = isMine(m)
              return (
                <div
                  key={m.id}
                  role={onSelectMatch ? 'button' : undefined}
                  tabIndex={onSelectMatch ? 0 : undefined}
                  className="card"
                  onClick={onSelectMatch ? () => onSelectMatch(m) : undefined}
                  onKeyDown={onSelectMatch ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectMatch(m) } : undefined}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4, padding: 8, fontSize: 13,
                    border: selected ? '2px solid #1a56db' : mine ? '2px solid #0f6e56' : undefined,
                    cursor: onSelectMatch ? 'pointer' : undefined,
                  }}
                >
                  <div>{slot(m, 'A')}</div>
                  <div className="muted" style={{ fontSize: 11 }}>vs</div>
                  <div>{slot(m, 'B')}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
