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

    // nextMatchId별로 소스 경기를 묶는다 — 실제 bracket 데이터(nextMatchId)를 기준으로만
    // 묶고, 화면에 인접해 보인다고 임의로 묶지 않는다. 부전승도 그냥 하나의 소스 경기로
    // 자연스럽게 섞여 들어온다(대진 생성 시점에 이미 실제 match로 만들어져 있으므로
    // 가짜 경기를 새로 만들 필요가 없다).
    const byNext = new Map<string, TournamentMatch[]>()
    for (const m of matches) {
      if (!m.nextMatchId) continue
      if (!byNext.has(m.nextMatchId)) byNext.set(m.nextMatchId, [])
      byNext.get(m.nextMatchId)!.push(m)
    }

    const nextLines: { key: string; d: string }[] = []
    for (const [nextMatchId, sources] of byNext) {
      const toEl = matchRefs.current.get(nextMatchId)
      if (!toEl) continue
      const toRect = toEl.getBoundingClientRect()
      const x2 = toRect.left - containerRect.left + container.scrollLeft
      const y2 = toRect.top + toRect.height / 2 - containerRect.top + container.scrollTop

      const points: { x: number; y: number; id: string }[] = []
      for (const m of sources) {
        const fromEl = matchRefs.current.get(m.id)
        if (!fromEl) continue
        const fromRect = fromEl.getBoundingClientRect()
        points.push({
          x: fromRect.right - containerRect.left + container.scrollLeft,
          y: fromRect.top + fromRect.height / 2 - containerRect.top + container.scrollTop,
          id: m.id,
        })
      }
      if (points.length === 0) continue

      // 전형적인 브래킷 꺾쇠(junction) 모양: 두 소스 경기에서 나온 가로선이 중간 X에서
      // 만나 하나의 세로선(spine)으로 합쳐지고, 그 세로선의 중간(두 소스 중심의 평균
      // 높이)에서 다시 가로선 하나가 나가 다음 경기 카드의 세로 중앙으로 들어간다.
      // 소스가 하나뿐이면(반대편 자리가 아직 안 정해진 경우) spine 없이 바로 잇는다.
      const midX = (points[0].x + x2) / 2
      const mergeY = points.reduce((sum, p) => sum + p.y, 0) / points.length

      for (const p of points) {
        nextLines.push({ key: `${p.id}-stub`, d: `M ${p.x} ${p.y} H ${midX}` })
      }
      if (points.length > 1) {
        const yTop = Math.min(...points.map((p) => p.y))
        const yBottom = Math.max(...points.map((p) => p.y))
        nextLines.push({ key: `${nextMatchId}-spine`, d: `M ${midX} ${yTop} V ${yBottom}` })
      }
      // 합쳐진 지점(mergeY)에서 다음 경기의 실제 세로 중앙(y2)까지 마저 연결한다 — 레이아웃상
      // 두 소스의 평균 높이와 다음 경기 중앙이 항상 정확히 같지는 않으므로 그 차이를 여기서
      // 마저 메운다(V가 없어도 mergeY===y2면 길이 0으로 자연스럽게 사라진다).
      nextLines.push({ key: `${nextMatchId}-in`, d: `M ${midX} ${mergeY} V ${y2} H ${x2}` })
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

  /**
   * 선수 1명 = 네모난 칸 하나 — 오프라인에서 쓰던 종이 대진표(각 참가자가 자기만의 칸을
   * 갖고, 두 칸이 선으로 모여 다음 칸으로 이어지는 모양)를 그대로 따른다. 그래서 이전처럼
   * 카드 하나 안에 "A vs B"를 함께 넣지 않고, 두 칸을 위아래로 붙여 그린다. 칸 테두리도
   * 종이 대진표처럼 각진 사각형(모서리 둥글림 없음)으로 둔다.
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
          minHeight: 20,
        }}
      >
        <span style={{ fontWeight: isWinner ? 800 : 500, opacity: participantId ? 1 : 0.5, fontSize: 14 }}>
          {participantId ? nameOf(participantId) : emptyLabel}
          {isBye && ' (부전승)'}
        </span>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', overflowX: 'auto', paddingBottom: 4 }}>
      <svg
        width={svgSize.width} height={svgSize.height}
        style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {/* ⚠ 예전에는 stroke를 var(--border)(#e3e3df, 아주 옅은 회색)로 그려서 실제 화면에서는
            선이 거의 안 보였다 — 종이 대진표처럼 또렷한 검은 선으로 그린다. */}
        {lines.map((l) => (
          <path key={l.key} d={l.d} stroke="#333" strokeWidth={2} fill="none" />
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
                  onClick={onSelectMatch ? () => onSelectMatch(m) : undefined}
                  onKeyDown={onSelectMatch ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSelectMatch(m) } : undefined}
                  style={{
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
        ))}
      </div>
    </div>
  )
}
