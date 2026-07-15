import { create } from 'zustand'
import type { User } from 'firebase/auth'
import { adminSignIn, adminSignOut, subscribeAuthState, fetchAdminDoc } from '../lib/adminAuth'

// 관리자 전용 Firebase Auth 상태. 기존 adminStore.ts(PIN, 화면 잠금용)와는 별개이며
// adminStore.ts는 이번 단계에서 전혀 수정하지 않는다 — PIN은 그대로 "관리자 화면 진입·
// 확정/취소 등 민감 작업의 2차 확인용"으로 계속 쓴다 (Firebase Auth = 서버 권한 확인,
// PIN = 화면 단 재확인). 기본 PIN '1234'를 바꾸지 않은 기기는 여전히 위험하다 —
// adminStore.ts:3 참고, 이번 단계에서 PIN 구조 자체는 바꾸지 않는다.

export type AdminAuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'authorizedAdmin' | 'authError'

interface AdminAuthState {
  status: AdminAuthStatus
  uid: string | null
  email: string | null
  adminDisplayName: string | null
  errorMessage: string | null
  signIn: (email: string, password: string) => Promise<void>
  signOutAdmin: () => Promise<void>
  init: () => () => void
}

// 관리자가 아닌 것으로 확인된 경우에도 자동 로그아웃은 하지 않는다.
// 이유: (1) admins 문서 확인이 일시적 네트워크 오류로 실패한 경우까지 강제 로그아웃되면
//       진짜 관리자가 이메일/비밀번호를 다시 입력해야 하는 불편이 생긴다.
//       (2) Firestore 규칙상 Firebase Auth 로그인 성공만으로는 정산 데이터에 전혀 접근할 수
//       없으므로(관리자 문서 확인 전까지 읽기·쓰기 모두 거부), 로그인 상태만 남아있는 것 자체는
//       위험하지 않다. 대신 "관리자 권한이 없습니다" 오류를 명확히 표시하고, 로그아웃 버튼을
//       사용자가 직접 누르게 한다.
async function resolveAdmin(user: User, set: (patch: Partial<AdminAuthState>) => void) {
  set({ status: 'authenticated', uid: user.uid, email: user.email, errorMessage: null })
  try {
    const adminDoc = await fetchAdminDoc(user.uid)
    if (adminDoc) {
      set({ status: 'authorizedAdmin', adminDisplayName: adminDoc.displayName ?? '관리자', errorMessage: null })
    } else {
      set({ status: 'authError', adminDisplayName: null, errorMessage: '관리자 권한이 없습니다. (admins 문서 없음 또는 비활성)' })
    }
  } catch {
    set({ status: 'authError', adminDisplayName: null, errorMessage: '관리자 권한 확인 중 오류가 발생했습니다. 다시 시도해주세요.' })
  }
}

export const useAdminAuthStore = create<AdminAuthState>()((set) => ({
  status: 'loading',
  uid: null,
  email: null,
  adminDisplayName: null,
  errorMessage: null,

  signIn: async (email, password) => {
    set({ status: 'loading', errorMessage: null })
    try {
      await adminSignIn(email, password)
      // 로그인 성공 이후 상태 전환은 init()의 subscribeAuthState 콜백에서 처리된다.
    } catch (e) {
      const code = (e as { code?: string })?.code
      const message =
        code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found'
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : '로그인 중 오류가 발생했습니다.'
      set({ status: 'unauthenticated', errorMessage: message })
    }
  },

  signOutAdmin: async () => {
    await adminSignOut()
    set({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  },

  init: () => {
    const unsubscribe = subscribeAuthState((user) => {
      if (!user) {
        set({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
        return
      }
      resolveAdmin(user, set)
    })
    return unsubscribe
  },
}))
