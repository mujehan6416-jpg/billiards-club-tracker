import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Member, Game, LedgerRecord } from '../types'
import { SEED_MEMBERS } from '../data/seedMembers'

interface Store extends AppState {
  addMember: (name: string, handicap: number) => void
  updateMember: (id: string, patch: Partial<Member>) => void
  setHandicap: (id: string, handicap: number) => void
  setActive: (id: string, active: boolean) => void
  createSession: (date: string, attendeeIds: string[], type?: 'regular' | 'flash') => string
  approveSession: (sessionId: string) => void
  deleteSession: (sessionId: string) => void
  publishLineup: (sessionId: string, lineup: import('../types').LineupMatch[], sitOutIds: string[]) => void
  setAttendees: (sessionId: string, attendeeIds: string[]) => void
  setRoundParticipants: (sessionId: string, round: 1 | 2, participantIds: string[]) => void
  addGame: (sessionId: string, game: Omit<Game, 'id' | 'playedAt'>) => void
  deleteGame: (sessionId: string, gameId: string) => void
  confirmGame: (sessionId: string, gameId: string) => void
  updateGameResult: (sessionId: string, gameId: string, patch: Partial<Pick<Game, 'scoreA' | 'scoreB' | 'handicapA' | 'handicapB'>>) => void
  /** 관리자가 일반회원 제출 결과에 "수정 요청"을 누를 때 사용. pending은 유지하고 revisionRequested만 true로 저장한다. */
  requestGameRevision: (sessionId: string, gameId: string) => void
  /**
   * 참가자가 "수정 요청"된 본인 경기 결과를 다시 제출할 때 사용. 점수를 갱신하고 revisionRequested를
   * 해제한다(pending은 그대로 true — 여전히 관리자 확인이 필요한 상태로 되돌아간다).
   */
  resubmitGameResult: (sessionId: string, gameId: string, patch: { scoreA: number; scoreB: number; endType: Game['endType'] }) => void
  cleanupOldPending: () => void
  upsertLedger: (record: Omit<LedgerRecord, 'id'> & { id?: string }) => void
  deleteLedger: (id: string) => void
  touchBackup: () => void
  applyHandicapCsv: (rows: import('../lib/backup').HandicapRow[]) => void
  applyMemberCsv: (rows: import('../lib/backup').MemberRow[]) => void
  setMemberPassword: (id: string, password: string) => void
  applyGameCsv: (rows: import('../lib/backup').GameRow[]) => void
  replaceAll: (state: AppState) => void
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export const useApp = create<Store>()(
  persist(
    (set) => ({
      members: SEED_MEMBERS,
      sessions: [],
      settings: { lastBackupAt: null },
      ledger: [],

      addMember: (name, handicap) =>
        set((s) => ({
          members: [
            ...s.members,
            {
              id: uid(),
              name,
              handicap,
              active: true,
              handicapHistory: [{ value: handicap, changedAt: now() }],
            },
          ],
        })),

      updateMember: (id, patch) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),

      setHandicap: (id, handicap) =>
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id
              ? { ...m, handicap, handicapHistory: [...m.handicapHistory, { value: handicap, changedAt: now() }] }
              : m,
          ),
        })),

      setActive: (id, active) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, active } : m)),
        })),

      createSession: (date, attendeeIds, type = 'regular') => {
        const id = uid()
        set((s) => ({ sessions: [...s.sessions, { id, date, type, approved: type === 'regular', attendeeIds, games: [] }] }))
        return id
      },

      // 세션 승인(번개모임 전체를 정규 통계에 반영)과 개별 경기 확인(confirmGame, 회원이 입력한
      // 점수를 관리자가 하나씩 검토)은 원래 서로 다른 동작이다. 다만 승인 후에도 game.pending이
      // 남아있으면 회원 화면 노출 필터(!g.pending)와 stats.ts의 통계 포함 조건에 걸려 "승인됨"
      // 배너와 달리 회원에게는 계속 안 보이므로, 승인 시 해당 세션의 pending도 함께 해제한다.
      approveSession: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? { ...ss, approved: true, games: ss.games.map((g) => (g.pending ? { ...g, pending: false } : g)) }
              : ss,
          ),
        })),

      deleteSession: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.filter((ss) => ss.id !== sessionId),
        })),

      publishLineup: (sessionId, lineup, sitOutIds) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => ss.id === sessionId ? { ...ss, lineup, sitOutIds } : ss),
        })),

      // 라운드별 "이번 라운드 경기 참가" 명단을 관리자가 직접 저장한다(참가하지 않는 attendeeIds는
      // 자동으로 그 라운드의 미대진자가 된다). round1ParticipantIds/round2ParticipantIds는 각각
      // 독립적으로 저장되므로, 2라운드만 편집해도 1라운드 값은 그대로 남는다.
      setRoundParticipants: (sessionId, round, participantIds) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? { ...ss, [round === 1 ? 'round1ParticipantIds' : 'round2ParticipantIds']: [...participantIds] }
              : ss,
          ),
        })),

      setAttendees: (sessionId, attendeeIds) =>
        set((s) => ({
          sessions: s.sessions.map((ss) => (ss.id === sessionId ? { ...ss, attendeeIds } : ss)),
        })),

      addGame: (sessionId, game) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId ? { ...ss, games: [...ss.games, { ...game, id: uid(), playedAt: now() }] } : ss,
          ),
        })),

      deleteGame: (sessionId, gameId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId ? { ...ss, games: ss.games.filter((g) => g.id !== gameId) } : ss,
          ),
        })),

      confirmGame: (sessionId, gameId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? { ...ss, games: ss.games.map((g) => g.id === gameId ? { ...g, pending: false, revisionRequested: false } : g) }
              : ss,
          ),
        })),

      requestGameRevision: (sessionId, gameId) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? { ...ss, games: ss.games.map((g) => g.id === gameId ? { ...g, pending: true, revisionRequested: true } : g) }
              : ss,
          ),
        })),

      resubmitGameResult: (sessionId, gameId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? { ...ss, games: ss.games.map((g) => g.id === gameId ? { ...g, ...patch, pending: true, revisionRequested: false } : g) }
              : ss,
          ),
        })),

      updateGameResult: (sessionId, gameId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((ss) =>
            ss.id === sessionId
              ? {
                  ...ss,
                  games: ss.games.map((g) => {
                    if (g.id !== gameId) return g
                    const updated = { ...g, ...patch }
                    const endType: 'cleared' | 'time' =
                      updated.scoreA >= updated.handicapA || updated.scoreB >= updated.handicapB
                        ? 'cleared'
                        : 'time'
                    return { ...updated, endType }
                  }),
                }
              : ss,
          ),
        })),

      upsertLedger: (record) =>
        set((s) => {
          const id = record.id ?? uid()
          const full: LedgerRecord = { ...record, id }
          const idx = s.ledger.findIndex((r) => r.id === id)
          if (idx >= 0) {
            const updated = [...s.ledger]
            updated[idx] = full
            return { ledger: updated }
          }
          return { ledger: [...s.ledger, full] }
        }),

      deleteLedger: (id) =>
        set((s) => ({ ledger: s.ledger.filter((r) => r.id !== id) })),

      cleanupOldPending: () =>
        set((s) => {
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - 30)
          const cutoffIso = cutoff.toISOString()
          return {
            sessions: s.sessions.map((ss) => ({
              ...ss,
              games: ss.games.filter((g) => !g.pending || g.playedAt >= cutoffIso),
            })),
          }
        }),

      touchBackup: () => set((s) => ({ settings: { ...s.settings, lastBackupAt: now() } })),

      applyHandicapCsv: (rows) =>
        set((s) => {
          const nameMap = new Map(s.members.map((m) => [m.name, m.id]))
          const patches = new Map<string, import('../types').HandicapChange[]>()
          for (const row of rows) {
            const id = nameMap.get(row.name)
            if (!id) continue
            if (!patches.has(id)) patches.set(id, [])
            patches.get(id)!.push({ value: row.handicap, changedAt: row.date + 'T00:00:00.000Z' })
          }
          const members = s.members.map((m) => {
            const newEntries = patches.get(m.id)
            if (!newEntries) return m
            const existingKeys = new Set(m.handicapHistory.map((h) => h.changedAt.slice(0, 10)))
            const toAdd = newEntries.filter((e) => !existingKeys.has(e.changedAt.slice(0, 10)))
            const merged = [...m.handicapHistory, ...toAdd].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
            const latest = merged[merged.length - 1]
            return { ...m, handicapHistory: merged, handicap: latest.value }
          })
          return { members }
        }),

      applyMemberCsv: (rows) =>
        set((s) => {
          const existingNames = new Set(s.members.map((m) => m.name))
          const toAdd = rows.filter((r) => !existingNames.has(r.name))
          const newMembers = toAdd.map((r) => ({
            id: uid(),
            name: r.name,
            handicap: r.handicap,
            active: true,
            handicapHistory: [{ value: r.handicap, changedAt: now() }],
          }))
          // 기존 회원 핸디 업데이트 (이름 일치)
          const updated = s.members.map((m) => {
            const row = rows.find((r) => r.name === m.name)
            if (!row || row.handicap === m.handicap) return m
            return {
              ...m,
              handicap: row.handicap,
              handicapHistory: [...m.handicapHistory, { value: row.handicap, changedAt: now() }],
            }
          })
          return { members: [...updated, ...newMembers] }
        }),

      setMemberPassword: (id, password) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, password } : m)),
        })),

      applyGameCsv: (rows) =>
        set((s) => {
          const nameToMember = new Map(s.members.map((m) => [m.name, m]))
          const handicapAt = (m: import('../types').Member, date: string) => {
            const sorted = [...m.handicapHistory].sort((a, b) => a.changedAt.localeCompare(b.changedAt))
            let val = sorted[0]?.value ?? m.handicap
            for (const h of sorted) {
              if (h.changedAt.slice(0, 10) <= date) val = h.value
            }
            return val
          }
          // group by date
          const byDate = new Map<string, typeof rows>()
          for (const r of rows) {
            if (!byDate.has(r.date)) byDate.set(r.date, [])
            byDate.get(r.date)!.push(r)
          }
          const sessions = [...s.sessions]
          for (const [date, dateRows] of byDate) {
            let session = sessions.find((ss) => ss.date === date)
            if (!session) {
              const attendeeNames = new Set<string>()
              for (const r of dateRows) { attendeeNames.add(r.player1); attendeeNames.add(r.player2) }
              const attendeeIds = [...attendeeNames].map((n) => nameToMember.get(n)?.id).filter(Boolean) as string[]
              session = { id: uid(), date, attendeeIds, games: [] }
              sessions.push(session)
            }
            for (const r of dateRows) {
              const mA = nameToMember.get(r.player1)
              const mB = nameToMember.get(r.player2)
              if (!mA || !mB) continue
              const isDraw = r.winner === '무승부'
              const winnerIsA = r.winner === r.player1
              const hA = handicapAt(mA, date)
              const hB = handicapAt(mB, date)
              let scoreA = winnerIsA ? r.winnerScore : r.loserScore
              let scoreB = winnerIsA ? r.loserScore : r.winnerScore
              let endType: 'cleared' | 'time'
              if (isDraw) {
                scoreA = 0; scoreB = 0; endType = 'time'
              } else if (winnerIsA && scoreA >= hA) {
                endType = 'cleared'
              } else if (!winnerIsA && scoreB >= hB) {
                endType = 'cleared'
              } else {
                // time mode: winner must have strictly higher score
                endType = 'time'
                if (winnerIsA && scoreA <= scoreB) scoreA = scoreB + 1
                if (!winnerIsA && scoreB <= scoreA) scoreB = scoreA + 1
              }
              session.games.push({
                id: uid(),
                playerAId: mA.id,
                playerBId: mB.id,
                handicapA: hA,
                handicapB: hB,
                scoreA,
                scoreB,
                endType,
                playedAt: date + 'T00:00:00.000Z',
                winnerId: isDraw ? null : (winnerIsA ? mA.id : mB.id),
              })
            }
          }
          return { sessions }
        }),

      replaceAll: (state) => set(() => ({ ...state, ledger: state.ledger ?? [] })),
    }),
    { name: 'billiards-club-state' },
  ),
)

