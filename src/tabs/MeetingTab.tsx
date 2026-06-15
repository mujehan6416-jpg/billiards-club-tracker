import { useMemo, useRef, useState } from 'react'
import { useApp } from '../store/appStore'
import type { LineupMatch, Member, Session } from '../types'
import { buildMeetCount, matchTwoRounds, pairKey } from '../logic/matching'
import { winnerId } from '../logic/game'
import { todayStr } from '../lib/date'
import { fmtScore } from '../lib/format'
import { buildResultText, shareImage, shareText } from '../lib/share'
import { uploadToCloud } from '../lib/cloudSync'
import { useAdmin } from '../store/adminStore'

// 카톡 대진표용: 기본 장소 + 날짜별 예외 장소
const LOCATION_DEFAULT = '수영 센텀당구클럽'
const LOCATION_OVERRIDES: Record<string, string> = {
  '2026-06-17': '남포동 다빈치당구장',
}
const locationOf = (date: string) => LOCATION_OVERRIDES[date] ?? LOCATION_DEFAULT

// 날짜 → 정기모임 회차 (2026년)
const ROUND_BY_DATE: Record<string, number> = {
  '2026-01-21': 21, '2026-02-25': 22, '2026-03-25': 23, '2026-04-18': 24,
  '2026-05-20': 25, '2026-06-17': 26, '2026-07-15': 27, '2026-08-19': 28,
  '2026-09-16': 29, '2026-10-17': 30, '2026-11-18': 31, '2026-12-16': 32,
}

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
  const deleteSession = useApp((s) => s.deleteSession)
  const publishLineup = useApp((s) => s.publishLineup)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const name = (id: string) => memberMap.get(id)?.name ?? '알수없음'
  const hcapOf = (id: string) => memberMap.get(id)?.handicap ?? 20

  // 게시된 대진표(session.lineup)를 작업 상태로 초기화 (이미 결과 입력된 경기는 제외)
  const [ongoing, setOngoing] = useState<Ongoing[]>(() =>
    (session.lineup ?? [])
      .filter((m) => !session.games.some((g) => g.round === m.round &&
        ((g.playerAId === m.aId && g.playerBId === m.bId) || (g.playerAId === m.bId && g.playerBId === m.aId))))
      .map((m) => ({
        key: crypto.randomUUID(),
        aId: m.aId, bId: m.bId, handicapA: m.handicapA, handicapB: m.handicapB,
        scoreA: '', scoreB: '', round: m.round,
      })),
  )
  const [sitOut, setSitOut] = useState<string[]>(() => session.sitOutIds ?? [])
  const [editAttendees, setEditAttendees] = useState(false)
  const [manualSel, setManualSel] = useState<{ round: number; id: string } | null>(null)
  const [lineupText, setLineupText] = useState<string | null>(null)
  const resultsRef = useRef<HTMLUListElement>(null)

  const meetCount = useMemo(() => buildMeetCount(sessions), [sessions])

  const isFlash = session.type === 'flash'
  const isApproved = session.approved !== false

  // 이제한 ID (홀수 시 대기)
  const sitOutId = members.find((m) => m.name === '이제한')?.id ?? null

  // 금지 대진: 엄재익 회장 ↔ 이제한 총무는 서로 대진하지 않음
  const forbiddenPairs = useMemo(() => {
    const set = new Set<string>()
    const a = members.find((m) => m.name === '엄재익')?.id
    const b = members.find((m) => m.name === '이제한')?.id
    if (a && b) set.add(pairKey(a, b))
    return set
  }, [members])

  // 라운드별 매칭/미대진자
  const sitOutSet = new Set(sitOut)
  const playingIds = session.attendeeIds.filter((id) => !sitOutSet.has(id))
  const matchedInRound = (round: number) => {
    const s = new Set<string>()
    ongoing.filter((o) => o.round === round).forEach((o) => { s.add(o.aId); s.add(o.bId) })
    // 이미 결과가 저장된 경기의 선수도 해당 라운드 매칭 완료로 간주
    session.games.filter((g) => g.round === round).forEach((g) => { s.add(g.playerAId); s.add(g.playerBId) })
    return s
  }
  const unmatchedInRound = (round: number) => {
    const m = matchedInRound(round)
    return playingIds.filter((id) => !m.has(id))
  }

  const makeOngoing = (aId: string, bId: string, round: number): Ongoing => ({
    key: crypto.randomUUID(),
    aId, bId,
    handicapA: hcapOf(aId),
    handicapB: hcapOf(bId),
    scoreA: '', scoreB: '',
    round,
  })

  const autoMatch2Rounds = () => {
    const ids = [...session.attendeeIds]
    const sit = (ids.length % 2 !== 0 && sitOutId && ids.includes(sitOutId)) ? [sitOutId] : []
    const { round1, round2 } = matchTwoRounds(ids, meetCount, sitOutId, forbiddenPairs)
    setOngoing([
      ...round1.map((p) => makeOngoing(p.aId, p.bId, 1)),
      ...round2.map((p) => makeOngoing(p.aId, p.bId, 2)),
    ])
    setSitOut(sit)
    setManualSel(null)
  }

  // 미대진자 칩 탭 → 같은 라운드 두 명 선택 시 매칭
  const tapUnmatched = (round: number, id: string) => {
    if (!manualSel || manualSel.round !== round) { setManualSel({ round, id }); return }
    if (manualSel.id === id) { setManualSel(null); return }
    setOngoing((prev) => [...prev, makeOngoing(manualSel.id, id, round)])
    setManualSel(null)
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
      scoreA, scoreB, endType, round: o.round,
    })
    cancel(o.key)
  }

  // 카톡 배포용 대진표 텍스트 생성 (1부/2부 + 대기자)
  const buildLineupText = () => {
    const line = (o: Ongoing) => `${name(o.aId)}(${o.handicapA}) - ${name(o.bId)}(${o.handicapB})`
    const r1 = ongoing.filter((o) => o.round === 1)
    const r2 = ongoing.filter((o) => o.round === 2)
    const round = ROUND_BY_DATE[session.date]
    const title = round ? `🎱 제${round}차 당신회 정기모임 대진표 🎱` : `🎱 당신회 정기모임 대진표 🎱`
    let txt = `${title}\n📅 ${session.date}\n📍 ${locationOf(session.date)}\n`
    if (r1.length) txt += `\n━━━ 1부 (16:00~17:00) ━━━\n${r1.map(line).join('\n')}\n`
    if (r2.length) txt += `\n━━━ 2부 (17:00~18:00) ━━━\n${r2.map(line).join('\n')}\n`
    if (sitOut.length) txt += `\n⏸ 대기: ${sitOut.map(name).join(', ')}\n`
    txt += `\n⏰ 시간 엄수 바랍니다.`
    return txt
  }

  // 모임 통째로 삭제 (날짜 오설정 등) → 게시 대진표·경기 모두 제거, 클라우드 반영
  const removeSession = async () => {
    if (!window.confirm(`${session.date} 모임을 삭제할까요?\n게시된 대진표와 입력된 경기 기록이 모두 삭제됩니다.`)) return
    deleteSession(session.id)
    const s = useApp.getState()
    try {
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings })
    } catch {
      // 업로드 실패해도 로컬에서는 삭제됨
    }
  }

  // 대진표를 게시(클라우드 업로드) → 일반회원 열람 가능
  const doPublish = async () => {
    const lineup: LineupMatch[] = ongoing
      .filter((o) => o.round === 1 || o.round === 2)
      .map((o) => ({ round: o.round!, aId: o.aId, bId: o.bId, handicapA: o.handicapA, handicapB: o.handicapB }))
    publishLineup(session.id, lineup, sitOut)
    const s = useApp.getState()
    await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings })
  }

  const typeLabel = isFlash ? '⚡ 번개모임' : '📋 정기모임'
  const typeBadgeStyle: React.CSSProperties = {
    fontSize: 11, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
    background: isFlash ? '#fff3cd' : '#e1f5ee',
    color: isFlash ? '#856404' : '#0f6e56',
  }

  // 매칭이 시작된 후(자동매칭/게시/결과)에만 라운드 그룹 표시
  const started = ongoing.length > 0 || session.games.length > 0 || (session.lineup?.length ?? 0) > 0

  const renderRoundGroup = (round: number) => {
    const matches = ongoing.filter((o) => o.round === round)
    const unmatched = unmatchedInRound(round)
    if (matches.length === 0 && unmatched.length === 0) return null
    return (
      <div key={round} style={{ marginTop: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '6px 0', color: '#072B61' }}>
          {round === 1 ? '1부 (16:00~17:00)' : '2부 (17:00~18:00)'}
        </h3>
        <div className="court-grid">
          {matches.map((o, i) => (
            <div key={o.key} className="card court">
              <div className="court-label">테이블 {i + 1}</div>
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
                <button onClick={() => cancel(o.key)}>취소</button>
              </div>
            </div>
          ))}
        </div>
        {unmatched.length >= 1 && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#c0392b' }}>
              ({round}라운드 미대진자) {unmatched.map(name).join(', ')}
              {manualSel?.round === round ? ` — ${name(manualSel.id)} 선택됨, 상대 선택` : unmatched.length >= 2 ? ' — 두 명을 눌러 매칭' : ''}
            </span>
            {unmatched.length >= 2 && (
              <div className="chip-grid">
                {unmatched.map((id) => (
                  <button key={id}
                    className={`chip${manualSel?.round === round && manualSel.id === id ? ' on' : ''}`}
                    onClick={() => tapUnmatched(round, id)}>
                    {name(id)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    )
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
          <span className="muted">참석 {session.attendeeIds.length}명 · 완료 {session.games.length}경기</span>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditAttendees((v) => !v)}>참석자</button>
            <button onClick={removeSession} style={{ color: '#c0392b', borderColor: '#e0a0a0' }}>모임 삭제</button>
          </div>
        )}
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

      {/* === 일반회원: 게시된 대진표 읽기 전용 === */}
      {!isAdmin && (
        <LineupView lineup={session.lineup ?? []} sitOutIds={session.sitOutIds ?? []} name={name} />
      )}

      {/* === 관리자: 대진 편집/점수 입력 === */}
      {isAdmin && (
        <>
          {editAttendees && (
            <AttendeeEditor
              members={members}
              attendeeIds={session.attendeeIds}
              onChange={(ids) => setAttendees(session.id, ids)}
            />
          )}

          <div className="board-actions">
            <button className="primary grow" disabled={session.attendeeIds.length < 2} onClick={autoMatch2Rounds}>
              🔀 자동매칭 (2라운드)
            </button>
            <button className="grow" disabled={ongoing.length === 0} onClick={() => setLineupText(buildLineupText())}>
              📋 카톡 대진표
            </button>
          </div>

          {started && renderRoundGroup(1)}
          {started && renderRoundGroup(2)}

          {sitOut.length > 0 && (
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>⏸ 대기: {sitOut.map(name).join(', ')}</div>
          )}
        </>
      )}

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
        <LineupModal text={lineupText} onPublish={doPublish} onClose={() => setLineupText(null)} />
      )}
    </div>
  )
}

// 일반회원용 읽기 전용 대진표
function LineupView({ lineup, sitOutIds, name }: {
  lineup: LineupMatch[]
  sitOutIds: string[]
  name: (id: string) => string
}) {
  if (lineup.length === 0) {
    return <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>대진표가 아직 게시되지 않았습니다.</p>
  }
  const renderRound = (round: number, label: string) => {
    const matches = lineup.filter((m) => m.round === round)
    if (matches.length === 0) return null
    return (
      <div style={{ marginTop: 6 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '6px 0', color: '#072B61' }}>{label}</h3>
        <ul className="result-list">
          {matches.map((m, i) => (
            <li key={i} className="card result-row">
              <span>{name(m.aId)}({m.handicapA})</span>
              <span className="vs">vs</span>
              <span className="right">{name(m.bId)}({m.handicapB})</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <div>
      {renderRound(1, '1부 (16:00~17:00)')}
      {renderRound(2, '2부 (17:00~18:00)')}
      {sitOutIds.length > 0 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>⏸ 대기: {sitOutIds.map(name).join(', ')}</div>
      )}
    </div>
  )
}

function LineupModal({ text, onPublish, onClose }: { text: string; onPublish: () => Promise<void>; onClose: () => void }) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const copyAndPublish = async () => {
    setStatus('saving')
    // 클립보드 복사 (포커스 없을 때 등 실패는 무시)
    try { await navigator.clipboard.writeText(text) } catch { /* 무시 */ }
    // 클라우드 게시 → 일반회원 열람 가능 (핵심 동작)
    try {
      await onPublish()
      setStatus('done')
    } catch {
      setStatus('error')
    }
  }
  const label = status === 'done' ? '✅ 복사·게시됨' : status === 'saving' ? '저장 중...' : status === 'error' ? '복사됨 (게시 실패)' : '복사 + 회원에게 게시'
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
        <span className="muted" style={{ fontSize: 12 }}>복사하면 카톡에 붙여넣을 수 있고, 동시에 회원들이 앱에서 볼 수 있게 게시됩니다.</span>
        <textarea readOnly value={text} style={{
          width: '100%', height: 280, fontSize: 13, lineHeight: 1.6,
          padding: 10, borderRadius: 8, border: '1px solid var(--border)', resize: 'none',
          fontFamily: 'inherit',
        }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary block" style={{ flex: 1 }} disabled={status === 'saving'} onClick={copyAndPublish}>{label}</button>
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
