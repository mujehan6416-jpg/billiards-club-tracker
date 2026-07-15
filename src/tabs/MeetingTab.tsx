import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPicker } from '../components/CalendarPicker'
import { useApp } from '../store/appStore'
import type { LineupMatch, Member, Session } from '../types'
import {
  buildMeetCount, matchAll, matchRoundOne, matchRoundTwo, pairKey,
  canRematchRound, toggleParticipant, replaceRound, applyNewAttendees,
} from '../logic/matching'
import { winnerId } from '../logic/game'
import { todayStr } from '../lib/date'
import { fmtScore } from '../lib/format'
import { buildResultText, shareImage, shareText } from '../lib/share'
import { uploadToCloud, UploadCancelledError } from '../lib/cloudSync'
import { useAdmin } from '../store/adminStore'
import { useAuth } from '../store/authStore'

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
  const { isGuest } = useAuth()
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creatingFlash, setCreatingFlash] = useState(false)

  const daySessions = sessions.filter((s) => s.date === selectedDate)
  const current = daySessions.find((s) => s.id === selectedId) ?? daySessions[0] ?? null

  const markedDates = useMemo(() => {
    const set = new Set<string>()
    sessions.forEach((s) => { if (s.games.some((g) => !g.pending)) set.add(s.date) })
    return set
  }, [sessions])

  const handleDateChange = (d: string) => {
    setSelectedDate(d)
    setSelectedId(null)
    setCreatingFlash(false)
  }

  const handleStart = (ids: string[], type: 'regular' | 'flash') => {
    const id = createSession(selectedDate, ids, type)
    setSelectedId(id)
    setCreatingFlash(false)
    // 참석자 선택 화면에서 아래로 스크롤된 상태 그대로 남으면
    // 자동/수동매칭 버튼이 화면 위쪽 밖에 있게 되므로 맨 위로 이동
    window.scrollTo({ top: 0 })
  }

  if (isGuest) {
    if (current) {
      return (
        <Board
          key={current.id}
          session={current}
          members={members}
          sessions={sessions}
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
          daySessions={daySessions}
          selectedId={current.id}
          onSelectSession={setSelectedId}
          onAddFlash={() => {}}
          markedDates={markedDates}
          guestMode
        />
      )
    }
    return (
      <div className="tab">
        <h2 className="tab-title">모임</h2>
        <div className="card">
          <CalendarPicker value={selectedDate} onChange={handleDateChange} markedDates={markedDates} />
        </div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 16 }}>
          파란 점이 있는 날짜를 선택하면 경기 결과를 확인할 수 있습니다.
        </p>
      </div>
    )
  }

  if (!current || creatingFlash) {
    return (
      <AttendeePicker
        members={members}
        date={selectedDate}
        onDateChange={handleDateChange}
        onStart={handleStart}
        flashOnly={!isAdmin || creatingFlash}
        markedDates={markedDates}
        onCancel={creatingFlash ? () => setCreatingFlash(false) : undefined}
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
      onDateChange={handleDateChange}
      daySessions={daySessions}
      selectedId={current.id}
      onSelectSession={setSelectedId}
      onAddFlash={() => setCreatingFlash(true)}
      markedDates={markedDates}
    />
  )
}

