import { useMemo, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import type { Member, Session } from '../types'
import { buildMeetCount, matchAll, recommendNext } from '../logic/matching'
import { winnerId } from '../logic/game'
import { todayStr } from '../lib/date'
import { fmtScore } from '../lib/format'
import { buildResultText, shareImage, shareText } from '../lib/share'
import { useAdmin } from '../store/adminStore'

interface Ongoing {
  key: string
  aId: string
  bId: string
  handicapA: number
  handicapB: number
  scoreA: string
  scoreB: string
}

export function MeetingTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const createSession = useApp((s) => s.createSession)
  const today = todayStr()
  const current = sessions.find((s) => s.date === today)

  if (!current) {
    return <AttendeePicker members={members} onStart={(ids) => createSession(today, ids)} />
  }
  return <Board key={current.id} session={current} members={members} sessions={sessions} />
}

function AttendeePicker({ members, onStart }: { members: Member[]; onStart: (ids: string[]) => void }) {
  const active = members.filter((m) => m.active)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="tab">
      <h2 className="tab-title">오늘 모임 시작</h2>
      {active.length === 0 && <p className="muted">먼저 회원 탭에서 회원을 추가하세요.</p>}
      <div className="chip-grid">
        {active.map((m) => (
          <button
            key={m.id}
            className={`chip${selected.has(m.id) ? ' on' : ''}`}
            onClick={() => toggle(m.id)}
          >
            {m.name}
          </button>
        ))}
      </div>
      <button
        className="primary block"
        disabled={selected.size < 2}
        onClick={() => onStart([...selected])}
      >
        {selected.size}명으로 모임 시작
      </button>
    </div>
  )
}

