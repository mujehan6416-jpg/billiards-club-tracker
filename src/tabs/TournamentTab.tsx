import { useEffect, useMemo, useState } from 'react'
import type { Member } from '../types'
import type { Tournament, TournamentParticipant } from '../types/tournament'
import { useApp } from '../store/appStore'
import { useAuth } from '../store/authStore'
import { useAdmin } from '../store/adminStore'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { AdminAuthLogin } from '../components/admin/AdminAuthLogin'
import { TournamentList } from '../components/tournament/TournamentList'
import { TournamentCreateForm } from '../components/tournament/TournamentCreateForm'
import { TournamentEntryCard } from '../components/tournament/TournamentEntryCard'
import { TournamentParticipantAdmin } from '../components/tournament/TournamentParticipantAdmin'
import { createTournamentParticipant } from '../logic/tournamentDraw'
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
} from '../lib/tournamentSync'

type View = 'list' | 'create' | 'detail'

/**
 * 4A(대회 생성·참가 신청·참가자 관리) 진입점.
 *
 * previewMode가 true면 Firestore를 전혀 호출하지 않고 모든 쓰기 동작이 로컬 state만 바꾼다
 * (개발 미리보기 전용 — src/dev/DevTournamentPreview.tsx가 이 모드로 렌더링한다).
 * 일반 실행에서는 devTournaments/devParticipants를 넘기지 않으므로 이 분기를 타지 않는다.
 */
export function TournamentTab({
  clubId = 'skkubc', devTournaments, devParticipants, devMembers, previewMode = false,
}: {
  clubId?: string
  devTournaments?: Tournament[]
  devParticipants?: Record<string, TournamentParticipant[]>
  /** 개발 미리보기 전용 — 넘기면 실제 useApp(회원) 대신 이 목록을 쓴다. */
  devMembers?: Member[]
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(!previewMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeMembers = useMemo(() => members.filter((m: Member) => m.active), [members])
  const selected = tournaments.find((t) => t.id === selectedId) ?? null
  const selectedParticipants = selectedId ? (participantsByTournamentId[selectedId] ?? []) : []
  const myParticipant = memberId ? selectedParticipants.find((p) => p.memberId === memberId) : undefined

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

  const openTournament = (id: string) => {
    setSelectedId(id)
    setView('detail')
    if (!previewMode && !participantsByTournamentId[id]) {
      setBusy(true)
      reloadParticipants(id).catch(() => setError('참가자 정보를 불러오지 못했습니다.')).finally(() => setBusy(false))
    }
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

        {isAdmin && (
          isAuthorizedAdmin ? (
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