function AttendeePicker({ members, date, onDateChange, onStart, flashOnly = false, onCancel, markedDates }: {
  members: Member[]
  date: string
  onDateChange: (d: string) => void
  onStart: (ids: string[], type: 'regular' | 'flash') => void
  flashOnly?: boolean
  onCancel?: () => void
  markedDates?: Set<string>
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
  const [meetingType, setMeetingType] = useState<'regular' | 'flash'>(flashOnly ? 'flash' : 'regular')

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="tab">
      <h2 className="tab-title">모임 시작</h2>

      <div className="card">
        <CalendarPicker value={date} onChange={(d) => { onDateChange(d); setSelected(new Set()) }} markedDates={markedDates} />
      </div>

      {!flashOnly && (
        <div className="card" style={{ display: 'flex', gap: 8 }}>
          <button
            className={meetingType === 'regular' ? 'primary grow' : 'grow'}
            onClick={() => setMeetingType('regular')}
            style={{ flex: 1, fontSize: 18, padding: '15px 8px' }}
          >
            📋 정기모임
          </button>
          <button
            className={meetingType === 'flash' ? 'primary grow' : 'grow'}
            onClick={() => setMeetingType('flash')}
            style={{ flex: 1, fontSize: 18, padding: '15px 8px' }}
          >
            ⚡ 번개모임
          </button>
        </div>
      )}

      {(meetingType === 'flash' || flashOnly) && (
        <div style={{ fontSize: 16, lineHeight: 1.5, color: '#c07000', background: '#fff8e1', borderRadius: 8, padding: '12px 14px' }}>
          ⚡ 번개모임 기록은 관리자 승인 후 정규 통계에 반영됩니다.
        </div>
      )}

      {active.length === 0 && <p className="muted">먼저 회원 탭에서 회원을 추가하세요.</p>}
      <div className="chip-grid chip-grid-5">
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
        onClick={() => onStart([...selected], flashOnly ? 'flash' : meetingType)}
        style={{ fontSize: 18, padding: 15 }}
      >
        {selected.size}명으로 {(flashOnly || meetingType === 'flash') ? '번개' : '정기'}모임 시작
      </button>
      {onCancel && (
        <button className="block" onClick={onCancel} style={{ marginTop: 4, fontSize: 16, padding: 13 }}>취소</button>
      )}
    </div>
  )
}