function Board({ session, members, sessions }: { session: Session; members: Member[]; sessions: Session[] }) {
  const { isAdmin } = useAdmin()
  const [mountTime] = useState(() => new Date().toISOString())
  const addGame = useApp((s) => s.addGame)
  const deleteGame = useApp((s) => s.deleteGame)
  const setAttendees = useApp((s) => s.setAttendees)

  const [ongoing, setOngoing] = useState<Ongoing[]>([])
  const [editAttendees, setEditAttendees] = useState(false)
  const resultsRef = useRef<HTMLUListElement>(null)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const name = (id: string) => memberMap.get(id)?.name ?? '알수없음'
  const hcapOf = (id: string) => memberMap.get(id)?.handicap ?? 20

  const meetCount = useMemo(() => buildMeetCount(sessions), [sessions])
  const todayGameCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of session.games) {
      m.set(g.playerAId, (m.get(g.playerAId) ?? 0) + 1)
      m.set(g.playerBId, (m.get(g.playerBId) ?? 0) + 1)
    }
    return m
  }, [session.games])

  const busy = new Set<string>()
  for (const o of ongoing) {
    busy.add(o.aId)
    busy.add(o.bId)
  }
  const waiting = session.attendeeIds.filter((id) => !busy.has(id))

  const makeOngoing = (aId: string, bId: string): Ongoing => ({
    key: crypto.randomUUID(),
    aId,
    bId,
    handicapA: hcapOf(aId),
    handicapB: hcapOf(bId),
    scoreA: '',
    scoreB: '',
  })

  const matchEveryone = () => {
    const pairs = matchAll({ waitingIds: waiting, meetCount, todayGameCount })
    if (pairs.length === 0) return
    setOngoing((prev) => [...prev, ...pairs.map((p) => makeOngoing(p.aId, p.bId))])
  }

  const recommendOne = () => {
    const p = recommendNext({ waitingIds: waiting, meetCount, todayGameCount })
    if (!p) return
    setOngoing((prev) => [...prev, makeOngoing(p.aId, p.bId)])
  }

  const patch = (key: string, field: keyof Ongoing, value: string | number) =>
    setOngoing((prev) => prev.map((o) => (o.key === key ? { ...o, [field]: value } : o)))

  const cancel = (key: string) => setOngoing((prev) => prev.filter((o) => o.key !== key))

  const save = (o: Ongoing) => {
    const scoreA = Math.max(0, parseInt(o.scoreA || '0', 10) || 0)
    const scoreB = Math.max(0, parseInt(o.scoreB || '0', 10) || 0)
    const endType = scoreA >= o.handicapA || scoreB >= o.handicapB ? 'cleared' : 'time'
    addGame(session.id, {
      playerAId: o.aId,
      playerBId: o.bId,
      handicapA: o.handicapA,
      handicapB: o.handicapB,
      scoreA,
      scoreB,
      endType,
    })
    cancel(o.key)
  }

  return (
    <div className="tab">
      <div className="board-head">
        <div>
          <h2 className="tab-title">{session.date} 모임</h2>
          <span className="muted">
            참석 {session.attendeeIds.length} · 경기중 {ongoing.length} · 대기 {waiting.length} · 완료 {session.games.length}
          </span>
        </div>
        {isAdmin && <button onClick={() => setEditAttendees((v) => !v)}>참석자</button>}
      </div>

      {editAttendees && (
        <AttendeeEditor
          members={members}
          attendeeIds={session.attendeeIds}
          onChange={(ids) => setAttendees(session.id, ids)}
        />
      )}

      <div className="board-actions">
        <button className="primary grow" disabled={waiting.length < 2} onClick={matchEveryone}>
          대기자 전체 매칭
        </button>
        <button className="grow" disabled={waiting.length < 2} onClick={recommendOne}>
          빈 테이블 추천
        </button>
      </div>

      <div className="court-grid">
        {ongoing.map((o, i) => (
          <div key={o.key} className="card court">
            <div className="court-label">테이블 {i + 1}</div>
            <div className="court-row">
              <span className="court-name">{name(o.aId)}</span>
              <span className="vs">vs</span>
              <span className="court-name right">{name(o.bId)}</span>
            </div>
            <div className="court-inputs">
              <ScoreCell
                handicap={o.handicapA}
                score={o.scoreA}
                onHcap={(v) => patch(o.key, 'handicapA', v)}
                onScore={(v) => patch(o.key, 'scoreA', v)}
              />
              <ScoreCell
                handicap={o.handicapB}
                score={o.scoreB}
                onHcap={(v) => patch(o.key, 'handicapB', v)}
                onScore={(v) => patch(o.key, 'scoreB', v)}
              />
            </div>
            <div className="court-buttons">
              <button className="primary grow" onClick={() => save(o)}>
                결과 저장
              </button>
              <button onClick={() => cancel(o.key)}>취소</button>
            </div>
          </div>
        ))}

        {waiting.length >= 2 && (
          <button className="card court empty" onClick={recommendOne}>
            <span>+ 빈 테이블</span>
            <span className="muted">대기자 매칭</span>
          </button>
        )}
      </div>

      {waiting.length > 0 && (
        <div className="waiting">
          <span className="muted">대기 중</span>
          <div className="chip-grid">
            {waiting.map((id) => (
              <span key={id} className="chip static">
                {name(id)}
              </span>
            ))}
          </div>
        </div>
      )}

      {session.games.length > 0 && (
        <div className="results">
          <div className="results-head">
            <span className="muted">오늘 완료된 경기</span>
            <div className="share-buttons">
              <button
                onClick={async () => {
                  const copied = await shareText(buildResultText(session, members))
                  if (copied) alert('결과를 클립보드에 복사했습니다.')
                }}
              >
                텍스트 공유
              </button>
              <button
                onClick={() => {
                  if (resultsRef.current) shareImage(resultsRef.current, `당구결과-${session.date}.png`)
                }}
              >
                이미지 공유
              </button>
            </div>
          </div>
          <ul className="result-list" ref={resultsRef}>
            {session.games.map((g) => {
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
                  {(isAdmin || g.playedAt >= mountTime) && (<button className="del" onClick={() => deleteGame(session.id, g.id)} aria-label="삭제">✕</button>)}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function ScoreCell({
  handicap,
  score,
  onHcap,
  onScore,
}: {
  handicap: number
  score: string
  onHcap: (v: number) => void
  onScore: (v: string) => void
}) {
  return (
    <div className="score-cell">
      <input
        className="score"
        inputMode="numeric"
        placeholder="득점"
        value={score}
        onChange={(e) => onScore(e.target.value.replace(/[^0-9]/g, ''))}
      />
      <label className="hcap-mini">
        / 핸디
        <input type="number" min={1} value={handicap} onChange={(e) => onHcap(Math.max(1, +e.target.value))} />
      </label>
    </div>
  )
}

function AttendeeEditor({
  members,
  attendeeIds,
  onChange,
}: {
  members: Member[]
  attendeeIds: string[]
  onChange: (ids: string[]) => void
}) {
  const active = members.filter((m) => m.active || attendeeIds.includes(m.id))
  const set = new Set(attendeeIds)
  const toggle = (id: string) => {
    const next = new Set(set)
    next.has(id) ? next.delete(id) : next.add(id)
    onChange([...next])
  }
  return (
    <div className="card">
      <span className="muted">참석자 편집 (늦게 온 사람 추가)</span>
      <div className="chip-grid">
        {active.map((m) => (
          <button key={m.id} className={`chip${set.has(m.id) ? ' on' : ''}`} onClick={() => toggle(m.id)}>
            {m.name}
          </button>
        ))}
      </div>
    </div>
  )
}






