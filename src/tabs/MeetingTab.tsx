import { useMemo, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import type { Member, Session } from '../types'
import { buildMeetCount, matchTwoRounds } from '../logic/matching'
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
  round?: number
}

export function MeetingTab() {
  const members = useApp((s) => s.members)
  const sessions = useApp((s) => s.sessions)
  const createSession = useApp((s) => s.createSession)
  const { isAdmin } = useAdmin()
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const current = sessions.find((s) => s.date === selectedDate)

  if (!current) {
    // 관리자만 모임 시작 가능, 일반회원은 안내 + 날짜 선택만
    if (!isAdmin) {
      return (
        <div className="tab">
          <h2 className="tab-title">모임</h2>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>📅 날짜</span>
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ flex: 1 }} />
          </div>
          <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>
            해당 날짜에 등록된 모임이 없습니다.
          </p>
        </div>
      )
    }
    return (
      <AttendeePicker
        members={members}
        date={selectedDate}
        onDateChange={setSelectedDate}
        onStart={(ids, type) => createSession(selectedDate, ids, type)}
      />
    )
  }
  return (
    <Board
      key={current.id}
      session={current}
      members={members}
      sessions={sessions}
      selectedDate={selectedDate}
      onDateChange={setSelectedDate}
    />
  )
}

function AttendeePicker({ members, date, onDateChange, onStart }: {
  members: Member[]
  date: string
  onDateChange: (d: string) => void
  onStart: (ids: string[], type: 'regular' | 'flash') => void
}) {
  const PINNED = ['엄재익', '이제한']
  const active = [...members.filter((m) => m.active)].sort((a, b) => {
    const ai = PINNED.indexOf(a.name), bi = PINNED.indexOf(b.name)
    if (ai !== -1 || bi !== -1) {
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    }
    return a.name.localeCompare(b.name, 'ko')
  })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [meetingType, setMeetingType] = useState<'regular' | 'flash'>('regular')

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="tab">
      <h2 className="tab-title">모임 시작</h2>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>📅 날짜</span>
        <input
          type="date"
          value={date}
          onChange={(e) => { onDateChange(e.target.value); setSelected(new Set()) }}
          style={{ flex: 1 }}
        />
      </div>

      <div className="card" style={{ display: 'flex', gap: 8 }}>
        <button
          className={meetingType === 'regular' ? 'primary grow' : 'grow'}
          onClick={() => setMeetingType('regular')}
          style={{ flex: 1 }}
        >
          📋 정기모임
        </button>
        <button
          className={meetingType === 'flash' ? 'primary grow' : 'grow'}
          onClick={() => setMeetingType('flash')}
          style={{ flex: 1 }}
        >
          ⚡ 번개모임
        </button>
      </div>

      {meetingType === 'flash' && (
        <div style={{ fontSize: 12, color: '#c07000', background: '#fff8e1', borderRadius: 8, padding: '8px 12px' }}>
          ⚡ 번개모임 기록은 관리자 승인 후 정규 통계에 반영됩니다.
        </div>
      )}

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
        onClick={() => onStart([...selected], meetingType)}
      >
        {selected.size}명으로 {meetingType === 'regular' ? '정기' : '번개'}모임 시작
      </button>
    </div>
  )
}