function Board({ session, members, sessions, selectedDate, onDateChange, daySessions, selectedId, onSelectSession, onAddFlash, markedDates, guestMode }: {
  session: Session
  members: Member[]
  sessions: Session[]
  selectedDate: string
  onDateChange: (d: string) => void
  daySessions: Session[]
  selectedId: string
  onSelectSession: (id: string) => void
  onAddFlash: () => void
  markedDates?: Set<string>
  guestMode?: boolean
}) {
  const { isAdmin } = useAdmin()
  const addGame = useApp((s) => s.addGame)
  const deleteGame = useApp((s) => s.deleteGame)
  const setAttendees = useApp((s) => s.setAttendees)
  const approveSession = useApp((s) => s.approveSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const publishLineup = useApp((s) => s.publishLineup)
  const setRoundParticipants = useApp((s) => s.setRoundParticipants)

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const name = (id: string) => guestMode ? '●●●' : (memberMap.get(id)?.name ?? '알수없음')
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
  // 라운드별 "이번 라운드 경기 참가" 선택(관리자가 직접 지정). 세션에 저장된 값이 있으면 그걸,
  // 없으면(기존 세션 호환) attendeeIds 전체를 기본값으로 삼는다 — 선택 안 된 사람이 그 라운드의 미대진자.
  const [round1Sel, setRound1Sel] = useState<Set<string>>(
    () => new Set(session.round1ParticipantIds ?? session.attendeeIds),
  )
  const [round2Sel, setRound2Sel] = useState<Set<string>>(
    () => new Set(session.round2ParticipantIds ?? session.attendeeIds),
  )
  // 참석자 편집(늦게 온 사람 추가 등)으로 attendeeIds가 늘어나면, 새로 추가된 사람의 기본
  // 선택 상태를 applyNewAttendees(순수 함수, logic/matching.ts)로 계산한다 — 2라운드는 항상
  // 기본 선택(관리자가 그대로 해제 가능=중도 미참가 처리), 1라운드는 이미 시작됐으면 절대 안 건드림.
  const prevAttendeeIdsRef = useRef(session.attendeeIds)
  useEffect(() => {
    const round1Started =
      !!session.round1ParticipantIds ||
      session.games.some((g) => g.round === 1 || !g.round) ||
      (session.lineup?.some((m) => m.round === 1) ?? false)
    const next = applyNewAttendees(prevAttendeeIdsRef.current, session.attendeeIds, round1Sel, round2Sel, round1Started)
    if (next.round1Sel !== round1Sel) setRound1Sel(next.round1Sel)
    if (next.round2Sel !== round2Sel) setRound2Sel(next.round2Sel)
    prevAttendeeIdsRef.current = session.attendeeIds
    // round1Sel/round2Sel은 의도적으로 deps에서 뺐다 — applyNewAttendees가 매번 그 값을 읽어
    // 새 Set을 계산하므로, 여기 넣으면 setState 직후 자기 자신을 다시 트리거하는 루프가 된다.
  }, [session.attendeeIds, session.round1ParticipantIds, session.games, session.lineup])
  const [editAttendees, setEditAttendees] = useState(false)
  // 선택된 매칭 방식 (null = 아직 선택 안 함) — 선택된 버튼만 녹색 표시
  const [matchMode, setMatchMode] = useState<'auto' | 'manual' | null>(null)
  const [manualSel, setManualSel] = useState<{ round: number; id: string } | null>(null)
  const [lineupText, setLineupText] = useState<string | null>(null)
  const resultsRef = useRef<HTMLUListElement>(null)

  const meetCount = useMemo(() => buildMeetCount(sessions), [sessions])

  const isFlash = session.type === 'flash'
  const isApproved = session.approved !== false
  // 번개모임은 일반회원도 편집 가능, GUEST는 편집 불가
  const canEdit = !guestMode && (isAdmin || isFlash)

  // 금지 대진: 엄재익 회장 ↔ 이제한 총무는 서로 대진하지 않음
  const forbiddenPairs = useMemo(() => {
    const set = new Set<string>()
    const a = members.find((m) => m.name === '엄재익')?.id
    const b = members.find((m) => m.name === '이제한')?.id
    if (a && b) set.add(pairKey(a, b))
    return set
  }, [members])

  // 라운드별 매칭/미대진자 — round1Sel/round2Sel(관리자가 직접 선택한 참가자)만 그 라운드의 대상이다.
  const round1PlayingIds = session.attendeeIds.filter((id) => round1Sel.has(id))
  const round2PlayingIds = session.attendeeIds.filter((id) => round2Sel.has(id))
  const matchedInRound = (round: number) => {
    const s = new Set<string>()
    ongoing.filter((o) => o.round === round).forEach((o) => { s.add(o.aId); s.add(o.bId) })
    // 이미 결과가 저장된 경기의 선수도 해당 라운드 매칭 완료로 간주
    session.games.filter((g) => g.round === round).forEach((g) => { s.add(g.playerAId); s.add(g.playerBId) })
    return s
  }
  const unmatchedInRound = (round: number) => {
    const playing = round === 2 ? round2PlayingIds : round1PlayingIds
    const m = matchedInRound(round)
    return playing.filter((id) => !m.has(id))
  }
  // 2라운드에 실제로 저장된 경기 결과(hasRecordedResult 기준)가 하나라도 있으면 재매칭을 막는다
  // (결과 손실 방지 우선). 대진만 생성되고 점수가 없는 상태는 session.games에 없으므로 막지 않는다.
  const round2Locked = !canRematchRound(session, 2)

  const makeOngoing = (aId: string, bId: string, round: number): Ongoing => ({
    key: crypto.randomUUID(),
    aId, bId,
    handicapA: hcapOf(aId),
    handicapB: hcapOf(bId),
    scoreA: '', scoreB: '',
    round,
  })

  // 자동매칭 재실행 시 기존 대진·입력 중 점수가 사라지므로 확인
  const confirmRematch = () =>
    ongoing.length === 0 ||
    window.confirm('기존 대진과 입력 중인 점수가 사라질 수 있습니다.\n자동매칭을 다시 실행할까요?')

  // 정기모임 1라운드 자동매칭 — round1Sel(관리자가 직접 선택한 참가자)만 매칭한다.
  const autoMatchRegular = () => {
    if (round1PlayingIds.length < 2) { alert('1라운드에 참가할 인원을 2명 이상 선택해주세요.'); return }
    if (!confirmRematch()) return
    setRoundParticipants(session.id, 1, round1PlayingIds)
    const round1 = matchRoundOne(round1PlayingIds, meetCount, forbiddenPairs, hcapOf)
    setOngoing((prev) => replaceRound(prev, 1, round1.map((p) => makeOngoing(p.aId, p.bId, 1))))
    setManualSel(null)
    setMatchMode('auto')
  }

  const autoMatchFlash = () => {
    if (!confirmRematch()) return
    const ids = [...session.attendeeIds]
    const pairs = matchAll({ waitingIds: ids, meetCount, todayGameCount: new Map() })
    const matchedIds = new Set(pairs.flatMap((p) => [p.aId, p.bId]))
    setOngoing(pairs.map((p) => makeOngoing(p.aId, p.bId, 1)))
    setRound1Sel(new Set(matchedIds)) // 번개모임은 매칭된 사람만 "참가"로 표시(미매칭=대기, 기존 동작과 동일)
    setManualSel(null)
    setMatchMode('auto')
  }

  // 2라운드 자동매칭 — 이미 확정된(저장된·게시된·입력 중인) 1라운드 대진은 절대 건드리지 않고,
  // round2Sel(관리자가 직접 선택한 2라운드 참가자)만 매칭한다. 2라운드 결과가 하나라도 저장돼
  // 있으면(round2Locked) 아예 실행하지 않는다 — 결과 손실 가능성이 있으면 차단을 우선한다.
  const autoMatchRoundTwo = () => {
    if (round2Locked) {
      alert('이미 2라운드 결과가 입력되어 있어 재매칭할 수 없습니다.\n다시 매칭하려면 먼저 2라운드 경기 결과를 하나씩 삭제한 뒤 다시 시도해주세요.')
      return
    }
    if (round2PlayingIds.length < 2) { alert('2라운드에 참가할 인원을 2명 이상 선택해주세요.'); return }
    const hasOngoingRound2 = ongoing.some((o) => o.round === 2)
    if (hasOngoingRound2 && !window.confirm('기존 2라운드 대진을 새로 만들까요?\n아직 입력된 경기 결과는 없습니다.')) return
    setRoundParticipants(session.id, 2, round2PlayingIds)
    // 1라운드 대진(저장된 게임/게시된 대진표/입력 중인 대진 전부)만 회피 기준으로 읽고,
    // 이 함수는 1라운드 쪽 데이터를 절대 쓰거나 지우지 않는다 — round2 대진만 계산해서
    // 아래 replaceRound(prev, 2, ...)로 ongoing의 2라운드 항목만 교체한다.
    const round1Pairs = [
      ...ongoing.filter((o) => o.round === 1).map((o) => ({ aId: o.aId, bId: o.bId })),
      ...session.games.filter((g) => g.round === 1 || !g.round).map((g) => ({ aId: g.playerAId, bId: g.playerBId })),
      ...(session.lineup ?? []).filter((m) => m.round === 1).map((m) => ({ aId: m.aId, bId: m.bId })),
    ]
    const round2 = matchRoundTwo(round2PlayingIds, meetCount, round1Pairs, forbiddenPairs, hcapOf)
    setOngoing((prev) => replaceRound(prev, 2, round2.map((p) => makeOngoing(p.aId, p.bId, 2))))
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
    if (scoreA > o.handicapA || scoreB > o.handicapB) {
      alert('오류: 핸디보다 많은 점수 입력')
      return
    }
    const endType = scoreA >= o.handicapA || scoreB >= o.handicapB ? 'cleared' : 'time'
    const isPending = isFlash && !isAdmin
    addGame(session.id, {
      playerAId: o.aId, playerBId: o.bId,
      handicapA: o.handicapA, handicapB: o.handicapB,
      scoreA, scoreB, endType, round: o.round,
      ...(isPending ? { pending: true } : {}),
    })
    cancel(o.key)
    // 저장 직후 클라우드 반영 (관리자 정기/번개, 일반회원 pending 모두 동일)
    const st = useApp.getState()
    uploadToCloud({ members: st.members, sessions: st.sessions, settings: st.settings, ledger: st.ledger })
      .catch((err) => {
        if (err instanceof UploadCancelledError) {
          alert('클라우드 업로드를 취소했습니다.\n경기는 이 기기에만 저장되었습니다.')
          return
        }
        console.error('클라우드 업로드 실패:', err)
        alert('경기는 기기에 저장되었지만 클라우드 동기화에 실패했습니다.\n네트워크 확인 후 설정 탭에서 수동 업로드해 주세요.')
      })
  }

  // 카톡 배포용 대진표 텍스트 생성 (1부/2부 + 대기자)
  const buildLineupText = () => {
    const line = (o: Ongoing) => `${name(o.aId)}(${o.handicapA}) - ${name(o.bId)}(${o.handicapB})`
    const r1 = ongoing.filter((o) => o.round === 1)
    const r2 = ongoing.filter((o) => o.round === 2)
    // 이 대진표(1부+2부)에 아예 나오지 않는 사람 = 대기. 라운드별로 따로 쉬는 사람은
    // 각 라운드 참가자 선택 화면에서 이미 확인할 수 있으므로 여기서는 합쳐서만 안내한다.
    const inLineup = new Set([...r1, ...r2].flatMap((o) => [o.aId, o.bId]))
    const sitOutForText = session.attendeeIds.filter((id) => !inLineup.has(id))
    const round = ROUND_BY_DATE[session.date]
    const title = round ? `🎱 제${round}차 당신회 정기모임 대진표 🎱` : `🎱 당신회 정기모임 대진표 🎱`
    let txt = `${title}\n📅 ${session.date}\n📍 ${locationOf(session.date)}\n`
    if (r1.length) txt += `\n━━━ 1부 (16:00~17:00) ━━━\n${r1.map(line).join('\n')}\n`
    if (r2.length) txt += `\n━━━ 2부 (17:00~18:00) ━━━\n${r2.map(line).join('\n')}\n`
    if (sitOutForText.length) txt += `\n⏸ 대기: ${sitOutForText.map(name).join(', ')}\n`
    txt += `\n⏰ 시간 엄수 바랍니다.`
    return txt
  }

  // 모임 통째로 삭제 (날짜 오설정 등) → 게시 대진표·경기 모두 제거, 클라우드 반영
  const removeSession = async () => {
    if (!window.confirm(`${session.date} 모임을 삭제할까요?\n게시된 대진표와 입력된 경기 기록이 모두 삭제됩니다.`)) return
    deleteSession(session.id)
    const s = useApp.getState()
    try {
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
    } catch {
      // 업로드 실패해도 로컬에서는 삭제됨
    }
  }

  // 대진표를 게시(클라우드 업로드) → 일반회원 열람 가능
  const doPublish = async () => {
    const lineup: LineupMatch[] = ongoing
      .filter((o) => o.round === 1 || o.round === 2)
      .map((o) => ({ round: o.round!, aId: o.aId, bId: o.bId, handicapA: o.handicapA, handicapB: o.handicapB }))
    const inLineup = new Set(lineup.flatMap((m) => [m.aId, m.bId]))
    const sitOutIds = session.attendeeIds.filter((id) => !inLineup.has(id))
    publishLineup(session.id, lineup, sitOutIds)
    const s = useApp.getState()
    await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
  }

  const typeLabel = isFlash ? '⚡ 번개모임' : '📋 정기모임'
  const typeBadgeStyle: React.CSSProperties = {
    fontSize: 14, padding: '4px 10px', borderRadius: 4, fontWeight: 600,
    background: isFlash ? '#fff3cd' : '#e1f5ee',
    color: isFlash ? '#856404' : '#0f6e56',
  }

  // 매칭이 시작된 후(자동/수동매칭/게시/결과)에만 라운드 그룹 표시
  const started = ongoing.length > 0 || session.games.length > 0 || (session.lineup?.length ?? 0) > 0 || matchMode === 'manual'

  const renderRoundGroup = (round: number) => {
    const matches = ongoing.filter((o) => o.round === round)
    const unmatched = unmatchedInRound(round)
    if (matches.length === 0 && unmatched.length === 0) return null
    const roundLabel = isFlash
      ? '⚡ 번개모임'
      : round === 1 ? '1부 (16:00~17:00)' : '2부 (17:00~18:00)'
    return (
      <div key={round} style={{ marginTop: 6 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '6px 0', color: '#072B61' }}>
          {roundLabel}
        </h3>
        <div className="court-grid">
          {matches.map((o, i) => (
            <div key={o.key} className="card court">
              <div className="court-label">테이블 {i + 1}</div>
              <div className="court-players">
                <div className="court-player">
                  <span className="court-name">{name(o.aId)}</span>
                  <ScoreCell handicap={o.handicapA} score={o.scoreA}
                    onHcap={(v) => patch(o.key, 'handicapA', v)}
                    onScore={(v) => patch(o.key, 'scoreA', v)} />
                </div>
                <span className="vs">vs</span>
                <div className="court-player">
                  <span className="court-name">{name(o.bId)}</span>
                  <ScoreCell handicap={o.handicapB} score={o.scoreB}
                    onHcap={(v) => patch(o.key, 'handicapB', v)}
                    onScore={(v) => patch(o.key, 'scoreB', v)} />
                </div>
              </div>
              <div className="court-buttons">
                <button className="primary grow" onClick={() => save(o)}>저장</button>
                <button onClick={() => cancel(o.key)}>취소</button>
              </div>
            </div>
          ))}
        </div>
        {unmatched.length >= 1 && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1.5, fontWeight: 600, color: '#c0392b' }}>
              ({isFlash ? '대기' : `${round}라운드 미대진자`}) {unmatched.map(name).join(', ')}
              {manualSel?.round === round ? ` — ${name(manualSel.id)} 선택됨, 상대 선택` : unmatched.length >= 2 ? ' — 두 명을 눌러 매칭' : ''}
            </span>
            {unmatched.length >= 2 && (
              <div className="chip-grid">
                {unmatched.map((id) => {
                  const isSel = manualSel?.round === round && manualSel.id === id
                  return (
                    <button key={id}
                      className={`chip${isSel ? ' on' : ''}`}
                      onClick={() => tapUnmatched(round, id)}>
                      {isSel ? '✓ ' : ''}{name(id)}
                    </button>
                  )
                })}
              </div>
            )}
            {manualSel?.round === round && (
              <button style={{ alignSelf: 'flex-start', fontSize: 15, padding: '9px 16px' }}
                onClick={() => setManualSel(null)}>
                선택 취소
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // 같은 날짜에 번개모임이 아직 없는지 확인
  const hasFlashToday = daySessions.some((s) => s.type === 'flash')

  return (
    <div className="tab">
      <div className="card">
        <CalendarPicker value={selectedDate} onChange={onDateChange} markedDates={markedDates} />
      </div>

      {/* 같은 날 여러 세션이 있을 때 탭 선택 */}
      {daySessions.length > 1 && (
        <div style={{ display: 'flex', gap: 6 }}>
          {daySessions.map((s) => (
            <button
              key={s.id}
              className={s.id === selectedId ? 'primary grow' : 'grow'}
              style={{ flex: 1 }}
              onClick={() => onSelectSession(s.id)}
            >
              {s.type === 'flash' ? '⚡ 번개모임' : '📋 정기모임'}
            </button>
          ))}
        </div>
      )}

      {/* 번개모임이 없을 때 추가 버튼 */}
      {!hasFlashToday && (
        <button style={{ fontSize: 16, padding: 13 }} onClick={onAddFlash}>⚡ 번개모임 추가</button>
      )}

      <div className="board-head">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="tab-title" style={{ margin: 0 }}>{session.date} 모임</h2>
            <span style={typeBadgeStyle}>{typeLabel}</span>
            {isFlash && !isApproved && (
              <span style={{ fontSize: 14, padding: '4px 10px', borderRadius: 4, background: '#fce8e8', color: '#c0392b', fontWeight: 600 }}>
                승인 대기
              </span>
            )}
          </div>
          <span className="muted">참석 {session.attendeeIds.length}명 · 완료 {session.games.length}경기</span>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => setEditAttendees((v) => !v)}>참석자</button>
            {isAdmin && (
              <button onClick={removeSession} style={{ color: '#c0392b', borderColor: '#e0a0a0' }}>모임 삭제</button>
            )}
          </div>
        )}
      </div>

      {isFlash && !isApproved && isAdmin && (
        <div style={{ background: '#fff8e1', borderRadius: 8, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 16, lineHeight: 1.4 }}>⚡ 번개모임 기록을 정규 통계에 반영할까요?</span>
          <button className="primary" style={{ fontSize: 16, padding: '13px 18px' }} onClick={() => { if (window.confirm('이 번개모임 기록을 승인할까요?')) approveSession(session.id) }}>
            승인
          </button>
        </div>
      )}
      {isFlash && isApproved && (
        <div style={{ fontSize: 16, color: '#0f6e56', background: '#e1f5ee', borderRadius: 8, padding: '11px 14px' }}>
          ✅ 승인됨 — 정규 통계에 반영됩니다.
        </div>
      )}

      {/* 결과가 있으면 결과 먼저, 그 다음 매칭 편집 UI */}
      {session.games.filter((g) => isAdmin || !g.pending).length > 0 && (() => {
        const visibleGames = session.games.filter((g) => isAdmin || !g.pending)
        const renderGameRow = (g: typeof visibleGames[0]) => {
          const win = winnerId(g)
          return (
            <li key={g.id} className="card result-row" style={g.pending ? { opacity: 0.75 } : undefined}>
              <span className={win === g.playerAId ? 'win' : ''}>
                {name(g.playerAId)} {fmtScore(g.scoreA, g.handicapA)}
              </span>
              <span className="vs">vs</span>
              <span className={win === g.playerBId ? 'win right' : 'right'}>
                {name(g.playerBId)} {fmtScore(g.scoreB, g.handicapB)}
              </span>
              {g.pending && (
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fff3cd', color: '#856404', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  승인대기
                </span>
              )}
              {canEdit && (
                <button className="del" onClick={() => deleteGame(session.id, g.id)} aria-label="삭제">✕</button>
              )}
            </li>
          )
        }
        const r1 = visibleGames.filter((g) => !g.round || g.round === 1)
        const r2 = visibleGames.filter((g) => g.round === 2)
        return (
          <div className="results">
            <div className="results-head">
              <span className="muted">완료된 경기</span>
              {isAdmin && session.games.some((g) => g.pending) && (
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 3, background: '#fff3cd', color: '#856404', fontWeight: 600 }}>
                  승인대기 {session.games.filter((g) => g.pending).length}건
                </span>
              )}
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
            <div ref={resultsRef as unknown as React.RefObject<HTMLDivElement>}>
              {!isFlash && r1.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#072B61', margin: '6px 0 4px' }}>1라운드</div>
                  <ul className="result-list">{r1.map(renderGameRow)}</ul>
                </>
              )}
              {!isFlash && r2.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#072B61', margin: '10px 0 4px' }}>2라운드</div>
                  <ul className="result-list">{r2.map(renderGameRow)}</ul>
                </>
              )}
              {isFlash && (
                <ul className="result-list">{visibleGames.map(renderGameRow)}</ul>
              )}
            </div>
          </div>
        )
      })()}

      {!canEdit && session.games.filter((g) => !g.pending).length === 0 && (
        <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>아직 등록된 경기 결과가 없습니다.</p>
      )}

      {/* === 관리자 또는 번개모임: 대진 편집/점수 입력 === */}
      {canEdit && (
        <>
          {editAttendees && (
            <AttendeeEditor
              members={members}
              attendeeIds={session.attendeeIds}
              onChange={(ids) => setAttendees(session.id, ids)}
            />
          )}

          {!isFlash && (
            <RoundParticipantPicker
              label="1라운드"
              attendeeIds={session.attendeeIds}
              selected={round1Sel}
              onToggle={(id) => setRound1Sel((s) => toggleParticipant(s, id))}
              onSelectAll={() => setRound1Sel(new Set(session.attendeeIds))}
              onSelectNone={() => setRound1Sel(new Set())}
              name={name}
            />
          )}

          {/* 매칭 방식 선택: 자동(1라운드 생성) / 수동(두 명씩 직접 선택) — 선택된 쪽만 녹색 */}
          <div className="board-actions">
            <button className={matchMode === 'auto' ? 'primary grow' : 'grow'}
              disabled={(isFlash ? session.attendeeIds.length : round1PlayingIds.length) < 2}
              onClick={isFlash ? autoMatchFlash : autoMatchRegular}>
              🔀 {isFlash ? '자동매칭' : '1라운드 자동매칭'}
            </button>
            <button className={matchMode === 'manual' ? 'primary grow' : 'grow'}
              disabled={session.attendeeIds.length < 2}
              onClick={() => setMatchMode('manual')}>
              ✋ 수동매칭
            </button>
          </div>

          {!isFlash && (
            <>
              <RoundParticipantPicker
                label="2라운드"
                attendeeIds={session.attendeeIds}
                selected={round2Sel}
                onToggle={(id) => setRound2Sel((s) => toggleParticipant(s, id))}
                onSelectAll={() => setRound2Sel(new Set(session.attendeeIds))}
                onSelectNone={() => setRound2Sel(new Set())}
                name={name}
              />
              <button className="block" style={{ fontSize: 16, padding: 13, marginBottom: 10 }}
                disabled={round2PlayingIds.length < 2 || round2Locked}
                onClick={autoMatchRoundTwo}>
                🔀 2라운드 자동매칭
              </button>
              {round2Locked && (
                <p className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 10, color: '#c0392b' }}>
                  이미 2라운드 결과가 있어 재매칭할 수 없습니다. 다시 매칭하려면 먼저 2라운드 경기를 하나씩 삭제하세요.
                </p>
              )}
            </>
          )}

          {!isFlash && (
            <button className="block" style={{ fontSize: 16, padding: 13, marginBottom: 10 }}
              disabled={ongoing.length === 0} onClick={() => setLineupText(buildLineupText())}>
              📋 카톡 대진표
            </button>
          )}

          {started && renderRoundGroup(1)}
          {!isFlash && started && renderRoundGroup(2)}
        </>
      )}

      {lineupText !== null && (
        <LineupModal text={lineupText} onPublish={doPublish} onClose={() => setLineupText(null)} />
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
        핸디
        <input type="number" min={1} value={handicap} onChange={(e) => onHcap(Math.max(1, +e.target.value))} />
      </label>
    </div>
  )
}

