import { useEffect, useMemo, useRef, useState } from 'react'
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
import { TournamentBracketVisual } from '../components/tournament/TournamentBracketVisual'
import { TournamentMatchPanel } from '../components/tournament/TournamentMatchPanel'
import { TournamentFinalResults } from '../components/tournament/TournamentFinalResults'
import { TournamentRestartSender, type RestartBracketPlan, type RestartSendResult } from '../components/tournament/TournamentRestartSender'
import { findRestartTarget, planRestartTransfer, restartCandidates } from '../logic/tournamentRestart'
import {
  analyzeRestartSource, buildRestartBracket, restartFirstRoundStatus, restartJoinProgress, restartJoinRows,
} from '../logic/tournamentRestartBracket'
import { roundLabel } from '../components/tournament/tournamentDisplay'
import { createTournamentParticipant, createDrawMapping, buildSeatsFromDraw } from '../logic/tournamentDraw'
import { buildEmptyBracket, buildTournamentMatches } from '../logic/tournamentBracket'
import {
  adminEntersMatchResult as applyAdminEnter,
  submitTournamentMatchResult as applySubmitResult,
  verifyTournamentMatchResult as applyVerify,
  requestTournamentMatchCorrection as applyRequestCorrection,
  adminVerifyTournamentMatchResult as applyAdminVerify,
  correctTournamentMatchResult as applyAdminCorrect,
  approveTournamentMatch as applyApprove,
  declareTournamentForfeit as applyForfeit,
  promotionFor,
  applyPromotion,
  calculateFinalPlacements,
  countTournamentProgress,
} from '../logic/tournamentMatch'
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
  deleteTournament,
  fetchTournamentMatches,
  subscribeTournamentMatches,
  createRestartBracket,
  syncRestartJoiners,
  adminEntersTournamentMatchResult,
  submitTournamentMatchResult,
  verifyTournamentMatchResult,
  requestTournamentMatchCorrection,
  adminVerifyTournamentMatch,
  correctTournamentMatchByAdmin,
  approveTournamentMatch,
  declareTournamentForfeit,
  finishTournament,
} from '../lib/tournamentSync'

type View = 'list' | 'create' | 'detail'

/**
 * 이미 계산된 대진 노드·좌석으로 경기 목록을 만든다. 순수 함수 두 개를 이어붙이기만 한다.
 *
 * includeThirdPlace가 true면 준결승 패자 둘이 맞붙는 3·4위전 경기 하나를 처음부터 함께
 * 만든다(비어 있는 상태로 — 실제 선수는 나중에 준결승 결과가 승인될 때 채워진다). 이
 * 선택은 새 Tournament 필드로 저장하지 않는다 — 대진을 만드는 이 순간 한 번만 쓰고,
 * 그 결과로 3·4위전 경기가 실제로 존재하는지 자체가 이후 모든 화면·로직의 판단 기준이
 * 된다(logic/tournamentMatch.ts의 calculateFinalPlacements·loserPromotionForThirdPlace,
 * logic/tournamentBracketLayout.ts 모두 "그 경기가 있는가"만 본다).
 */
