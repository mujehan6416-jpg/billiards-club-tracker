import { getAuth, signInWithEmailAndPassword, signOut as firebaseSignOut, onAuthStateChanged } from 'firebase/auth'
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
