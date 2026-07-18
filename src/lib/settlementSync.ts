import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import type { RegularSettlement } from '../types/settlement'

// 정산 전용 Firestore 동기화. 기존 cloudSync.ts(clubs/skkubc AppState 전체 문서)와 완전히 분리되어
// 있고, 이 파일은 clubs/skkubc 문서 자체를 읽거나 쓰지 않는다 — 정산 1건 = Firestore 문서 1개
// (clubs/skkubc/settlements/{settlementId})만 다룬다.
//
// 시각 방식: serverTimestamp() 대신 기존 코드 전체와 동일하게 클라이언트 ISO 문자열을 쓴다
// (RegularSettlement의 createdAt/updatedAt/confirmedAt 등은 이미 string 타입으로 설계돼 있고,
// cloudSync.ts도 같은 방식이라 일관성을 유지했다). 트레이드오프: 기기 시계가 어긋나면 이력 순서가
// 실제와 다르게 보일 수 있다 — 이번 1인 관리자 운영 규모에서는 영향이 작다고 판단했다(2차 개선 후보).
//
// 낙관적 동시성(버전 소유권 모델): settlement.version은 "이 화면이 마지막으로 서버와 일치한다고
// 확인한 기준 버전"을 뜻한다. 로컬 편집 함수(참가자/지출/찬조/회식비 등)와 상태 전이 함수는
// version을 절대 건드리지 않는다 — version은 오직 이 saveSettlement()가 실제로 Firestore 저장에
// 성공했을 때만 "서버 문서가 새로 갖게 된 버전"으로 바뀐다(호출부인 settlementStore가 반영).
//   - 서버에 문서가 없으면(신규): 새 버전은 1.
//   - 서버에 문서가 있으면(수정): 서버 version === settlement.version(내가 마지막으로 확인한 버전)일
//     때만 저장을 허용하고, 새 버전은 서버 version + 1. 다르면 다른 곳에서 이미 저장한 것이므로 conflict.
// 이 함수는 저장에 성공하면 새 버전(number)을 반환한다 — 호출부가 이 값으로 로컬 version을 갱신해야 한다.
//
// 이 검사와 "동일 sessionId 중복 방지" 검사는 각각 별도의 getDoc/getDocs 호출로 이뤄지는 순차
// 읽기-확인-쓰기이며, Firestore 트랜잭션으로 묶지 않았다(트랜잭션 안에서는 where 쿼리를 쓸 수 없어
// 중복 검사를 트랜잭션화할 수 없음). 따라서 두 관리자가 정확히 같은 순간에 동시 저장하는 극단적
// 경우엔 이론상 경합이 남는다 — 1인 관리자 중심 운영 규모에서는 위험이 낮다고 판단해 이번 단계에서는
// 단순하게 구현했다(2차: 완전한 트랜잭션화 검토).

const settlementsCol = () => collection(db, 'clubs', 'skkubc', 'settlements')
const settlementDoc = (id: string) => doc(db, 'clubs', 'skkubc', 'settlements', id)

export type SettlementSyncErrorCode = 'not-found' | 'conflict' | 'duplicate-session' | 'permission-denied' | 'unknown'

export class SettlementSyncError extends Error {
  code: SettlementSyncErrorCode
  constructor(code: SettlementSyncErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'SettlementSyncError'
  }
}

/**
 * Firestore는 값이 명시적으로 undefined인 필드를 거부한다(setDoc이 실패함).
 * RegularSettlement의 createdByUid/confirmedByUid 등 optional 필드는 값이 없을 때 로컬에서
 * `undefined`로 남아있을 수 있으므로, 저장 직전에 undefined 필드만 재귀적으로 제거한다.
 * null/0/false/빈 문자열은 의도된 값이므로 그대로 둔다. 타입 변환은 하지 않는다(Date 등은 없음).
 */
export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      result[key] = stripUndefinedDeep(v)
    }
    return result as T
  }
  return value
}

function toSyncError(e: unknown): SettlementSyncError {
  if (e instanceof SettlementSyncError) return e
  const code = (e as { code?: string })?.code
  if (code === 'permission-denied') {
    return new SettlementSyncError('permission-denied', '권한이 없습니다. 관리자 로그인 상태를 확인해주세요.')
  }
  return new SettlementSyncError('unknown', e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.')
}

export async function listSettlements(): Promise<RegularSettlement[]> {
  try {
    const snap = await getDocs(settlementsCol())
    return snap.docs.map((d) => d.data() as RegularSettlement)
  } catch (e) {
    throw toSyncError(e)
  }
}

export async function getSettlement(id: string): Promise<RegularSettlement | null> {
  try {
    const snap = await getDoc(settlementDoc(id))
    return snap.exists() ? (snap.data() as RegularSettlement) : null
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 같은 sessionId로 이미 만들어진 정산이 있는지 확인한다(신규 생성 시에만 호출). */
export async function findSettlementBySessionId(sessionId: string): Promise<RegularSettlement | null> {
  try {
    const snap = await getDocs(query(settlementsCol(), where('sessionId', '==', sessionId)))
    return snap.empty ? null : (snap.docs[0].data() as RegularSettlement)
  } catch (e) {
    throw toSyncError(e)
  }
}

/**
 * 정산 1건을 저장한다(신규 생성·수정 공통). 성공하면 서버에 실제로 기록된 새 버전을 반환한다.
 * - 신규 생성(서버에 문서 없음): 같은 sessionId 정산이 이미 있으면 duplicate-session 오류. 새 버전은 1.
 * - 기존 수정: 서버 version !== settlement.version(내 화면이 마지막으로 확인한 버전)이면 conflict 오류.
 *   일치하면 새 버전은 서버 version + 1.
 */
export async function saveSettlement(settlement: RegularSettlement): Promise<number> {
  try {
    const ref = settlementDoc(settlement.id)
    const existing = await getDoc(ref)

    let newVersion: number
    if (!existing.exists()) {
      if (settlement.sessionId) {
        const dup = await findSettlementBySessionId(settlement.sessionId)
        if (dup && dup.id !== settlement.id) {
          throw new SettlementSyncError('duplicate-session', '이 모임에 대한 정산이 이미 존재합니다. 기존 정산을 열어 수정해주세요.')
        }
      }
      newVersion = 1
    } else {
      const serverVersion = (existing.data() as RegularSettlement).version
      if (serverVersion !== settlement.version) {
        throw new SettlementSyncError(
          'conflict',
          `다른 곳에서 이미 이 정산을 수정했습니다(서버 버전 ${serverVersion}, 내 화면 기준 버전 ${settlement.version}). 다시 불러온 뒤 수정해주세요.`,
        )
      }
      newVersion = serverVersion + 1
    }

    const payload = stripUndefinedDeep({ ...settlement, version: newVersion })
    await setDoc(ref, payload)
    return newVersion
  } catch (e) {
    throw toSyncError(e)
  }
}

/** 정산 문서 1건을 Firestore에서 완전히 삭제한다(하위 컬렉션 없음 — 문서 삭제만으로 완결). */
export async function deleteSettlement(id: string): Promise<void> {
  try {
    await deleteDoc(settlementDoc(id))
  } catch (e) {
    throw toSyncError(e)
  }
}
