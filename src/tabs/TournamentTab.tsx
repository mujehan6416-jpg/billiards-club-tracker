import { useEffect, useMemo, useState } from 'react'
import type { Member } from '../types'
import type { Tournament, TournamentDrawEntry, TournamentDrawMapping, TournamentMatch, TournamentParticipant } from '../types/tournament'
import { useApp } from '../store/appStore'
import { useAuth } from '../store/authStore'
import { useAdmin } from '../store/adminStore'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { AdminAuthLogin } from '../components/admin/AdminAuthLogin'
import { TournamentList } from '../components/tournament/TournamentList'
import { TournamentCreateForm } from '../components/tournament/TournamentCreateForm'
import { TournamentEntryCard } from '../components/tournament/TournamentEntryCard'
import { TournamentParticipantAdmin } from '../components/tournament/TournamentParticipantAdmin'
import { TournamentDrawAdmin } from '../components/tournament/TournamentDrawAdmin'
import { TournamentBracketView } from '../components/tournament/TournamentBracketView'
import { createTournamentParticipant, createDrawMapping, buildSeatsFromDraw } from '../logic/tournamentDraw'
import { buildEmptyBracket, buildTournamentMatches } from '../logic/tournamentBracket'
import {
  createTournament as createTournamentDoc,
  createMissingParticipants,
  fetchTournaments,
  fetchTournamentParticipants,
  setParticipantEntryStatus,
  excludeParticipantByAdmin,
  setParticipantTournamentHandicap,
  writeTournamentParticipant,
  confirmTournamentEntries,
  reopenTournamentEntries,
  prepareTournamentDraw,
  saveTournamentDrawNumbers,
  loadTournamentDrawMapping,
  confirmTournamentBracket,
  cancelTournamentBracket,
  fetchTournamentMatches,
} from '../lib/tournamentSync'

type View = 'list' | 'create' | 'detail'

/** 이미 계산된 대진 노드·좌석으로 경기 목록을 만든다. 순수 함수 두 개를 이어붙이기만 한다. */
function buildMatchesFromMapping(
  mapping: TournamentDrawMapping,
  participants: TournamentParticipant[],
  entries: TournamentDrawEntry[],
): { ok: true; value: TournamentMatch[] } | { ok: false; message: string } {
  const bracket = buildEmptyBracket(mapping.bracketSize)
  if (!bracket.ok) return bracket
  const seats = buildSeatsFromDraw(participants, entries, mapping)
  if (!seats.ok) return seats
  return buildTournamentMatches(bracket.value, seats.value)
}

/**
 * 4A(대회 생성·참가 신청·참가자 관리) 진입점.
 *
 * previewMode가 true면 Firestore를 전혀 호출하지 않고 모든 쓰기 동작이 로컬 state만 바꾼다
 * (개발 미리보기 전용 — src/dev/DevTournamentPreview.tsx가 이 모드로 렌더링한다).
 * 일반 실행에서는 devTournaments/devParticipants를 넘기지 않으므로 이 분기를 타지 않는다.
 */