/** 라운드별 "이번 라운드 경기 참가" 선택 UI. 선택 안 된 사람은 그 라운드의 미대진자(대기)로 취급한다. */
function RoundParticipantPicker({ label, attendeeIds, selected, onToggle, onSelectAll, onSelectNone, name }: {
  label: string
  attendeeIds: string[]
  selected: Set<string>
  onToggle: (id: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
  name: (id: string) => string
}) {
  const playingCount = attendeeIds.filter((id) => selected.has(id)).length
  const waitingCount = attendeeIds.length - playingCount
  const expectedGames = Math.floor(playingCount / 2)
  return (
    <div className="card col-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{label} 참가자 선택</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onSelectAll} style={{ fontSize: 13, padding: '6px 10px' }}>전체 선택</button>
          <button type="button" onClick={onSelectNone} style={{ fontSize: 13, padding: '6px 10px' }}>전체 해제</button>
        </div>
      </div>
      <div className="chip-grid">
        {attendeeIds.map((id) => (
          <button key={id} type="button"
            className={`chip${selected.has(id) ? ' on' : ''}`}
            onClick={() => onToggle(id)}>
            {selected.has(id) ? '✓ ' : ''}{name(id)}
          </button>
        ))}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        참가 {playingCount}명 · 대기 {waitingCount}명 · 예상 {expectedGames}경기
        {playingCount % 2 !== 0 && playingCount > 0 && ' (홀수 — 1명은 미대진자로 남습니다)'}
      </span>
      {playingCount < 2 && (
        <span style={{ color: '#c0392b', fontSize: 13, fontWeight: 600 }}>
          자동매칭하려면 참가자를 2명 이상 선택하세요.
        </span>
      )}
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
