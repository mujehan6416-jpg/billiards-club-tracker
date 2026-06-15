import { create } from 'zustand'

const DEFAULT_PIN = '1234'
const PIN_KEY = 'billiards-admin-pin'

function getStoredPin(): string {
  return localStorage.getItem(PIN_KEY) ?? DEFAULT_PIN
}

interface AdminStore {
  isAdmin: boolean
  login: (pin: string) => boolean
  logout: () => void
  changePin: (oldPin: string, newPin: string) => boolean
}

export const useAdmin = create<AdminStore>()((set) => ({
  isAdmin: false,
  login: (pin) => {
    if (pin === getStoredPin()) {
      set({ isAdmin: true })
      return true
    }
    return false
  },
  logout: () => set({ isAdmin: false }),
  changePin: (oldPin, newPin) => {
    if (oldPin !== getStoredPin()) return false
    localStorage.setItem(PIN_KEY, newPin)
    return true
  },
}))