export function TournamentTab({
  clubId = 'skkubc', devTournaments, devParticipants, devMembers, devMatches, devDrawMappings, previewMode = false,
}: {
  clubId?: string
  devTournaments?: Tournament[]
  devParticipants?: Record<string, TournamentParticipant[]>
  /** 개발 미리보기 전용 — 넘기면 실제 useApp(회원) 대신 이 목록을 쓴다. */
  devMembers?: Member[]
  /** 개발 미리보기 전용 — 대진 확정까지 끝난 시나리오를 처음부터 보여줄 때 쓴다. */
  devMatches?: Record<string, TournamentMatch[]>
  /** 개발 미리보기 전용 — 이미 "추첨 준비"를 마친 상태로 시작하는 시나리오(drawReady)에 필요하다. */
  devDrawMappings?: Record<string, TournamentDrawMapping>
  previewMode?: boolean
}) {
  const appMembers = useApp((s) => s.members)
  const members = devMembers ?? appMembers
  const { memberId, isGuest } = useAuth()
  const { isAdmin } = useAdmin()
  const adminAuthStatus = useAdminAuthStore((s) => s.status)
  const adminUid = useAdminAuthStore((s) => s.uid)
  const isAuthorizedAdmin = isAdmin && adminAuthStatus === 'authorizedAdmin'

  const [view, setView] = useState<View>('list')
  const [tournaments, setTournaments] = useState<Tournament[]>(devTournaments ?? [])
  const [participantsByTournamentId, setParticipantsByTournamentId] =
    useState<Record<string, TournamentParticipant[]>>(devParticipants ?? {})
  /**
   * drawReady 상태에서는 "대진표 확인"으로 계산한 미리보기(아직 저장 전), bracketFixed
   * 상태에서는 서버에 확정된 공식 대진 — 둘 다 이 하나의 state를 같이 쓴다. 미리보기는
   * Firestore에 쓰지 않으므로 여기 있는 값이 항상 서버 상태와 같지는 않다(§19·§26).
   */
  const [matchesByTournamentId, setMatchesByTournamentId] = useState<Record<string, TournamentMatch[]>>(devMatches ?? {})
  /**
   * 개발 미리보기 전용 — 번호↔자리 비공개 매핑을 로컬에만 들고 있는다. 회원 화면 컴포넌트
   * 어디에도 이 값을 prop으로 넘기지 않는다(실제 운영에서는 이 값 자체가 클라이언트 state에
   * 존재하지 않고, loadTournamentDrawMapping() 호출 결과가 handleBuildPreview 안에서만
   * 잠깐 쓰이고 버려진다 — 아래 참고).
   */
  const [devDrawMappingByTournamentId, setDevDrawMappingByTournamentId] =
    useState<Record<string, TournamentDrawMapping>>(devDrawMappings ?? {})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(!previewMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeMembers = useMemo(() => members.filter((m: Member) => m.active), [members])
  const selected = tournaments.find((t) => t.id === selectedId) ?? null
  const selectedParticipants = selectedId ? (participantsByTournamentId[selectedId] ?? []) : []
  const myParticipant = memberId ? selectedParticipants.find((p) => p.memberId === memberId) : undefined
  const enteredParticipants = useMemo(
    () => selectedParticipants.filter((p) => p.entryStatus === 'entered'),
    [selectedParticipants],
  )
  const selectedMatches = selectedId ? (matchesByTournamentId[selectedId] ?? null) : null
  const participantsById = useMemo(
    () => new Map(selectedParticipants.map((p) => [p.id, p])),
    [selectedParticipants],
  )
  const nameOf = (participantId: string | null) =>
    participantId ? (participantsById.get(participantId)?.displayNameSnapshot ?? '알수없음') : ''

  useEffect(() => {
    if (previewMode) return
    let cancelled = false
    setLoading(true)
    fetchTournaments(clubId)
      .then((list) => { if (!cancelled) setTournaments(list) })
      .catch(() => { if (!cancelled) setError('대회 목록을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clubId, previewMode])

  const reloadParticipants = async (tournamentId: string) => {
    if (previewMode) return
    const list = await fetchTournamentParticipants(tournamentId, clubId)
    setParticipantsByTournamentId((prev) => ({ ...prev, [tournamentId]: list }))
  }

  /** 확정된 공식 대진을 서버에서 다시 읽는다 — 연결 회원이면 누구나 부를 수 있는 공개 조회다. */
  const reloadMatches = async (tournamentId: string) => {
    if (previewMode) return
    const list = await fetchTournamentMatches(tournamentId, clubId)
    setMatchesByTournamentId((prev) => ({ ...prev, [tournamentId]: list }))
  }

  const openTournament = (id: string) => {
    setSelectedId(id)
    setView('detail')
    if (previewMode) return
    const target = tournaments.find((t) => t.id === id)
    const needsMatches = (target?.status === 'bracketFixed' || target?.status === 'finished') && !matchesByTournamentId[id]
    const tasks: Promise<void>[] = []
    if (!participantsByTournamentId[id]) tasks.push(reloadParticipants(id))
    if (needsMatches) tasks.push(reloadMatches(id))
    if (tasks.length === 0) return
    setBusy(true)
    Promise.all(tasks).catch(() => setError('정보를 불러오지 못했습니다.')).finally(() => setBusy(false))
  }

  const runAdminAction = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch {
      setError('처리하지 못했습니다. 인터넷 연결과 관리자 로그인 상태를 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateTournament = (input: { name: string; date: string; timeLimitMinutes: number }) => {
    const id = previewMode ? `dev-created-${Date.now()}` : crypto.randomUUID()
    const tournament: Tournament = {
      id, name: input.name, date: input.date, timeLimitMinutes: input.timeLimitMinutes,
      status: 'draft', createdAt: new Date().toISOString(),
      ...(adminUid ? { createdByAdminUid: adminUid } : {}),
    }
    if (previewMode) {
      setTournaments((prev) => [...prev, tournament])
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [id]: activeMembers.map((m) => createTournamentParticipant(m, { participantId: m.id })),
      }))
      setSelectedId(id)
      setView('detail')
      return
    }
    void runAdminAction(async () => {
      await createTournamentDoc(tournament, clubId)
      await createMissingParticipants(id, activeMembers, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
      await reloadParticipants(id)
      setSelectedId(id)
      setView('detail')
    })
  }

  const handleSetOwnEntryStatus = (status: 'entered' | 'declined') => {
    if (!selected || !memberId || !myParticipant) return
    if (previewMode) {
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: prev[selected.id].map((p) => (p.memberId === memberId ? { ...p, entryStatus: status } : p)),
      }))
      return
    }
    void runAdminAction(async () => {
      await setParticipantEntryStatus(selected.id, myParticipant.id, status, clubId)
      await reloadParticipants(selected.id)
    })
  }

  const handleExclude = (participantId: string) => {
    if (!selected) return
    if (previewMode) {
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: prev[selected.id].map((p) => (p.id === participantId
          ? { ...p, entryStatus: 'excluded', excludedByAdminUid: 'dev-admin-uid', excludedAt: new Date().toISOString() }
          : p)),
      }))
      return
    }
    void runAdminAction(async () => {
      await excludeParticipantByAdmin(selected.id, participantId, { adminUid: adminUid ?? '', at: new Date().toISOString() }, clubId)
      await reloadParticipants(selected.id)
    })
  }

  const handleSetHandicap = (participantId: string, value: number) => {
    if (!selected) return
    if (previewMode) {
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: prev[selected.id].map((p) => (p.id === participantId ? { ...p, tournamentHandicap: value } : p)),
      }))
      return
    }
    void runAdminAction(async () => {
      await setParticipantTournamentHandicap(selected.id, participantId, value, clubId)
      await reloadParticipants(selected.id)
    })
  }

  const handleAddMember = (memberIdToAdd: string) => {
    if (!selected) return
    const member = activeMembers.find((m) => m.id === memberIdToAdd)
    if (!member) return
    const existing = selectedParticipants.find((p) => p.memberId === memberIdToAdd)

    if (previewMode) {
      setParticipantsByTournamentId((prev) => {
        const list = prev[selected.id] ?? []
        if (existing) {
          return { ...prev, [selected.id]: list.map((p) => (p.id === existing.id ? { ...p, entryStatus: 'entered' } : p)) }
        }
        return { ...prev, [selected.id]: [...list, createTournamentParticipant(member, { participantId: member.id, entryStatus: 'entered' })] }
      })
      return
    }
    void runAdminAction(async () => {
      if (existing) {
        await setParticipantEntryStatus(selected.id, existing.id, 'entered', clubId)
      } else {
        await writeTournamentParticipant(
          selected.id,
          createTournamentParticipant(member, { participantId: member.id, entryStatus: 'entered' }),
          clubId,
        )
      }
      await reloadParticipants(selected.id)
    })
  }

  const handleConfirmEntries = () => {
    if (!selected) return
    const enteredCount = selectedParticipants.filter((p) => p.entryStatus === 'entered').length
    if (previewMode) {
      setTournaments((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: 'entryClosed', participantCount: enteredCount } : t)))
      return
    }
    void runAdminAction(async () => {
      await confirmTournamentEntries(selected.id, enteredCount, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
    })
  }

  // ── 4B: 참가자 확정 취소 (§6 CASE 1·2) ──
  const handleReopenEntries = () => {
    if (!selected) return
    if (previewMode) {
      setTournaments((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: 'draft', participantCount: undefined } : t)))
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).map((p) => ({ ...p, drawNumber: undefined })),
      }))
      setDevDrawMappingByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      return
    }
    void runAdminAction(async () => {
      await reopenTournamentEntries(selected.id, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
      await reloadParticipants(selected.id)
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
    })
  }

  // ── 4B: 추첨 준비 ──
  const handlePrepareDraw = () => {
    if (!selected || selected.participantCount === undefined) return
    if (previewMode) {
      const mapping = createDrawMapping(selected.participantCount, Math.random)
      if (!mapping.ok) { setError(mapping.message); return }
      setDevDrawMappingByTournamentId((prev) => ({ ...prev, [selected.id]: mapping.value }))
      setTournaments((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: 'drawReady' } : t)))
      return
    }
    void runAdminAction(async () => {
      await prepareTournamentDraw(selected.id, selected.participantCount!, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
    })
  }

  // ── 4B: 오프라인 추첨번호 저장 ──
  const handleSaveDrawNumbers = (entries: TournamentDrawEntry[]) => {
    if (!selected) return
    if (previewMode) {
      const byId = new Map(entries.map((e) => [e.participantId, e.drawNumber]))
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).map((p) => (byId.has(p.id) ? { ...p, drawNumber: byId.get(p.id) } : p)),
      }))
      return
    }
    void runAdminAction(async () => {
      await saveTournamentDrawNumbers(selected.id, enteredParticipants, entries, clubId)
      await reloadParticipants(selected.id)
    })
  }

  // ── 4B: 대진표 미리보기 계산 (Firestore에 쓰지 않는다) ──
  const handleBuildPreview = () => {
    if (!selected) return
    const entries: TournamentDrawEntry[] = enteredParticipants
      .filter((p) => p.drawNumber !== undefined)
      .map((p) => ({ participantId: p.id, drawNumber: p.drawNumber! }))

    if (previewMode) {
      const mapping = devDrawMappingByTournamentId[selected.id]
      if (!mapping) { setError('먼저 추첨 준비를 진행해 주세요.'); return }
      const built = buildMatchesFromMapping(mapping, enteredParticipants, entries)
      if (!built.ok) { setError(built.message); return }
      setMatchesByTournamentId((prev) => ({ ...prev, [selected.id]: built.value }))
      return
    }
    void runAdminAction(async () => {
      // ⚠ loadTournamentDrawMapping()은 관리자만 부를 수 있는 함수다(회원 화면 경로에서는
      // 절대 호출하지 않는다). 그 결과(mapping)는 이 함수 스코프 밖으로 나가지 않고,
      // 계산이 끝나면 여기서 그대로 버려진다 — state에는 계산 결과(matches)만 남는다.
      const mapping = await loadTournamentDrawMapping(selected.id, clubId)
      if (!mapping) throw new Error('추첨 준비 정보를 찾을 수 없습니다.')
      const built = buildMatchesFromMapping(mapping, enteredParticipants, entries)
      if (!built.ok) throw new Error(built.message)
      setMatchesByTournamentId((prev) => ({ ...prev, [selected.id]: built.value }))
    })
  }

  // ── 4B: 대진 확정 ──
  const handleConfirmBracket = () => {
    if (!selected) return
    const matches = matchesByTournamentId[selected.id]
    if (!matches || matches.length === 0) return
    const bracketSize = matches.filter((m) => m.roundNumber === 1).length * 2

    if (previewMode) {
      setTournaments((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: 'bracketFixed', bracketSize } : t)))
      return
    }
    void runAdminAction(async () => {
      await confirmTournamentBracket(selected.id, matches, { bracketSize, at: new Date().toISOString() }, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
      await reloadMatches(selected.id)
    })
  }

  // ── 4B: 대진 확정 취소 (§21) ──
  const handleCancelBracket = () => {
    if (!selected) return
    if (previewMode) {
      setTournaments((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: 'entryClosed', bracketSize: undefined, drawConfirmedAt: undefined } : t)))
      setParticipantsByTournamentId((prev) => ({
        ...prev,
        [selected.id]: (prev[selected.id] ?? []).map((p) => ({ ...p, drawNumber: undefined })),
      }))
      setDevDrawMappingByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      return
    }
    void runAdminAction(async () => {
      await cancelTournamentBracket(selected.id, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
      await reloadParticipants(selected.id)
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
    })
  }

  if (loading) {
    return (
      <div className="tab">
        <h2 className="tab-title">🏆 대회</h2>
        <p className="muted" style={{ textAlign: 'center', padding: '20px 0' }}>불러오는 중...</p>
      </div>
    )
  }

  if (view === 'create') {
    return (
      <div className="tab">
        <h2 className="tab-title">🏆 대회</h2>
        {error && <p className="info-msg">{error}</p>}
        <TournamentCreateForm onCreate={handleCreateTournament} onCancel={() => setView('list')} submitting={busy} />
      </div>
    )
  }

  if (view === 'detail' && selected) {
    return (
      <div className="tab">
        <button type="button" onClick={() => setView('list')} style={{ marginBottom: 4 }}>← 대회 목록</button>
        <h2 className="tab-title" style={{ marginBottom: 0 }}>{selected.name}</h2>
        <span className="muted">📅 {selected.date} · 제한시간 {selected.timeLimitMinutes}분</span>
        {error && <p className="info-msg">{error}</p>}

        {!isGuest && memberId && (
          <TournamentEntryCard
            tournament={selected}
            participant={myParticipant}
            onSetEntryStatus={handleSetOwnEntryStatus}
            busy={busy}
          />
        )}

        {/* 확정된 공개 대진표 — 회원·관리자 모두 같은 화면 하나를 본다(중복 렌더링 방지).
            아직 대진이 없으면(matches 없음) 아무것도 그리지 않는다. */}
        {selected.status === 'bracketFixed' && selectedMatches && selectedMatches.length > 0 && (
          <TournamentBracketView matches={selectedMatches} nameOf={nameOf} highlightMemberId={memberId ?? undefined} />
        )}

        {isAdmin && (
          isAuthorizedAdmin ? (
            selected.status === 'draft' ? (
              <TournamentParticipantAdmin
                tournament={selected}
                participants={selectedParticipants}
                activeMembers={activeMembers}
                onExclude={handleExclude}
                onAddMember={handleAddMember}
                onSetHandicap={handleSetHandicap}
                onConfirmEntries={handleConfirmEntries}
                busy={busy}
              />
            ) : (
              <TournamentDrawAdmin
                tournament={selected}
                enteredParticipants={enteredParticipants}
                matches={selectedMatches}
                nameOf={nameOf}
                busy={busy}
                onPrepareDraw={handlePrepareDraw}
                onSaveDrawNumbers={handleSaveDrawNumbers}
                onBuildPreview={handleBuildPreview}
                onConfirmBracket={handleConfirmBracket}
                onReopenEntries={handleReopenEntries}
                onCancelBracket={handleCancelBracket}
              />
            )
          ) : (
            <div className="card col-card">
              <span className="muted" style={{ fontSize: 13 }}>
                참가자 관리 같은 실제 저장 작업을 하려면 관리자 계정으로 한 번 더 로그인해 주세요.
              </span>
              <AdminAuthLogin />
            </div>
          )
        )}
      </div>
    )
  }

  return (
    <div className="tab">
      <h2 className="tab-title">🏆 대회</h2>
      {error && <p className="info-msg">{error}</p>}

      {isAdmin && !isAuthorizedAdmin && (
        <div className="card col-card">
          <span className="muted" style={{ fontSize: 13 }}>
            대회를 만들려면 관리자 계정으로 한 번 더 로그인해 주세요.
          </span>
          <AdminAuthLogin />
        </div>
      )}

      {isAuthorizedAdmin && (
        <button className="primary block" style={{ fontSize: 16, padding: 14 }} onClick={() => setView('create')}>
          + 새 대회 만들기
        </button>
      )}

      <TournamentList tournaments={tournaments} participantsByTournamentId={participantsByTournamentId} onSelect={openTournament} />
    </div>
  )
}
