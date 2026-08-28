import { useMemo } from 'react'
import type { TournamentMatch } from '../../types/tournament'
import { roundConfirmedLabel, roundLabel } from './tournamentDisplay'
import { isTournamentRoundOfficial } from '../../logic/tournamentMatch'
import { calculateBracketLayout, BRACKET_LAYOUT } from '../../logic/tournamentBracketLayout'

const { CARD_WIDTH, CARD_HEIGHT } = BRACKET_LAYOUT
const HEADER_HEIGHT = 28
/** 종이 대진표처럼 또렷하되 선수 이름보다 시선을 끌지 않는 정도의 연한 선. */
const LINE_COLOR = '#aeb2b5'
const LINE_WIDTH = 1.25

interface ConnectorLine { key: string; d: string }

/**
 * 전체 대진표를 라운드별 열로 펼치고, 경기 사이를 실제 연결선으로 잇는다. 라운드별 카드
 * 보기(TournamentBracketView)와 별개로, "누가 어디서 올라와 누구와 만나는지"를 한눈에
 * 보는 용도다.
 *
 * ⚠ 예전에는 카드를 먼저 그린 뒤 실제 렌더링 위치를 getBoundingClientRect로 측정해서
 * 연결선을 그렸다. 이번에는 반대로 한다 — calculateBracketLayout()이 각 경기 카드의
 * 좌표(x, centerY)를 데이터만으로 먼저 계산하고, 카드 자체가 그 좌표에 그려진다.
 * 그래서 "다음 라운드 카드가 이전 두 경기 카드의 정확한 중간에 위치"하는 것이 좌표
 * 계산 단계에서부터 보장되고(나중에 선으로 보정하지 않는다), DOM 측정·리사이즈 이벤트·
 * ResizeObserver가 전혀 필요 없다 — 좌표가 항상 deterministic하다.
 *
 * 연결선은 match.nextMatchId만 따라간다 — bracketSize(8/16/32강 등)에 하드코딩된 계산이
 * 전혀 없다.
 *
 * ⚠ 32강 전체를 좁은 모바일 폭에 욱여넣지 않는다 — 바깥 div만 가로 스크롤되고, 페이지
 * 전체는 스크롤되지 않는다.
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
  const layout = useMemo(() => calculateBracketLayout(matches), [matches])

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
        x: layout.get(list[0].id)?.x ?? 0,
      }))
  }, [matches, layout])

  const lines = useMemo(() => {
    // nextMatchId별로 소스 경기를 묶는다 — 실제 bracket 데이터를 기준으로만 묶고, 화면에
    // 인접해 보인다고 임의로 묶지 않는다. 부전승도 실제 match이므로 다른 소스와 똑같이
    // 하나의 stub으로 자연스럽게 섞여 들어온다.
    const byNext = new Map<string, TournamentMatch[]>()
    for (const m of matches) {
      if (!m.nextMatchId) continue
      if (!byNext.has(m.nextMatchId)) byNext.set(m.nextMatchId, [])
      byNext.get(m.nextMatchId)!.push(m)
    }

    const result: ConnectorLine[] = []
    for (const [nextMatchId, sources] of byNext) {
      const target = layout.get(nextMatchId)
      if (!target) continue
      // 카드가 헤더(라운드 이름표) 높이만큼 아래로 그려지므로, 선도 같은 만큼 내려서
      // 그려야 카드 중앙과 정확히 맞는다.
      const points = sources
        .map((s) => layout.get(s.id))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({ x: p.x + CARD_WIDTH, y: p.centerY + HEADER_HEIGHT }))
      if (points.length === 0) continue

      const x2 = target.x
      const y2 = target.centerY + HEADER_HEIGHT
      const midX = (points[0].x + x2) / 2

      for (const p of points) {
        result.push({ key: `${nextMatchId}-stub-${p.y}`, d: `M ${p.x} ${p.y} H ${midX}` })
      }
      if (points.length > 1) {
        const yTop = Math.min(...points.map((p) => p.y))
        const yBottom = Math.max(...points.map((p) => p.y))
        result.push({ key: `${nextMatchId}-spine`, d: `M ${midX} ${yTop} V ${yBottom}` })
      }
      // target.centerY는 이 소스들의 평균으로 "계산"된 값이므로(측정값이 아니다), 합류점의
      // y와 항상 정확히 같다 — 그래서 별도 보정 없이 바로 다음 카드로 들어간다.
      result.push({ key: `${nextMatchId}-in`, d: `M ${midX} ${y2} H ${x2}` })
    }
    return result
  }, [matches, layout])

  if (rounds.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>대진 정보가 없습니다.</p>
  }

  const isMine = (m: TournamentMatch) =>
    !!highlightMemberId && (m.playerAMemberId === highlightMemberId || m.playerBMemberId === highlightMemberId)

  /**
   * 선수 1명 = 네모난 칸 하나 — 오프라인에서 쓰던 종이 대진표(각 참가자가 자기만의 칸을
   * 갖고, 두 칸이 선으로 모여 다음 칸으로 이어지는 모양)를 그대로 따른다. 카드 하나 안에
   * "A vs B"를 함께 넣지 않고, 두 칸을 위아래로 붙여 그린다. 칸 테두리도 종이 대진표처럼
   * 각진 사각형(모서리 둥글림 없음)으로 둔다.
   */
  const slotBox = (m: TournamentMatch, side: 'A' | 'B') => {
    const participantId = side === 'A' ? m.playerAParticipantId : m.playerBParticipantId
    const isWinner = m.status === 'official' && m.officialWinnerParticipantId === participantId
    const isBye = m.resultType === 'bye' && !!participantId
    // 부전승 경기의 빈 자리는 "아직 정해지지 않음"(미정)이 아니라 애초에 상대가 없는
    // 자리다 — 다른 경기의 빈 자리(승자 진출 대기)와 같은 문구를 쓰면 헷갈린다.
    const emptyLabel = m.resultType === 'bye' ? '' : '미정'
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderBottom: side === 'A' ? 'none' : undefined,
          borderRadius: 0,
          padding: '7px 8px',
          background: isWinner ? '#eafaf3' : 'var(--surface, #fff)',
          height: CARD_HEIGHT / 2,
          boxSizing: 'border-box',
        }}
      >
        <span style={{ fontWeight: isWinner ? 800 : 500, opacity: participantId ? 1 : 0.5, fontSize: 14 }}>
          {participantId ? nameOf(participantId) : emptyLabel}
          {isBye && ' (부전승)'}
        </span>
      </div>
    )
  }

  const maxCenterY = Math.max(...[...layout.values()].map((p) => p.centerY))
  const totalHeight = maxCenterY + CARD_HEIGHT / 2 + HEADER_HEIGHT + 4
  const lastRoundX = rounds[rounds.length - 1]?.x ?? 0
  const totalWidth = lastRoundX + CARD_WIDTH

  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ position: 'relative', width: totalWidth, height: totalHeight }}>
        <svg
          width={totalWidth} height={totalHeight}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {lines.map((l) => (
            <path key={l.key} d={l.d} stroke={LINE_COLOR} strokeWidth={LINE_WIDTH} fill="none" />
          ))}
        </svg>

        {rounds.map((r) => (
          <span
            key={r.roundNumber}
            style={{
              position: 'absolute', left: r.x, top: 0, width: CARD_WIDTH, textAlign: 'center',
              fontWeight: 700, fontSize: 15,
            }}
          >
            {r.confirmed ? `✅ ${roundConfirmedLabel(matches.find((m) => m.roundNumber === r.roundNumber)!.playerCountInRound)}` : r.label}
          </span>
        ))}

        {matches.map((m) => {
          const pos = layout.get(m.id)
          if (!pos) return null
          const selected = selectedMatchId === m.id
          const mine = isMine(m)
          return (
            <div
              key={m.id}
              data-match-id={m.id}
              role={onSelectMatch ? 'button' : undefined}
              tabIndex={onSelectMatch ? 0 : undefined}
              onClick={onSelectMatch ? () => onSelectMatch(m) : undefined}
              onKeyDown={onSelectMatch ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectMatch(m) } : undefined}
              style={{
                position: 'absolute',
                left: pos.x, top: pos.centerY - CARD_HEIGHT / 2 + HEADER_HEIGHT, width: CARD_WIDTH,
                display: 'flex', flexDirection: 'column',
                outline: selected ? '2px solid #1a56db' : mine ? '2px solid #0f6e56' : undefined,
                outlineOffset: 2,
                cursor: onSelectMatch ? 'pointer' : undefined,
              }}
            >
              {slotBox(m, 'A')}
              {slotBox(m, 'B')}
            </div>
          )
        })}
      </div>
    </div>
  )
}
