import { create } from 'zustand'

interface AuthStore {
  memberId: string | null
  memberName: string | null
  isGuest: boolean
  login: (id: string, name: string) => void
  logout: () => void
}

export const useAuth = create<AuthStore>()((set) => ({
  memberId: null,
  memberName: null,
  isGuest: false,
  login: (id, name) => set({ memberId: id, memberName: name, isGuest: id === '__guest__' }),
  logout: () => set({ memberId: null, memberName: null, isGuest: false }),
}))
