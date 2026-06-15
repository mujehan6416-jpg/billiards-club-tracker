import { create } from 'zustand'

interface AuthStore {
  memberId: string | null
  memberName: string | null
  login: (id: string, name: string) => void
  logout: () => void
}

export const useAuth = create<AuthStore>()((set) => ({
  memberId: null,
  memberName: null,
  login: (id, name) => set({ memberId: id, memberName: name }),
  logout: () => set({ memberId: null, memberName: null }),
}))
