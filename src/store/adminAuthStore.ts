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

// 여러 화면(App.tsx, SettlementAdminTab, DeviceLinkAdminCard, SplitMigrationCard 등)이 각자
// init()을 부른다. onAuthStateChanged 구독을 화면마다 새로 만들면, 그 구독은 생성되는 순간
// Firebase가 "현재 상태"를 즉시 한 번 다시 불러주므로(Firebase 표준 동작) resolveAdmin()이
// 매번 다시 실행돼 status가 이미 'authorizedAdmin'이어도 'authenticated'로 잠깐 되돌아간다.
// 이 잠깐의 'authenticated' 상태가 App.tsx의 관리자 게이트 조건(status !== 'authorizedAdmin')을
// 다시 true로 만들어 관리자 화면이 사라졌다 나타났다 하는 깜빡임(무한 루프)으로 이어졌다 —
// 관리자 화면이 사라지면 그 화면 안의 DeviceLinkAdminCard 등도 함께 사라지고, 다시 나타날 때
// 또 init()을 불러 같은 일이 반복된다. 그래서 실제 Firebase 구독은 앱 전체에서 딱 하나만
// 만들고(참조 카운트로 관리), 여러 화면은 이 하나의 구독을 공유한다.
let sharedUnsubscribe: (() => void) | null = null
let listenerCount = 0

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
    listenerCount += 1
    if (!sharedUnsubscribe) {
      sharedUnsubscribe = subscribeAuthState((user) => {
        // 익명 사용자(lib/appAuth.ts가 앱 시작 시 확보하는 기기 인증)는 관리자 후보가 아니다.
        // 이걸 걸러내지 않으면 관리자가 로그인하기도 전에 admins 문서를 찾다 실패해서
        // "관리자 권한이 없습니다" 오류가 먼저 뜬다 — 로그인 화면을 그대로 보여줘야 한다.
        if (!user || user.isAnonymous) {
          set({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
          return
        }
        resolveAdmin(user, set)
      })
    }
    // 마지막으로 남은 호출자가 정리할 때만 실제 구독을 해제한다 — 다른 화면이 아직 쓰고 있는데
    // 먼저 언마운트된 화면이 구독을 끊어버리면 안 된다.
    return () => {
      listenerCount = Math.max(0, listenerCount - 1)
      if (listenerCount === 0 && sharedUnsubscribe) {
        sharedUnsubscribe()
        sharedUnsubscribe = null
      }
    }
  },
}))
