import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppState, Member, Game } from '../types'

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
  replaceAll: (state: AppState) => void
}

const uid = () => crypto.randomUUID()
const now = () => new Date().toISOString()

export const useApp = create<Store>()(
  persist(
    (set) => ({
      members: [],
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

      replaceAll: (state) => set(() => ({ ...state })),
    }),
    { name: 'billiards-club-state' },
  ),
)
