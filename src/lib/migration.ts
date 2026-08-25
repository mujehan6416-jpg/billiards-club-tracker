import type { AppState } from '../types'
import type { SplitFirestoreData, SplitValidation } from '../types/splitFirestore'
import { splitLegacyAppState, validateSplit } from '../logic/splitAppState'
import { writeAllSplitData, DEFAULT_CLUB_ID } from './splitFirestore'

/**
 * 기존 AppState를 새 Firestore 구조로 옮기는 작업.
 *
 * 안전장치:
 *  1. prepareMigration()은 계획만 세운다 — Firestore에 아무것도 쓰지 않는다.
 *  2. executeMigration()은 기본값이 dryRun: true라, 그냥 부르면 쓰지 않는다.
 *  3. 실제로 쓰려면 dryRun: false와 확인 문구를 둘 다 넘겨야 한다.
 *  4. 검증(validateSplit)을 통과하지 못하면 실제 쓰기를 거부한다.
 *  5. 앱 어디에서도 자동으로 부르지 않는다(앱 시작·로그인·일반회원 화면 모두).
 */

/** 실제 쓰기를 하려면 이 문구를 그대로 넘겨야 한다 — 실수로 운영 데이터를 만드는 것을 막는다. */
export const MIGRATION_CONFIRM_PHRASE = '실제로 옮깁니다'

export interface MigrationPlan {
  split: SplitFirestoreData
  validation: SplitValidation
  /** 새 구조에 만들어질 문서 수 (경로별). */
  documentCounts: {
    config: number
    members: number
    memberPrivate: number
    sessions: number
    games: number
    ledger: number
    total: number
  }
}

/**
 * 계획 세우기 — 순수 계산만 한다. Firestore를 읽지도 쓰지도 않는다.
 * 결과의 validation.ok가 false면 실제 이전을 진행해서는 안 된다.
 */
export function prepareMigration(state: AppState): MigrationPlan {
  const split = splitLegacyAppState(state)
  const validation = validateSplit(state, split)

  const documentCounts = {
    config: 1,
    members: split.members.length,
    memberPrivate: split.memberPrivate.length,
    sessions: split.sessions.length,
    games: split.games.length,
    ledger: split.ledger.length,
    total: 0,
  }
  documentCounts.total =
    documentCounts.config + documentCounts.members + documentCounts.memberPrivate +
    documentCounts.sessions + documentCounts.games + documentCounts.ledger

  return { split, validation, documentCounts }
}

export interface MigrationResult {
  /** 실제로 썼는지. dryRun이면 항상 false. */
  written: boolean
  /** 쓴(또는 dryRun에서 쓸 예정인) 문서 수. */
  documentCount: number
  validation: SplitValidation
  /** 쓰지 않은 이유(있다면). */
  skippedReason?: string
}

/**
 * 실제 이전 실행.
 *
 * 기본값이 dryRun: true다 — 인자 없이 부르면 계산만 하고 Firestore에는 손대지 않는다.
 * 실제로 쓰려면 dryRun: false와 confirmPhrase를 모두 정확히 넘겨야 한다.
 */
export async function executeMigration(
  state: AppState,
  options: { dryRun?: boolean; confirmPhrase?: string; clubId?: string } = {},
): Promise<MigrationResult> {
  const { dryRun = true, confirmPhrase, clubId = DEFAULT_CLUB_ID } = options
  const plan = prepareMigration(state)

  if (!plan.validation.ok) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '검증을 통과하지 못했습니다. 문제를 해결한 뒤 다시 시도해 주세요.',
    }
  }

  if (dryRun) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '미리보기(dry-run)라 실제로 저장하지 않았습니다.',
    }
  }

  if (confirmPhrase !== MIGRATION_CONFIRM_PHRASE) {
    return {
      written: false,
      documentCount: plan.documentCounts.total,
      validation: plan.validation,
      skippedReason: '확인 문구가 맞지 않아 저장하지 않았습니다.',
    }
  }

  const count = await writeAllSplitData(plan.split, clubId)
  return { written: true, documentCount: count, validation: plan.validation }
}