function buildMatchesFromMapping(
  mapping: TournamentDrawMapping,
  participants: TournamentParticipant[],
  entries: TournamentDrawEntry[],
  includeThirdPlace = false,
): { ok: true; value: TournamentMatch[] } | { ok: false; message: string } {
  const bracket = buildEmptyBracket(mapping.bracketSize, { includeThirdPlace })
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
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null)
  /** 라운드별 카드 보기(기존)와 전체 대진표 시각화, 두 가지 보기 방식. */
  const [bracketViewMode, setBracketViewMode] = useState<'round' | 'full'>('round')
  const [loading, setLoading] = useState(!previewMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [matchError, setMatchError] = useState('')
  /** 실시간 반영 안내: 작은 알림(자동으로 사라짐)·최근 반영 시각·실시간 연결 끊김 여부. */
  const [liveToast, setLiveToast] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [liveBroken, setLiveBroken] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [restartSyncMsg, setRestartSyncMsg] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  /**
   * 확정된 대진의 경기 결과를 실시간으로 받는다(상세 화면이 열려 있는 동안만).
   * 화면을 떠나거나 대회가 바뀌면 cleanup이 구독을 끊으므로 구독이 겹쳐 쌓이지 않는다.
   * 알림은 '공식 확정된 경기 수가 늘었을 때'만, 이 기기가 직접 쓴 변경이 아닐 때만 띄운다.
   */
  const liveTournamentId = view === 'detail' ? selectedId : null
  const liveEnabled = selected?.status === 'bracketFixed' || selected?.status === 'finished'
  useEffect(() => {
    if (previewMode || !liveTournamentId || !liveEnabled) return
    let prevDone: number | null = null
    setLiveBroken(false)
    const unsubscribe = subscribeTournamentMatches(
      liveTournamentId,
      (list, meta) => {
        setMatchesByTournamentId((prev) => ({ ...prev, [liveTournamentId]: list }))
        const { done } = countTournamentProgress(list)
        if (!meta.fromCache) setLastUpdatedAt(new Date())
        if (prevDone !== null && done > prevDone && !meta.hasPendingWrites && !meta.fromCache) {
          setLiveToast(true)
          if (toastTimer.current) clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => setLiveToast(false), 3000)
        }
        prevDone = done
      },
      () => setLiveBroken(true),
      clubId,
    )
    return () => {
      unsubscribe()
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setLiveToast(false)
    }
  }, [previewMode, liveTournamentId, liveEnabled, clubId])

  /**
   * 관리자가 리스타트 대회를 열 때 한 번, 본선에서 이미 확정됐지만 아직 배치되지 않은 합류자를 채운다
   * (다른 기기에서 승인했거나 배치가 실패했던 경우를 보완). 이미 채운 자리는 건드리지 않는다.
   */
  const isRestartDetail = view === 'detail' && selected?.status === 'bracketFixed' && !!selected.restartSourceTournamentId
  useEffect(() => {
    if (previewMode || !isAuthorizedAdmin || !isRestartDetail || !selectedId) return
    void syncRestartJoiners(selectedId, clubId).catch(() => { /* 수동 확인 버튼으로 다시 시도할 수 있다 */ })
  }, [previewMode, isAuthorizedAdmin, isRestartDetail, selectedId, clubId])

  /** 보조 기능: 인터넷이 불안정할 때 직접 한 번 더 읽는다. */
  const handleManualRefresh = async () => {
    if (!selectedId || refreshing) return
    setRefreshing(true)
    try {
      await reloadMatches(selectedId)
      setLastUpdatedAt(new Date())
      setLiveBroken(false)
    } catch {
      setError('새로고침하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setRefreshing(false)
    }
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

  // ── 리스타트 참가자 보내기 (본선 탈락자 → 다른 대회 참가자) ──
  // 새 저장 방식을 만들지 않고 위 handleAddMember와 같은 기존 함수(setParticipantEntryStatus·
  // writeTournamentParticipant·createTournamentParticipant)만 쓴다. 회원 원본은 읽기만 한다.
  // 이미 보낸 뒤 본선 결과를 정정해도 리스타트 참가자는 자동으로 바뀌지 않는다(운영진이 직접 조정).
  const loadRestartTarget = async (targetId: string): Promise<TournamentParticipant[]> => {
    if (previewMode) return participantsByTournamentId[targetId] ?? []
    return fetchTournamentParticipants(targetId, clubId)
  }

  const handleSendToRestart = async (targetId: string, memberIds: string[]): Promise<RestartSendResult> => {
    // 목록이 오래됐을 수 있으므로 저장 직전에 대상 대회가 아직 참가자 수정 가능한 상태인지 다시 확인한다.
    const latest = previewMode ? tournaments : await fetchTournaments(clubId)
    if (!previewMode) setTournaments(latest)
    if (latest.find((t) => t.id === targetId)?.status !== 'draft') {
      throw new Error('대상 대회에 더 이상 참가자를 추가할 수 없습니다.')
    }
    const fresh = await loadRestartTarget(targetId)
    const { toAdd, alreadyIn } = planRestartTransfer(memberIds, fresh)
    let added = 0
    let failed = 0
    for (const memberId of toAdd) {
      const existing = fresh.find((p) => p.memberId === memberId)
      const member = members.find((m: Member) => m.id === memberId)
      try {
        if (previewMode) {
          setParticipantsByTournamentId((prev) => {
            const list = prev[targetId] ?? []
            return {
              ...prev,
              [targetId]: existing
                ? list.map((p) => (p.id === existing.id ? { ...p, entryStatus: 'entered' } : p))
                : [...list, createTournamentParticipant(member!, { participantId: member!.id, entryStatus: 'entered' })],
            }
          })
        } else if (existing) {
          await setParticipantEntryStatus(targetId, existing.id, 'entered', clubId)
        } else if (member) {
          await writeTournamentParticipant(
            targetId,
            createTournamentParticipant(member, { participantId: member.id, entryStatus: 'entered' }),
            clubId,
          )
        } else {
          throw new Error('회원을 찾을 수 없습니다.')
        }
        added += 1
      } catch {
        failed += 1
      }
    }
    // 대상 대회를 열었을 때 방금 추가한 참가자가 바로 보이도록 화면에 들고 있는 목록을 갱신한다.
    if (!previewMode) await reloadParticipants(targetId)
    return { added, alreadyIn: alreadyIn.length, failed }
  }

  // ── 리스타트 대진 자동 생성 · 합류 자리 자동 배치 ──
  // 대진·합류 위치는 프로그램이 정한다(운영진이 고르지 않는다). 한 번 만든 대진은 저장되어 다시 섞이지 않고,
  // 본선 결과를 나중에 정정해도 이미 배치된 합류자·리스타트 경기는 자동으로 바뀌지 않는다(운영진이 직접 조정).

  /** 이 대회를 본선으로 삼는(대진이 만들어진) 리스타트 대회마다 합류 자리를 채운다. */
  const syncLinkedRestarts = async (sourceId: string) => {
    if (previewMode) return
    const linked = tournaments.filter((t) => t.restartSourceTournamentId === sourceId && t.status === 'bracketFixed')
    for (const t of linked) {
      await syncRestartJoiners(t.id, clubId)
      await reloadMatches(t.id) // 본선 화면의 "합류 완료" 표시가 바로 바뀌도록 리스타트 경기 목록을 새로 읽는다
    }
  }

  const handleCreateRestartBracket = async (targetId: string): Promise<string> => {
    if (!selected || !selectedMatches) throw new Error('본선 대진 정보를 찾을 수 없습니다.')
    const analysis = analyzeRestartSource(selectedMatches)
    if (!analysis.ok) throw new Error(analysis.message)
    const status = restartFirstRoundStatus(analysis.value)
    if (!status.ready) throw new Error('본선 1차 경기가 모두 최종 승인된 뒤에 만들 수 있습니다.')

    // 1차 탈락자를 대상 대회 참가자로 확실히 넣는다(이미 참가 중이면 건너뜀) — 기존 보내기 함수를 그대로 쓴다.
    const loserMemberIds = status.losers.map((l) => l.memberId)
    const sent = await handleSendToRestart(targetId, loserMemberIds)
    if (sent.failed > 0) throw new Error('1차 탈락자 일부를 리스타트 대회에 추가하지 못했습니다. 다시 시도해 주세요.')

    const entered = (await loadRestartTarget(targetId)).filter((p) => p.entryStatus === 'entered')
    if (entered.some((p) => !loserMemberIds.includes(p.memberId))) {
      throw new Error('리스타트 대회에 본선 1차 탈락자가 아닌 참가자가 있습니다. 참가자 관리에서 제외한 뒤 다시 시도해 주세요.')
    }
    const built = buildRestartBracket({
      sourceTournamentId: selected.id,
      analysis: analysis.value,
      sourceMatches: selectedMatches,
      entrants: entered.map((p) => ({ participantId: p.id, memberId: p.memberId, handicap: p.tournamentHandicap })),
    })
    if (!built.ok) throw new Error(built.message)

    const { w, entrantCount } = analysis.value
    const byes = w * 2 - entrantCount
    await createRestartBracket(
      targetId, built.value.matches,
      { sourceTournamentId: selected.id, bracketSize: w * 4, participantCount: entrantCount, at: nowIso() },
      clubId,
    )
    // 이미 확정된 본선 2차 패자가 있으면 곧바로 합류 자리에 배치한다.
    let placed = 0
    try { placed = await syncRestartJoiners(targetId, clubId) } catch { /* 나중에 다시 확인할 수 있다 */ }
    setTournaments(await fetchTournaments(clubId))
    setMatchesByTournamentId((prev) => ({ ...prev, [targetId]: [] }))
    await reloadMatches(targetId)
    await reloadParticipants(targetId)
    return `리스타트 대진을 만들었습니다. 1차전 ${w - byes}경기${byes > 0 ? `(부전승 ${byes}명 자동 배정)` : ''}, 본선 탈락자 합류 예정 자리 ${w}개`
      + `${placed > 0 ? ` (이미 확정된 ${placed}명은 바로 배치)` : ''}. 리스타트 대회를 열어 확인해 주세요.`
  }

  const handleManualRestartSync = async () => {
    if (!selectedId || refreshing) return
    setRefreshing(true)
    setRestartSyncMsg('')
    try {
      const placed = await syncRestartJoiners(selectedId, clubId)
      await reloadMatches(selectedId)
      setRestartSyncMsg(placed > 0
        ? `본선 탈락자 ${placed}명을 합류 자리에 배치했습니다.`
        : '새로 배치할 합류자가 없습니다. 본선 경기가 최종 승인되면 자동으로 배치됩니다.')
    } catch {
      setRestartSyncMsg('확인하지 못했습니다. 인터넷 연결과 관리자 로그인 상태를 확인해 주세요.')
    } finally {
      setRefreshing(false)
    }
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
  const handleBuildPreview = (includeThirdPlace = false) => {
    if (!selected) return
    const entries: TournamentDrawEntry[] = enteredParticipants
      .filter((p) => p.drawNumber !== undefined)
      .map((p) => ({ participantId: p.id, drawNumber: p.drawNumber! }))

    if (previewMode) {
      const mapping = devDrawMappingByTournamentId[selected.id]
      if (!mapping) { setError('먼저 추첨 준비를 진행해 주세요.'); return }
      const built = buildMatchesFromMapping(mapping, enteredParticipants, entries, includeThirdPlace)
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
      const built = buildMatchesFromMapping(mapping, enteredParticipants, entries, includeThirdPlace)
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

  /** 대회 삭제 — 대회 본문·참가자·경기·비공개 추첨 매핑을 전부 지운다(관리자 전용). */
  const handleDeleteTournament = () => {
    if (!selected) return
    if (previewMode) {
      setTournaments((prev) => prev.filter((t) => t.id !== selected.id))
      setParticipantsByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setDevDrawMappingByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setSelectedId(null)
      setSelectedMatchId(null)
      setView('list')
      return
    }
    void runAdminAction(async () => {
      await deleteTournament(selected.id, clubId)
      const list = await fetchTournaments(clubId)
      setTournaments(list)
      setParticipantsByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setMatchesByTournamentId((prev) => { const next = { ...prev }; delete next[selected.id]; return next })
      setSelectedId(null)
      setSelectedMatchId(null)
      setView('list')
    })
  }

  const selectedMatch = selectedMatchId ? (selectedMatches?.find((m) => m.id === selectedMatchId) ?? null) : null
  const finalMatch = selectedMatches?.find((m) => m.nextMatchId === null) ?? null

  // 리스타트 대진(합류 예약 자리가 있는 대진)인지 — 맞으면 전체 대진표 그림 대신 라운드별 보기만 쓴다.
  const isRestartBracket = !!selectedMatches?.some((m) => m.playerBJoinFrom)
  const restartJoin = selectedMatches && isRestartBracket ? restartJoinProgress(selectedMatches) : undefined
  // 리스타트 대회는 현재 본선 이름 + " 리스타트전"으로 자동 연결한다(운영진이 고르지 않는다).
  const restartLookup = selected && selectedMatches && selectedMatches.length > 0 && !isRestartBracket
    ? findRestartTarget(selected, tournaments) : null
  const restartTargetId = restartLookup?.kind === 'found' && restartLookup.tournament.status === 'bracketFixed'
    ? restartLookup.tournament.id : null
  const restartTargetMatches = restartTargetId ? matchesByTournamentId[restartTargetId] : undefined
  const restartPlan: RestartBracketPlan | undefined = (() => {
    if (!selectedMatches || isRestartBracket) return undefined
    const analysis = analyzeRestartSource(selectedMatches)
    if (!analysis.ok) return { ok: false, message: analysis.message }
    const status = restartFirstRoundStatus(analysis.value)
    return {
      ok: true, status, w: analysis.value.w, entrants: analysis.value.entrantCount,
      joinLabel: `본선 ${roundLabel(analysis.value.secondRound[0].playerCountInRound)} 탈락자 합류 예정`,
      firstRoundLosers: status.losers.map((l) => ({ memberId: l.memberId, name: nameOf(l.participantId) })),
      joinRows: restartJoinRows(analysis.value.secondRound, restartTargetMatches).map((row) => ({
        key: row.sourceMatchId, matchNumber: row.matchNumber, status: row.status,
        name: row.loserParticipantId ? nameOf(row.loserParticipantId) : null,
      })),
    }
  })()

  // 리스타트 대진이 이미 만들어졌다면 본선 화면의 합류 현황에 쓸 리스타트 경기 목록을 한 번 읽어 둔다.
  const restartTargetLoaded = restartTargetMatches !== undefined
  useEffect(() => {
    if (previewMode || !isAuthorizedAdmin || !restartTargetId || restartTargetLoaded) return
    void reloadMatches(restartTargetId).catch(() => { /* 합류 현황 표시만 못 하는 것이라 조용히 넘어간다 */ })
    // reloadMatches는 매 렌더마다 새로 만들어지므로 의존성에서 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, isAuthorizedAdmin, restartTargetId, restartTargetLoaded])

  const nowIso = () => new Date().toISOString()

  const handleSelectMatch = (match: TournamentMatch) => {
    setMatchError('')
    setSelectedMatchId(match.id)
  }

  /**
   * 경기 관련 동작(입력·확인·수정요청·관리자확인·정정·최종승인·기권)의 공통 처리.
   * previewMode에서는 순수 도메인 함수를 그 자리에서 적용해 로컬 state만 바꾸고,
   * 실제 운영에서는 lib/tournamentSync.ts의 대응 함수(서버 왕복 후 결과 반환)를 부른다.
   * 둘 다 끝나면 selectedMatchId를 그대로 유지해 패널이 최신 상태로 다시 그려지게 한다.
   */
  const runMatchAction = async (
    previewApply: () => { ok: true; value: TournamentMatch } | { ok: false; message: string },
    serverCall: () => Promise<TournamentMatch>,
  ) => {
    if (!selected) return
    setBusy(true)
    setMatchError('')
    try {
      if (previewMode) {
        const applied = previewApply()
        if (!applied.ok) { setMatchError(applied.message); return }
        setMatchesByTournamentId((prev) => ({
          ...prev,
          [selected.id]: (prev[selected.id] ?? []).map((m) => (m.id === applied.value.id ? applied.value : m)),
        }))
      } else {
        await serverCall()
        await reloadMatches(selected.id)
      }
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : '처리하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 관리자 최종 승인·기권 처리는 승자 확정과 동시에 다음 경기 진출까지 함께 일어난다.
   * previewMode에서는 서버의 원자적 writeBatch(commitOfficialResult)를 흉내내 두 경기를
   * 한 번의 setState로 같이 바꾼다 — 중간에 "승자는 확정됐는데 다음 경기는 그대로"인
   * 상태가 로컬 미리보기에서도 생기지 않게 하기 위해서다.
   */
  const runApprovalAction = async (
    previewApply: () => { ok: true; value: { match: TournamentMatch; promotion: ReturnType<typeof promotionFor> } } | { ok: false; message: string },
    serverCall: () => Promise<TournamentMatch>,
  ) => {
    if (!selected) return
    setBusy(true)
    setMatchError('')
    try {
      if (previewMode) {
        const applied = previewApply()
        if (!applied.ok) { setMatchError(applied.message); return }
        setMatchesByTournamentId((prev) => {
          const list = (prev[selected.id] ?? []).map((m) => (m.id === applied.value.match.id ? applied.value.match : m))
          const promoted = applied.value.promotion
            ? list.map((m) => (m.id === applied.value.promotion!.nextMatchId ? applyPromotion(m, applied.value.promotion!) : m))
            : list
          return { ...prev, [selected.id]: promoted }
        })
      } else {
        await serverCall()
        await reloadMatches(selected.id)
        // 이 대회를 본선으로 삼는 리스타트 대회가 있으면, 방금 확정된 패자를 합류 자리에 자동 배치한다.
        // 배치에 실패해도 방금 한 최종 승인은 그대로 유효하다(안내만 보여 주고 나중에 다시 확인할 수 있다).
        try {
          await syncLinkedRestarts(selected.id)
        } catch {
          setMatchError('최종 승인은 저장되었지만 리스타트 대회 합류 자리 배치는 하지 못했습니다. 리스타트 대회 화면에서 "합류자 자동 배치 확인"을 눌러 주세요.')
        }
      }
    } catch (e) {
      setMatchError(e instanceof Error ? e.message : '처리하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const handleSubmitResult = (scoreA: number | string, scoreB: number | string) => {
    if (!selectedMatch || !memberId) return
    void runMatchAction(
      () => applySubmitResult(selectedMatch, { byMemberId: memberId, scoreA, scoreB, at: nowIso() }),
      () => submitTournamentMatchResult(selected!.id, selectedMatch.id, { byMemberId: memberId, scoreA, scoreB, at: nowIso() }, clubId),
    )
  }

  const handleAdminEnterResult = (scoreA: number | string, scoreB: number | string) => {
    if (!selectedMatch) return
    const uid = previewMode ? 'dev-admin-uid' : (adminUid ?? '')
    void runMatchAction(
      () => applyAdminEnter(selectedMatch, { adminUid: uid, scoreA, scoreB, at: nowIso() }),
      () => adminEntersTournamentMatchResult(selected!.id, selectedMatch.id, { adminUid: uid, scoreA, scoreB, at: nowIso() }, clubId),
    )
  }

  const handleVerify = () => {
    if (!selectedMatch || !memberId) return
    void runMatchAction(
      () => applyVerify(selectedMatch, { byMemberId: memberId, at: nowIso() }),
      () => verifyTournamentMatchResult(selected!.id, selectedMatch.id, { byMemberId: memberId, at: nowIso() }, clubId),
    )
  }

  const handleRequestCorrection = () => {
    if (!selectedMatch || !memberId) return
    void runMatchAction(
      () => applyRequestCorrection(selectedMatch, { byMemberId: memberId, at: nowIso() }),
      () => requestTournamentMatchCorrection(selected!.id, selectedMatch.id, { byMemberId: memberId, at: nowIso() }, clubId),
    )
  }

  const handleAdminVerify = () => {
    if (!selectedMatch) return
    const uid = previewMode ? 'dev-admin-uid' : (adminUid ?? '')
    void runMatchAction(
      () => applyAdminVerify(selectedMatch, { adminUid: uid, at: nowIso() }),
      () => adminVerifyTournamentMatch(selected!.id, selectedMatch.id, { adminUid: uid, at: nowIso() }, clubId),
    )
  }

  const handleAdminCorrect = (scoreA: number | string, scoreB: number | string) => {
    if (!selectedMatch) return
    const uid = previewMode ? 'dev-admin-uid' : (adminUid ?? '')
    void runMatchAction(
      () => applyAdminCorrect(selectedMatch, { adminUid: uid, scoreA, scoreB, at: nowIso() }),
      () => correctTournamentMatchByAdmin(selected!.id, selectedMatch.id, { adminUid: uid, scoreA, scoreB, at: nowIso() }, clubId),
    )
  }

  const handleApprove = (officialWinnerParticipantId?: string) => {
    if (!selectedMatch) return
    const uid = previewMode ? 'dev-admin-uid' : (adminUid ?? '')
    void runApprovalAction(
      () => applyApprove(selectedMatch, { adminUid: uid, at: nowIso(), officialWinnerParticipantId }),
      () => approveTournamentMatch(selected!.id, selectedMatch.id, { adminUid: uid, at: nowIso(), officialWinnerParticipantId }, clubId),
    )
  }

  const handleForfeit = (winnerParticipantId: string) => {
    if (!selectedMatch) return
    const uid = previewMode ? 'dev-admin-uid' : (adminUid ?? '')
    void runApprovalAction(
      () => applyForfeit(selectedMatch, { adminUid: uid, at: nowIso(), winnerParticipantId }),
      () => declareTournamentForfeit(selected!.id, selectedMatch.id, { adminUid: uid, at: nowIso(), winnerParticipantId }, clubId),
    )
  }

  const handleFinishTournament = () => {
    if (!selected || !selectedMatches) return
    if (previewMode) {
      const placements = calculateFinalPlacements(selectedMatches)
      if (!placements.championParticipantId) return
      setTournaments((prev) => prev.map((t) => (t.id === selected.id
        ? { ...t, status: 'finished', completedAt: nowIso(), championParticipantId: placements.championParticipantId, runnerUpParticipantId: placements.runnerUpParticipantId }
        : t)))
      return
    }
    void runAdminAction(async () => {
      await finishTournament(selected.id, { at: nowIso() }, clubId)
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
        {liveToast && (
          <div role="status" style={{
            position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.8)', color: '#fff', borderRadius: 20,
            padding: '12px 20px', fontSize: 16, fontWeight: 600, zIndex: 9999,
            maxWidth: 'calc(100vw - 32px)', textAlign: 'center', pointerEvents: 'none',
          }}>
            새 경기결과가 반영되었습니다.
          </div>
        )}
        <button type="button" onClick={() => setView('list')} style={{ marginBottom: 4 }}>← 대회 목록</button>
        <h2 className="tab-title" style={{ marginBottom: 0 }}>{selected.name}</h2>
        <span className="muted">📅 {selected.date} · 제한시간 {selected.timeLimitMinutes}분</span>
        {error && <p className="info-msg">{error}</p>}

        {!isGuest && memberId && (
          <TournamentEntryCard
            tournament={selected}
            participant={myParticipant}
            enteredParticipants={enteredParticipants}
            onSetEntryStatus={handleSetOwnEntryStatus}
            busy={busy}
          />
        )}

        {/* 확정된 공개 대진표 — 회원·관리자 모두 같은 화면 하나를 본다(중복 렌더링 방지).
            아직 대진이 없으면(matches 없음) 아무것도 그리지 않는다. 대회가 끝난 뒤에도
            대진표는 계속 볼 수 있어야 하므로 finished도 함께 보여준다. */}
        {(selected.status === 'bracketFixed' || selected.status === 'finished') && selectedMatches && selectedMatches.length > 0 && (
          <>
            <LiveStatusBar
              matches={selectedMatches} lastUpdatedAt={lastUpdatedAt} broken={liveBroken}
              refreshing={refreshing} onRefresh={previewMode ? undefined : handleManualRefresh}
              join={restartJoin}
            />
            {isRestartBracket && isAuthorizedAdmin && !previewMode && (
              <div className="card col-card">
                <span className="muted" style={{ fontSize: 15 }}>
                  본선 경기가 최종 승인되면 탈락자가 합류 자리에 자동으로 배치됩니다. 배치되지 않았다면 아래 버튼을 눌러 주세요.
                </span>
                <button className="block" style={{ fontSize: 16, padding: 12, minHeight: 48 }} disabled={refreshing} onClick={() => void handleManualRestartSync()}>
                  합류자 자동 배치 확인
                </button>
                {restartSyncMsg && <p className="info-msg" style={{ fontSize: 15, margin: 0 }}>{restartSyncMsg}</p>}
              </div>
            )}
            {!isRestartBracket && <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={bracketViewMode === 'round' ? 'primary grow' : 'grow'} style={{ fontSize: 16, fontWeight: 700, padding: 12 }}
                onClick={() => setBracketViewMode('round')}
              >
                라운드별 보기
              </button>
              <button
                className={bracketViewMode === 'full' ? 'primary grow' : 'grow'} style={{ fontSize: 16, fontWeight: 700, padding: 12 }}
                onClick={() => setBracketViewMode('full')}
              >
                전체 대진표
              </button>
            </div>}

            {bracketViewMode === 'round' || isRestartBracket ? (
              <TournamentBracketView
                matches={selectedMatches} nameOf={nameOf} highlightMemberId={memberId ?? undefined}
                onSelectMatch={handleSelectMatch} selectedMatchId={selectedMatchId}
                renderMatchDetail={(m) => (
                  <TournamentMatchPanel
                    match={m}
                    nameOf={nameOf}
                    viewerMemberId={memberId ?? undefined}
                    isAdmin={isAdmin && isAuthorizedAdmin}
                    busy={busy}
                    error={matchError}
                    onClose={() => { setSelectedMatchId(null); setMatchError('') }}
                    onSubmitResult={handleSubmitResult}
                    onAdminEnterResult={handleAdminEnterResult}
                    onVerify={handleVerify}
                    onRequestCorrection={handleRequestCorrection}
                    onAdminVerify={handleAdminVerify}
                    onAdminCorrect={handleAdminCorrect}
                    onApprove={handleApprove}
                    onForfeit={handleForfeit}
                  />
                )}
              />
            ) : (
              <>
                <TournamentBracketVisual
                  matches={selectedMatches} nameOf={nameOf}
                  onSelectMatch={handleSelectMatch} selectedMatchId={selectedMatchId}
                />
                {selectedMatch && (
                  <TournamentMatchPanel
                    match={selectedMatch}
                    nameOf={nameOf}
                    viewerMemberId={memberId ?? undefined}
                    isAdmin={isAdmin && isAuthorizedAdmin}
                    busy={busy}
                    error={matchError}
                    onClose={() => { setSelectedMatchId(null); setMatchError('') }}
                    onSubmitResult={handleSubmitResult}
                    onAdminEnterResult={handleAdminEnterResult}
                    onVerify={handleVerify}
                    onRequestCorrection={handleRequestCorrection}
                    onAdminVerify={handleAdminVerify}
                    onAdminCorrect={handleAdminCorrect}
                    onApprove={handleApprove}
                    onForfeit={handleForfeit}
                  />
                )}
              </>
            )}
          </>
        )}

        {finalMatch && finalMatch.status === 'official' && selectedMatches && (
          <TournamentFinalResults
            tournament={selected}
            matches={selectedMatches}
            nameOf={nameOf}
            isAdmin={isAdmin && isAuthorizedAdmin}
            busy={busy}
            onFinish={handleFinishTournament}
          />
        )}

        {/* 리스타트 참가자 보내기 — 관리자 전용. 대진이 확정된 본선 대회에서만, 최종 승인된 탈락자를 후보로 보여준다. */}
        {isAdmin && isAuthorizedAdmin && (selected.status === 'bracketFixed' || selected.status === 'finished')
          && selectedMatches && selectedMatches.length > 0 && !isRestartBracket && (
          <TournamentRestartSender
            key={selected.id}
            currentTournament={selected}
            candidates={restartCandidates(selectedMatches, selectedParticipants)}
            tournaments={tournaments}
            loadTargetParticipants={loadRestartTarget}
            onSend={handleSendToRestart}
            bracketPlan={restartPlan}
            onCreateBracket={previewMode ? undefined : handleCreateRestartBracket}
            onRefreshTournaments={previewMode ? undefined : async () => { setTournaments(await fetchTournaments(clubId)) }}
          />
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

        {/* 대회 삭제 — 관리자 전용, 회원 화면에는 절대 노출되지 않는다. 실수 방지를 위해
            관리자 영역 맨 아래에만 두고, 대회명을 넣은 확인창을 반드시 거친다. */}
        {isAdmin && isAuthorizedAdmin && (
          <div className="card col-card" style={{ borderColor: 'var(--danger)' }}>
            <span className="muted" style={{ fontSize: 13 }}>
              대회를 완전히 지웁니다. 참가자·대진·경기 기록이 모두 함께 삭제되며 되돌릴 수 없습니다.
            </span>
            <button
              className="danger block" style={{ fontSize: 15, padding: 12 }} disabled={busy}
              onClick={() => {
                if (window.confirm(
                  `'${selected.name}'를 삭제하시겠습니까?\n대회 참가자, 대진 및 경기 정보가 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`,
                )) {
                  handleDeleteTournament()
                }
              }}
            >
              대회 삭제
            </button>
          </div>
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

/** 진행률("3 / 8 경기 완료")과 최근 반영 시각, 보조 새로고침 버튼. 실시간 반영이 기본이다. */
function LiveStatusBar({
  matches, lastUpdatedAt, broken, refreshing, onRefresh, join,
}: {
  /** 리스타트 대진일 때만: 본선 탈락자 합류 자리 확정 현황. */
  join?: { filled: number; total: number }
  matches: TournamentMatch[]
  lastUpdatedAt: Date | null
  broken: boolean
  refreshing: boolean
  onRefresh?: () => void
}) {
  const { done, total } = countTournamentProgress(matches)
  const time = lastUpdatedAt
    ? lastUpdatedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : null
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 17, fontWeight: 800 }}>{done} / {total} 경기 완료</span>
        {join && join.total > 0 && (
          <span style={{ fontSize: 15, fontWeight: 600 }}>본선 탈락자 합류 {join.filled} / {join.total}자리 확정</span>
        )}
        <span className="muted" style={{ fontSize: 15 }}>
          {broken ? '실시간 연결이 끊겼습니다. 새로고침을 눌러 주세요.' : time ? `최근 업데이트: ${time}` : '최신 결과를 확인하는 중...'}
        </span>
      </div>
      {onRefresh && (
        <button type="button" onClick={onRefresh} disabled={refreshing} style={{ flexShrink: 0, fontSize: 16, padding: '11px 14px', minHeight: 44 }}>
          {refreshing ? '확인 중...' : '새로고침'}
        </button>
      )}
    </div>
  )
}
