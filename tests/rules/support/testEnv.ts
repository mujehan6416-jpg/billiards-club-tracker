import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

/**
 * Firestore Rules 자동 테스트 전용 가상 프로젝트 ID·가상 UID.
 * 실제 운영 Firebase 프로젝트, 실제 회원 정보, 실제 Firebase UID와 절대 무관하다.
 */
export const RULES_TEST_PROJECT_ID = 'billiards-rules-test'
export const RULES_TEST_EMULATOR_HOST = '127.0.0.1'
export const RULES_TEST_EMULATOR_PORT = 8089

export const MEMBER_TEST_ID = 'member-test-001'
export const UID_MEMBER_A = 'uid-member-a'
export const UID_MEMBER_B = 'uid-member-b'
export const UID_ADMIN_ACTIVE = 'uid-admin-active'
export const UID_ADMIN_DISABLED = 'uid-admin-disabled'

// ── split Firestore 구조(보안 4단계) 테스트 전용 가상 값 ────────────────
export const SPLIT_CLUB_ID = 'skkubc'
export const CLUB_A = 'club-a'
export const CLUB_B = 'club-b'
export const MEMBER_ID_1 = 'member-001'
export const MEMBER_ID_2 = 'member-002'
export const UID_UNLINKED = 'uid-unlinked'
export const UID_MEMBER_ACTIVE = 'uid-member-active'
export const UID_MEMBER_INACTIVE = 'uid-member-inactive'

/**
 * Firestore Emulator 연결을 시도하고, 실패하면 null을 돌려준다.
 * 로컬에 emulator가 떠 있지 않을 때(예: Java 버전 문제) 이 파일의 Rules 테스트 전체를
 * 억지로 실패시키지 않고 건너뛰기 위한 용도다. `npm run test:rules`는 emulator를
 * 먼저 띄운 뒤 이 함수를 호출하므로 실제로 연결된다.
 */
export async function createRulesTestEnv(): Promise<RulesTestEnvironment | null> {
  try {
    const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')
    return await initializeTestEnvironment({
      projectId: RULES_TEST_PROJECT_ID,
      firestore: {
        rules,
        host: RULES_TEST_EMULATOR_HOST,
        port: RULES_TEST_EMULATOR_PORT,
      },
    })
  } catch (err) {
    console.warn(
      `[rules-test] Firestore Emulator(${RULES_TEST_EMULATOR_HOST}:${RULES_TEST_EMULATOR_PORT})에 연결할 수 없어 ` +
        `이 파일의 Rules 테스트를 건너뜁니다. 로컬 Java 환경 등으로 emulator가 실행되지 않았을 수 있습니다. ` +
        `(npm run test:rules로 실행하면 emulator가 자동으로 뜬다) 원인: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/** admins/{uid} 문서를 Rules 우회로 직접 심는다 (테스트 fixture 전용, withSecurityRulesDisabled 사용). */
export async function seedAdmin(testEnv: RulesTestEnvironment, uid: string, active: boolean): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`admins/${uid}`).set({ active })
  })
}

/** clubs/{clubId}/memberLinks/{uid} 문서를 Rules 우회로 직접 심는다 (테스트 fixture 전용). */
export async function seedMemberLink(
  testEnv: RulesTestEnvironment,
  clubId: string,
  uid: string,
  memberId: string,
  active: boolean,
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context
      .firestore()
      .doc(`clubs/${clubId}/memberLinks/${uid}`)
      .set({ memberId, role: 'member', active, linkedAt: '2026-08-26T00:00:00+09:00' })
  })
}