function Board({ session, members, sessions, selectedDate, onDateChange }: {
  session: Session
  members: Member[]
  sessions: Session[]
  selectedDate: string
  onDateChange: (d: string) => void
}) {
  const { isAdmin } = useAdmin()
  const addGame = useApp((s) => s.addGame)
  const deleteGame = useApp((s) => s.deleteGame)
  const setAttendees = useApp((s) => s.setAttendees)
  const approveSession = useApp((s) => s.approveSession)

  const [ongoing, setOngoing] = useState<Ongoing[]>([])
  const [editAttendees, setEditAttendees] = useState(false)
  const [manualA, setManualA] = useState<string | null>(null)
  const [lineupText, setLineupText] = useState<string | null>(null)
  const resultsRef = useRef<HTMLUListElement>(null)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const name = (id: string) => memberMap.get(id)?.name ?? '알수없음'
  const hcapOf = (id: string) => memberMap.get(id)?.handicap ?? 20

  const meetCount = useMemo(() => buildMeetCount(sessions), [sessions])

  const busy = new Set<string>()
  for (const o of ongoing) { busy.add(o.aId); busy.add(o.bId) }
  const waiting = session.attendeeIds.filter((id) => !busy.has(id))

  const isFlash = session.type === 'flash'
  const isApproved = session.approved !== false

  // 이제한 ID
  const sitOutMember = members.find((m) => m.name === '이제한')
  const sitOutId = sitOutMember?.id ?? null

  const makeOngoing = (aId: string, bId: string, round?: number): Ongoing => ({
    key: crypto.randomUUID(),
    aId, bId,
    handicapA: hcapOf(aId),
    handicapB: hcapOf(bId),
    scoreA: '', scoreB: '',
    round,
  })

  const autoMatch2Rounds = () => {
    const { round1, round2 } = matchTwoRounds(waiting, meetCount, sitOutId)
    const newOngoing = [
      ...round1.map((p) => makeOngoing(p.aId, p.bId, 1)),
      ...round2.map((p) => makeOngoing(p.aId, p.bId, 2)),
    ]
    setOngoing((prev) => [...prev, ...newOngoing])
  }

  const addManualPair = (bId: string) => {
    if (!manualA || manualA === bId) return
    setOngoing((prev) => [...prev, makeOngoing(manualA, bId)])
    setManualA(null)
  }

  const patch = (key: string, field: keyof Ongoing, value: string | number) =>
    setOngoing((prev) => prev.map((o) => (o.key === key ? { ...o, [field]: value } : o)))

  const cancel = (key: string) => setOngoing((prev) => prev.filter((o) => o.key !== key))

  const save = (o: Ongoing) => {
    const scoreA = Math.max(0, parseInt(o.scoreA || '0', 10) || 0)
    const scoreB = Math.max(0, parseInt(o.scoreB || '0', 10) || 0)
    const endType = scoreA >= o.handicapA || scoreB >= o.handicapB ? 'cleared' : 'time'
    addGame(session.id, {
      playerAId: o.aId, playerBId: o.bId,
      handicapA: o.handicapA, handicapB: o.handicapB,
      scoreA, scoreB, endType,
    })
    cancel(o.key)
  }

  // 카톡 배포용 대진표 텍스트 생성 (1부/2부 + 대기자)
  const buildLineupText = () => {
    const r1 = ongoing.filter((o) => o.round === 1)
    const r2 = ongoing.filter((o) => o.round === 2)
    const other = ongoing.filter((o) => !o.round)
    const matched = new Set<string>()
    ongoing.forEach((o) => { matched.add(o.aId); matched.add(o.bId) })
    const sitOut = session.attendeeIds.filter((id) => !matched.has(id))
    const line = (o: Ongoing) => `${name(o.aId)}(${o.handicapA}) - ${name(o.bId)}(${o.handicapB})`
    let txt = `🎱 당신회 정기모임 대진표 🎱\n📅 ${session.date}\n`
    if (r1.length) txt += `\n━━━ 1부 (16:00~17:00) ━━━\n${r1.map(line).join('\n')}\n`
    if (r2.length) txt += `\n━━━ 2부 (17:00~18:00) ━━━\n${r2.map(line).join('\n')}\n`
    if (other.length) txt += `\n━━━ 대진 ━━━\n${other.map(line).join('\n')}\n`
    if (sitOut.length) txt += `\n⏸ 대기: ${sitOut.map(name).join(', ')}\n`
    txt += `\n⏰ 시간 엄수 바랍니다.`
    return txt
  }

  const typeLabel = isFlash ? '⚡ 번개모임' : '📋 정기모임'
  const typeBadgeStyle: React.CSSProperties = {
    fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
    background: isFlash ? '#fff3cd' : '#e1f5ee',
    color: isFlash ? '#856404' : '#0f6e56',
  }

  return (
    <div className="tab">
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>📅 날짜</span>
        <input type="date" value={selectedDate} onChange={(e) => onDateChange(e.target.value)} style={{ flex: 1 }} />
      </div>

      <div className="board-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="tab-title" style={{ margin: 0 }}>{session.date} 모임</h2>
            <span style={typeBadgeStyle}>{typeLabel}</span>
            {isFlash && !isApproved && (
              <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, background: '#fce8e8', color: '#c0392b', fontWeight: 600 }}>
                승인 대기
              </span>
            )}
          </div>
          <span className="muted">
            참석 {session.attendeeIds.length} · 경기중 {ongoing.length} · 대기 {waiting.length} · 완료 {session.games.length}
          </span>
        </div>
        {isAdmin && <button onClick={() => setEditAttendees((v) => !v)}>참석자</button>}
      </div>

      {isFlash && !isApproved && isAdmin && (
        <div style={{ background: '#fff8e1', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 13 }}>⚡ 번개모임 기록을 정규 통계에 반영할까요?</span>
          <button className="primary" onClick={() => { if (window.confirm('이 번개모임 기록을 승인할까요?')) approveSession(session.id) }}>
            승인
          </button>
        </div>
      )}
      {isFlash && isApproved && (
        <div style={{ fontSize: 12, color: '#0f6e56', background: '#e1f5ee', borderRadius: 8, padding: '6px 12px' }}>
          ✅ 승인됨 — 정규 통계에 반영됩니다.
        </div>
      )}

      {editAttendees && (
        <AttendeeEditor
          members={members}
          attendeeIds={session.attendeeIds}
          onChange={(ids) => setAttendees(session.id, ids)}
        />
      )}

      {/* 자동매칭 + 카톡 대진표 (관리자만) */}
      {isAdmin && (
        <div className="board-actions">
          <button className="primary grow" disabled={waiting.length < 2} onClick={autoMatch2Rounds}>
            🔀 자동매칭 (2라운드)
          </button>
          <button className="grow" disabled={ongoing.length === 0} onClick={() => setLineupText(buildLineupText())}>
            📋 카톡 대진표
          </button>
        </div>
      )}

      {/* 수동매칭 (관리자만) */}
      {isAdmin && waiting.length >= 2 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            ✋ 수동매칭 {manualA ? `— ${name(manualA)} 선택됨, 상대를 선택하세요` : '— 첫 번째 선수를 선택하세요'}
          </span>
          <div className="chip-grid">
            {waiting.map((id) => (
              <button
                key={id}
                className={`chip${manualA === id ? ' on' : ''}`}
                onClick={() => {
                  if (!manualA) { setManualA(id) }
                  else if (manualA === id) { setManualA(null) }
                  else { addManualPair(id) }
                }}
              >
                {name(id)}
              </button>
            ))}
          </div>
          {manualA && (
            <button onClick={() => setManualA(null)} style={{ fontSize: 12, alignSelf: 'flex-start' }}>취소</button>
          )}
        </div>
      )}

      {/* 진행 중 테이블 */}
      <div className="court-grid">
        {ongoing.map((o, i) => (
          <div key={o.key} className="card court">
            <div className="court-label">
              테이블 {i + 1}{o.round ? ` (${o.round}라운드)` : ''}
            </div>
            <div className="court-row">
              <span className="court-name">{name(o.aId)}</span>
              <span className="vs">vs</span>
              <span className="court-name right">{name(o.bId)}</span>
            </div>
            <div className="court-inputs">
              <ScoreCell handicap={o.handicapA} score={o.scoreA}
                onHcap={(v) => patch(o.key, 'handicapA', v)}
                onScore={(v) => patch(o.key, 'scoreA', v)} />
              <ScoreCell handicap={o.handicapB} score={o.scoreB}
                onHcap={(v) => patch(o.key, 'handicapB', v)}
                onScore={(v) => patch(o.key, 'scoreB', v)} />
            </div>
            <div className="court-buttons">
              <button className="primary grow" onClick={() => save(o)}>결과 저장</button>
              {isAdmin && <button onClick={() => cancel(o.key)}>취소</button>}
            </div>
          </div>
        ))}
      </div>

      {session.games.length > 0 && (
        <div className="results">
          <div className="results-head">
            <span className="muted">완료된 경기</span>
            <div className="share-buttons">
              <button onClick={async () => {
                const copied = await shareText(buildResultText(session, members))
                if (copied) alert('결과를 클립보드에 복사했습니다.')
              }}>텍스트 공유</button>
              <button onClick={() => {
                if (resultsRef.current) shareImage(resultsRef.current, `당구결과-${session.date}.png`)
              }}>이미지 공유</button>
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
                  {isAdmin && (
                    <button className="del" onClick={() => deleteGame(session.id, g.id)} aria-label="삭제">✕</button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {lineupText !== null && (
        <LineupModal text={lineupText} onClose={() => setLineupText(null)} />
      )}
    </div>
  )
}

function LineupModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const ok = await shareText(text)
    setCopied(ok)
  }
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: 20,
        width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>📋 카톡 대진표</span>
        <span className="muted" style={{ fontSize: 12 }}>아래 내용을 복사해 카카오톡 단체방에 붙여넣으세요.</span>
        <textarea readOnly value={text} style={{
          width: '100%', height: 280, fontSize: 13, lineHeight: 1.6,
          padding: 10, borderRadius: 8, border: '1px solid var(--border)', resize: 'none',
          fontFamily: 'inherit',
        }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary block" style={{ flex: 1 }} onClick={copy}>{copied ? '✅ 복사됨' : '복사하기'}</button>
          <button className="block" style={{ flex: 1 }} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}

function ScoreCell({ handicap, score, onHcap, onScore }: {
  handicap: number; score: string
  onHcap: (v: number) => void; onScore: (v: string) => void
}) {
  return (
    <div className="score-cell">
      <input className="score" inputMode="numeric" placeholder="득점" value={score}
        onChange={(e) => onScore(e.target.value.replace(/[^0-9]/g, ''))} />
      <label className="hcap-mini">
        / 핸디
        <input type="number" min={1} value={handicap} onChange={(e) => onHcap(Math.max(1, +e.target.value))} />
      </label>
    </div>
  )
}

function AttendeeEditor({ members, attendeeIds, onChange }: {
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
