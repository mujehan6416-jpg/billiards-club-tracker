import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Member, Game } from '../types'
import { SEED_MEMBERS } from '../data/seedMembers'

interface Store extends AppState {
  addMember: (name: string, handicap: number) => void
  updateMember: (id: string, patch: Partial<Member>) => void
  setHandicap: (id: string, handicap: number) => void
  setActive: (id: string, active: boolean) => void
  createSession: (date: string, attendeeIds: string[]) => string
  setAttendees: (sessionId: string, attendeeIds: string[]) => void
  addGame: (sessionId: string, game: Omit<Game, 'id' | 'playedAt'>) => void
  deleteGame: (sessionId: string, gameId: string) => void
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

      createSession: (date, attendeeIds) => {
        const id = uid()
        set((s) => ({ sessions: [...s.sessions, { id, date, attendeeIds, games: [] }] }))
        return id
      },

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

      replaceAll: (state) => set(() => ({ ...state })),
    }),
    { name: 'billiards-club-state' },
  ),
)

