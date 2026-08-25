import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import './firebase'

/**
 * 앱 전체(일반 사용자 포함)의 Firebase 인증 확보용.
 *
 * 목적은 화면 기능이 아니라 "이 기기가 서버에 인증된 상태"를 만드는 것이다. 지금은 Firestore
 * 규칙이 아직 공개(if true)라 이 인증이 없어도 데이터가 읽히지만, 다음 단계에서 규칙을
 * `request.auth != null`로 잠그려면 모든 기기가 먼저 인증돼 있어야 한다.
 *
 * 익명 사용자의 UID는 화면에 표시하지 않고 Member.id로도 절대 쓰지 않는다 — 회원 식별은
 * 기존대로 Member.id로만 한다(서로 다른 개념).
 *
 * 관리자(정산) 인증은 lib/adminAuth.ts가 같은 Firebase Auth 인스턴스에서 이메일/비밀번호로
 * 로그인한다. 관리자가 로그인하면 익명 사용자가 관리자 사용자로 교체되고, 관리자가 로그아웃하면
 * 사용자가 사라지므로 keepAppAuthAlive()가 다시 익명 인증을 확보한다.
 */
const auth = getAuth()

/**
 * 앱을 새로 열면 Firebase가 저장된 로그인 상태를 복원할 때까지 잠깐 시간이 걸려
 * auth.currentUser가 아직 null이다. 그 순간 바로 익명 로그인을 하면 새로고침할 때마다
 * 익명 계정이 새로 생기므로, 최초 상태가 정해질 때까지 한 번만 기다린다.
 */
function waitForInitialUser(): Promise<User | null> {
  return new Promise((resolve, reject) => {
    // onAuthStateChanged는 상태를 이미 알고 있으면 콜백을 "그 자리에서" 부를 수 있다.
    // 그때는 아직 구독 해제 함수를 받기 전이므로, 해제를 두 갈래로 나눠 처리한다.
    let unsubscribe: (() => void) | null = null
    let done = false

    const settle = (finish: () => void) => {
      if (done) return
      done = true
      unsubscribe?.() // 나중에 도착한 경우 — 해제 함수가 이미 있다
      finish()
    }

    unsubscribe = onAuthStateChanged(
      auth,
      (user) => settle(() => resolve(user)),
      (error) => settle(() => reject(error)),
    )
    if (done) unsubscribe() // 그 자리에서 도착한 경우 — 지금 해제한다
  })
}

/**
 * 서버와 통신하기 전에 호출한다. 이미 인증된 사용자가 있으면(익명이든 관리자든) 그 세션을
 * 그대로 재사용하고, 없을 때만 익명 로그인을 한다.
 * 실패하면 예외를 던진다 — 호출부는 이때 서버 데이터를 내려받지 않아야 한다.
 */
export async function ensureAppAuth(): Promise<void> {
  const existing = await waitForInitialUser()
  if (existing) return
  await signInAnonymously(auth)
}

/**
 * 지금 이 기기의 Firebase UID. 인증 전이면 null.
 * 회원-기기 연결(memberLinks)에서 "이 기기"를 가리키는 값으로만 쓰고,
 * 화면에 표시하거나 Member.id 대신 쓰지 않는다.
 */
export function currentAuthUid(): string | null {
  return auth.currentUser?.uid ?? null
}

/**
 * 관리자가 정산 화면에서 로그아웃하면 Firebase 사용자가 아예 없어져, 그 뒤로는 일반 데이터
 * 동기화까지 인증 없는 상태가 된다(다음 단계에서 규칙을 잠그면 앱이 멈춘다).
 * 그래서 사용자가 사라지면 익명 인증을 다시 확보한다.
 *
 * 반환값은 구독 해제 함수다. 익명 로그인이 실패해도 사용자 상태는 계속 null이라 이벤트가
 * 다시 발생하지 않으므로 무한 재시도로 이어지지 않는다.
 */
export function keepAppAuthAlive(): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) void signInAnonymously(auth).catch(() => {})
  })
}
