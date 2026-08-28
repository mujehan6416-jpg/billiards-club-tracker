import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TournamentMatch } from '../../types/tournament'
import { roundConfirmedLabel, roundLabel } from './tournamentDisplay'
import { isTournamentRoundOfficial } from '../../logic/tournamentMatch'

function samePaths(a: { key: string; d: string }[], b: { key: string; d: string }[]): boolean {
  if (a.length !== b.length) return false
  return a.every((line, i) => line.key === b[i].key && line.d === b[i].d)
}

/**
 * 전체 대진표를 라운드별 열로 한 화면에 펼치고, 경기 사이를 실제 연결선으로 잇는다.
 * "누가 어디서 올라와 누구와 만나는지"를 한눈에 훑어보는 용도다(라운드별 카드 보기와 별개).
 *
 * 연결선은 match.nextMatchId만 따라간다 — bracketSize(16/32강 등)에 하드코딩된 계산이
 * 전혀 없다. 몇 강이든 이 컴포넌트는 그대로 동작한다.
 *
 * 연결선을 고정 픽셀 공식으로 미리 계산하지 않고, 실제 렌더링된 경기 박스의 위치를
 * getBoundingClientRect로 측정해서 그린다 — 글자 크기·이름 길이·화면 배율(zoom)에 따라
 * 박스 높이가 달라져도 선이 어긋나지 않는다. 레이아웃이 바뀔 때(데이터 변경, 창 크기 변경)
 * 다시 측정한다.
 *
 * ⚠ 32강 전체를 좁은 모바일 폭에 욱여넣지 않는다 — 이 컴포넌트를 감싼 바깥 div만
 * 가로 스크롤되고, 페이지 전체는 스크롤되지 않는다.
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

  const containerRef = useRef<HTMLDivElement>(null)
  const matchRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [lines, setLines] = useState<{ key: string; d: string }[]>([])
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 })

  const recompute = () => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const nextLines: { key: string; d: string }[] = []
    for (const m of matches) {
      if (!m.nextMatchId) continue
      const fromEl = matchRefs.current.get(m.id)
      const toEl = matchRefs.current.get(m.nextMatchId)
      if (!fromEl || !toEl) continue
      const fromRect = fromEl.getBoundingClientRect()
      const toRect = toEl.getBoundingClientRect()
      const x1 = fromRect.right - containerRect.left + container.scrollLeft
      const y1 = fromRect.top + fromRect.height / 2 - containerRect.top + container.scrollTop
      const x2 = toRect.left - containerRect.left + container.scrollLeft
      const y2 = toRect.top + toRect.height / 2 - containerRect.top + container.scrollTop
      const midX = (x1 + x2) / 2
      // 꺾은선: 출발 경기 오른쪽 끝 → 중간까지 수평 → 목적 경기 높이까지 수직 → 목적 경기
      // 왼쪽 끝까지 수평. 실제 nextMatchId 연결관계만 따라가며, 화면에 보이기 좋게
      // "그럴듯한 곡선"을 임의로 그리지 않는다.
      nextLines.push({ key: `${m.id}->${m.nextMatchId}`, d: `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}` })
    }
    // 값이 실제로 달라졌을 때만 state를 바꾼다 — deps 없는 layout effect가 매 렌더마다
    // 다시 실행되므로, 바뀐 게 없는데도 setState를 부르면 렌더가 끝없이 반복된다.
    setLines((prev) => (samePaths(prev, nextLines) ? prev : nextLines))
    const nextSize = { width: container.scrollWidth, height: container.scrollHeight }
    setSvgSize((prev) => (prev.width === nextSize.width && prev.height === nextSize.height ? prev : nextSize))
  }

  useLayoutEffect(() => { recompute() })

  useEffect(() => {
    const onResize = () => recompute()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])

  if (rounds.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '16px 0' }}>대진 정보가 없습니다.</p>
  }

  const isMine = (m: TournamentMatch) =>
    !!highlightMemberId && (m.playerAMemberId === highlightMemberId || m.playerBMemberId === highlightMemberId)

  const slot = (m: TournamentMatch, side: 'A' | 'B') => {
    const participantId = side === 'A' ? m.playerAParticipantId : m.playerBParticipantId
    const isWinner = m.status === 'official' && m.officialWinnerParticipantId === participantId
    const isBye = m.resultType === 'bye'
    return (
      <span style={{ fontWeight: isWinner ? 800 : 600, opacity: participantId ? 1 : 0.5, fontSize: 15 }}>
        {participantId ? nameOf(participantId) : '미정'}
        {isBye && ' (부전승)'}
      </span>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto', paddingBottom: 4 }}>
      <svg
        width={svgSize.width} height={svgSize.height}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {lines.map((l) => (
          <path key={l.key} d={l.d} stroke="var(--border)" strokeWidth={2} fill="none" />
        ))}
      </svg>

      <div style={{ display: 'flex', gap: 48, minWidth: 'max-content', position: 'relative' }}>
        {rounds.map((r) => (
          <div key={r.roundNumber} style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 176, justifyContent: 'space-around' }}>
            <span style={{ fontWeight: 700, fontSize: 15, textAlign: 'center' }}>
              {r.confirmed ? `✅ ${roundConfirmedLabel(r.matches[0].playerCountInRound)}` : r.label}
            </span>
            {r.matches.map((m) => {
              const selected = selectedMatchId === m.id
              const mine = isMine(m)
              return (
                <div
                  key={m.id}
                  ref={(el) => { if (el) matchRefs.current.set(m.id, el); else matchRefs.current.delete(m.id) }}
                  role={onSelectMatch ? 'button' : undefined}
                  tabIndex={onSelectMatch ? 0 : undefined}
                  className="card"
                  onClick={onSelectMatch ? () => onSelectMatch(m) : undefined}
                  onKeyDown={onSelectMatch ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectMatch(m) } : undefined}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4, padding: 10,
                    border: selected ? '2px solid #1a56db' : mine ? '2px solid #0f6e56' : undefined,
                    cursor: onSelectMatch ? 'pointer' : undefined,
                  }}
                >
                  <div>{slot(m, 'A')}</div>
                  <div className="muted" style={{ fontSize: 12 }}>vs</div>
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
