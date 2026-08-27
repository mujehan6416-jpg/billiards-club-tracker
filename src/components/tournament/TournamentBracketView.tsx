import { useMemo, useState } from 'react'
import type { TournamentMatch } from '../../types/tournament'
import { matchMemberStatusMessage, rateDisplay, roundLabel } from './tournamentDisplay'

/**
 * 라운드별 대진표. 대진 미리보기(관리자, 확정 전)와 확정된 공개 대진표(관리자·회원, 확정 후)가
 * 이 컴포넌트 하나를 공유한다 — 둘 다 "TournamentMatch[] + 이름 찾기"만 있으면 그릴 수 있고,
 * 표시 방식을 갈라 둘 이유가 없다.
 *
 * ⚠ 이 컴포넌트는 번호↔자리 비공개 매핑(TournamentDrawMapping)을 인자로 받지 않는다 — 이미
 * 계산이 끝난 TournamentMatch[]만 받는다. 그래서 이 컴포넌트를 회원 화면에 그대로 써도
 * numberToSlot·byeSlots가 새어 나갈 방법이 없다(부모가 안 주면 이 컴포넌트는 가질 수 없다).
 *
 * 전체 bracket을 한 화면에 욱여넣지 않고 라운드 탭으로 나눈다(고령 사용자 UI 기준).
 */
export function TournamentBracketView({
  matches, nameOf, highlightMemberId, isPreview, onSelectMatch, selectedMatchId,
}: {
  matches: TournamentMatch[]
  nameOf: (participantId: string | null) => string
  /** 이 memberId가 나온 경기 카드를 강조 표시한다(보통 로그인한 본인). */
  highlightMemberId?: string
  /** true면 "아직 확정 전" 배너를 보여준다(관리자 미리보기 전용). */
  isPreview?: boolean
  /** 경기 카드를 눌러 상세(결과 입력·확인·관리자 처리) 화면을 열 때 쓴다. 미리보기 화면에서는 넘기지 않는다. */
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
        matches: list.sort((a, b) => a.matchNumber - b.matchNumber),
      }))
  }, [matches])

  const [activeRound, setActiveRound] = useState(() => rounds[0]?.roundNumber ?? 1)
  const current = rounds.find((r) => r.roundNumber === activeRound) ?? rounds[0]

  if (rounds.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>대진 정보가 없습니다.</p>
  }

  const isMine = (m: TournamentMatch) =>
    !!highlightMemberId && (m.playerAMemberId === highlightMemberId || m.playerBMemberId === highlightMemberId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {isPreview && (
        <div style={{ background: '#fff3cd', color: '#856404', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontWeight: 600 }}>
          🔎 아직 확정 전 미리보기입니다. 대진을 확정해야 회원에게 공개됩니다.
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {rounds.map((r) => (
          <button
            key={r.roundNumber}
            type="button"
            className={r.roundNumber === activeRound ? 'primary' : ''}
            style={{ flexShrink: 0, fontSize: 14, padding: '9px 14px' }}
            onClick={() => setActiveRound(r.roundNumber)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {current?.matches.map((m, i) => {
          const isBye = m.resultType === 'bye'
          const mine = isMine(m)
          // 부전승은 A·B 어느 자리에 앉든(추첨 결과에 따라 둘 다 가능) 실제로 채워진 쪽의
          // 이름을 보여준다 — "항상 A 자리"라고 가정하면 B 자리로 들어간 부전승자가
          // 빈칸으로 보인다.
          const byeName = isBye ? nameOf(m.playerAParticipantId || m.playerBParticipantId) : ''
          const isOfficial = m.status === 'official' && m.resultType !== 'bye'
          const selected = selectedMatchId === m.id
          return (
            <div
              key={m.id}
              role={onSelectMatch ? 'button' : undefined}
              tabIndex={onSelectMatch ? 0 : undefined}
              className="card"
              onClick={onSelectMatch ? () => onSelectMatch(m) : undefined}
              onKeyDown={onSelectMatch ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectMatch(m) } : undefined}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, textAlign: 'left',
                border: selected ? '2px solid #1a56db' : mine ? '2px solid #0f6e56' : undefined,
                cursor: onSelectMatch ? 'pointer' : undefined,
              }}
            >
              <span className="muted" style={{ fontSize: 12 }}>경기 {i + 1}</span>
              {isBye ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{byeName}</span>
                  <span style={{ fontSize: 14, color: '#856404', fontWeight: 600 }}>부전승으로 다음 라운드 진출</span>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: m.officialWinnerParticipantId === m.playerAParticipantId ? 800 : 600, fontSize: 15 }}>
                      {nameOf(m.playerAParticipantId)}
                      {isOfficial && m.scoreA !== null && m.playerAHandicapSnapshot !== null && (
                        <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}> {rateDisplay(m.scoreA, m.playerAHandicapSnapshot)}</span>
                      )}
                    </span>
                    <span className="vs">vs</span>
                    <span style={{ fontWeight: m.officialWinnerParticipantId === m.playerBParticipantId ? 800 : 600, fontSize: 15, textAlign: 'right' }}>
                      {isOfficial && m.scoreB !== null && m.playerBHandicapSnapshot !== null && (
                        <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>{rateDisplay(m.scoreB, m.playerBHandicapSnapshot)} </span>
                      )}
                      {nameOf(m.playerBParticipantId)}
                    </span>
                  </div>
                  {isOfficial ? (
                    <span style={{ fontSize: 13, color: '#0f6e56', fontWeight: 700 }}>
                      ✅ 공식 결과 · 승자: {nameOf(m.officialWinnerParticipantId ?? null)}
                    </span>
                  ) : m.playerAParticipantId && m.playerBParticipantId ? (
                    <span className="muted" style={{ fontSize: 13 }}>{matchMemberStatusMessage(m, highlightMemberId)}</span>
                  ) : (
                    <span className="muted" style={{ fontSize: 13 }}>상대 진출 확정 대기 중</span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
