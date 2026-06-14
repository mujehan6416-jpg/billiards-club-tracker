import { useMemo, useState } from 'react'
import { useApp } from '../store/appStore'
import type { Member, Session } from '../types'
import { winnerId } from '../logic/game'
import { headToHead, memberStats, memberTimeline, winStreaks } from '../logic/stats'
import { fmtScore } from '../lib/format'

type View = 'ranking' | 'byDate' | 'h2h' | 'trend'

export function DashboardTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const [view, setView] = useState<View>('ranking')

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const name = (id: string) => memberMap.get(id)?.name ?? '알수없음'

  return (
    <div className="tab">
      <h2 className="tab-title">대시보드</h2>
      <div className="seg">
        <button className={view === 'ranking' ? 'on' : ''} onClick={() => setView('ranking')}>랭킹</button>
        <button className={view === 'byDate' ? 'on' : ''} onClick={() => setView('byDate')}>날짜별</button>
        <button className={view === 'h2h' ? 'on' : ''} onClick={() => setView('h2h')}>상대전적</button>
        <button className={view === 'trend' ? 'on' : ''} onClick={() => setView('trend')}>추이</button>
      </div>

      {view === 'ranking' && <Ranking sessions={sessions} name={name} />}
      {view === 'byDate' && <ByDate sessions={sessions} name={name} />}
      {view === 'h2h' && <H2H sessions={sessions} members={members} name={name} />}
      {view === 'trend' && <Trend sessions={sessions} members={members} name={name} />}
    </div>
  )
}

function Ranking({ sessions, name }: { sessions: Session[]; name: (id: string) => string }) {
  const stats = useMemo(
    () => memberStats(sessions).sort((a, b) => b.winRate - a.winRate || b.avgRate - a.avgRate || b.games - a.games),
    [sessions],
  )
  if (stats.length === 0) return <p className="muted">아직 경기 기록이 없습니다.</p>
  return (
    <table className="rank-table">
      <thead>
        <tr>
          <th>#</th>
          <th className="l">회원</th>
          <th>전적</th>
          <th>승률</th>
          <th>평균달성</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s, i) => (
          <tr key={s.memberId}>
            <td>{i + 1}</td>
            <td className="l">{name(s.memberId)}</td>
            <td>
              {s.wins}-{s.losses}
              {s.draws ? `-${s.draws}` : ''}
            </td>
            <td className="strong">{Math.round(s.winRate * 100)}%</td>
            <td>{Math.round(s.avgRate * 100)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ByDate({ sessions, name }: { sessions: Session[]; name: (id: string) => string }) {
  const dated = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))
  const [sid, setSid] = useState(dated[0]?.id ?? '')
  const session = dated.find((s) => s.id === sid) ?? dated[0]
  if (!session) return <p className="muted">아직 모임이 없습니다.</p>
  return (
    <div>
      <select className="block" value={session.id} onChange={(e) => setSid(e.target.value)}>
        {dated.map((s) => (
          <option key={s.id} value={s.id}>
            {s.date} (참석 {s.attendeeIds.length} · 경기 {s.games.length})
          </option>
        ))}
      </select>
      <GameList games={session.games} name={name} />
    </div>
  )
}

function H2H({ sessions, members, name }: { sessions: Session[]; members: Member[]; name: (id: string) => string }) {
  const opts = [...members].sort((a, b) => a.name.localeCompare(b.name))
  const [aId, setA] = useState(opts[0]?.id ?? '')
  const [bId, setB] = useState(opts[1]?.id ?? '')
  if (opts.length < 2) return <p className="muted">회원이 2명 이상 필요합니다.</p>
  const h = headToHead(sessions, aId, bId)
  const games = sessions.flatMap((s) =>
    s.games.filter(
      (g) =>
        (g.playerAId === aId && g.playerBId === bId) || (g.playerAId === bId && g.playerBId === aId),
    ),
  )
  return (
    <div>
      <div className="h2h-pick">
        <select value={aId} onChange={(e) => setA(e.target.value)}>
          {opts.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <span className="muted">vs</span>
        <select value={bId} onChange={(e) => setB(e.target.value)}>
          {opts.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>
      {aId === bId ? (
        <p className="muted">서로 다른 두 회원을 선택하세요.</p>
      ) : (
        <>
          <div className="h2h-score">
            <span className="strong">{name(aId)} {h.aWins}</span>
            <span className="muted"> - </span>
            <span className="strong">{h.bWins} {name(bId)}</span>
            {h.draws > 0 && <span className="muted"> (무 {h.draws})</span>}
          </div>
          <GameList games={games} name={name} />
        </>
      )}
    </div>
  )
}

function Trend({ sessions, members, name }: { sessions: Session[]; members: Member[]; name: (id: string) => string }) {
  const opts = [...members].sort((a, b) => a.name.localeCompare(b.name))
  const [id, setId] = useState(opts[0]?.id ?? '')
  if (opts.length === 0) return <p className="muted">회원이 없습니다.</p>
  const timeline = memberTimeline(sessions, id)
  const streak = winStreaks(timeline)
  return (
    <div>
      <select className="block" value={id} onChange={(e) => setId(e.target.value)}>
        {opts.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      {timeline.length === 0 ? (
        <p className="muted">경기 기록이 없습니다.</p>
      ) : (
        <>
          <div className="metric-row">
            <Metric label="경기" value={`${timeline.length}`} />
            <Metric label="현재 연승" value={`${streak.current}`} />
            <Metric label="최장 연승" value={`${streak.max}`} />
          </div>
          <Sparkline rates={timeline.map((t) => t.rate)} />
          <ul className="trend-list">
            {timeline
              .slice()
              .reverse()
              .map((t) => (
                <li key={t.gameId} className={`trend-item ${t.result}`}>
                  <span className="badge">{t.result}</span>
                  <span>{t.date}</span>
                  <span className="muted">vs {name(t.opponentId)}</span>
                  <span className="right">{fmtScore(t.score, t.handicap)}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  )
}

function GameList({ games, name }: { games: Session['games']; name: (id: string) => string }) {
  if (games.length === 0) return <p className="muted">경기 없음</p>
  return (
    <ul className="result-list">
      {games.map((g) => {
        const win = winnerId(g)
        return (
          <li key={g.id} className="card result-row">
            <span className={win === g.playerAId ? 'win' : ''}>
              {name(g.playerAId)} {fmtScore(g.scoreA, g.handicapA)}
            </span>
            <span className="vs">vs</span>
            <span className={win === g.playerBId ? 'win right' : 'right'}>
              {name(g.playerBId)} {fmtScore(g.scoreB, g.handicapB)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
    </div>
  )
}

function Sparkline({ rates }: { rates: number[] }) {
  const w = 280
  const h = 60
  if (rates.length < 2) return null
  const max = Math.max(1, ...rates)
  const pts = rates
    .map((r, i) => {
      const x = (i / (rates.length - 1)) * w
      const y = h - (r / max) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="달성률 추이">
      <polyline points={pts} fill="none" stroke="var(--green)" strokeWidth={2} />
    </svg>
  )
}
