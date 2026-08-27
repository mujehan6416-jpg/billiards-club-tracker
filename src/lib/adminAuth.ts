import {
  getAuth, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged,
  reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth'
import type { User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'

// 관리자 전용 Firebase Authentication 래퍼.
// 일반 회원 로그인(LoginScreen.tsx / authStore.ts)과 완전히 별개이며, 이 파일은
// 일반 회원 로그인 흐름을 전혀 참조하지 않는다. firebase.ts는 기본 앱(default app)만
// initializeApp()하므로, getAuth()를 인자 없이 호출하면 같은 앱의 auth 인스턴스를 그대로 쓴다.
const auth = getAuth()

export interface AdminDoc {
  active: boolean
  displayName?: string
}

export async function adminSignIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  return cred.user
}

export async function adminSignOut(): Promise<void> {
  await firebaseSignOut(auth)
}

/** Firebase Auth 로그인 상태 변화를 구독한다. 반환값은 구독 해제 함수. */
export function subscribeAuthState(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb)
}

/**
 * admins/{uid} 문서를 읽어 관리자 여부를 확인한다.
 * 문서가 없거나 active !== true면 null (=관리자 아님).
 * Firestore 규칙상 관리자가 아닌 사용자는 이 문서 읽기 자체가 거부(permission-denied)될 수 있는데,
 * 그 경우도 "관리자 아님"과 동일하게 null로 취급한다.
 */
export async function fetchAdminDoc(uid: string): Promise<AdminDoc | null> {
  try {
    const snap = await getDoc(doc(db, 'admins', uid))
    if (!snap.exists()) return null
    const data = snap.data() as AdminDoc
    if (data.active !== true) return null
    return data
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'permission-denied') return null
    throw e
  }
}

export function getCurrentUser(): User | null {
  return auth.currentUser
}

/** 재인증 실패 사유 — 화면에 보여줄 문구를 호출부가 고르기 쉽게 코드로 구분한다. */
export type ReauthErrorCode = 'no-session' | 'wrong-password' | 'too-many-attempts' | 'unknown'

export class ReauthError extends Error {
  code: ReauthErrorCode
  constructor(code: ReauthErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ReauthError'
  }
}

/**
 * 지금 로그인돼 있는 Firebase 관리자 계정의 비밀번호를 다시 확인한다(re-authentication).
 *
 * 되돌릴 수 없는 삭제 직전에만 쓴다. 기기 localStorage의 관리자 PIN은 서버가 신뢰할 수 없는
 * 값이라 이런 확인의 근거로 쓸 수 없다 — 반드시 Firebase 계정 비밀번호로 확인한다.
 *
 * 확인 대상은 "지금 로그인한 그 계정"뿐이다: auth.currentUser의 이메일로만 자격 증명을 만들기
 * 때문에 다른 관리자 계정의 비밀번호로는 통과할 수 없다. 비밀번호는 이 함수 밖으로 나가지 않고
 * 저장하지도 않으며, 실패하면 예외를 던져 호출부가 어떤 삭제도 시작하지 않게 한다.
 */
export async function reauthenticateAdmin(password: string): Promise<void> {
  const user = auth.currentUser
  if (!user || !user.email || user.isAnonymous) {
    throw new ReauthError('no-session', '관리자 로그인이 확인되지 않습니다. 다시 로그인해 주세요.')
  }
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new ReauthError('wrong-password', '비밀번호가 올바르지 않습니다.')
    }
    if (code === 'auth/too-many-requests') {
      throw new ReauthError('too-many-attempts', '시도가 너무 많았습니다. 잠시 후 다시 시도해 주세요.')
    }
    throw new ReauthError('unknown', '확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
  }
}
