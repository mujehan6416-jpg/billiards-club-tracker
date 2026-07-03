import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { AppState } from '../types'

const DOC_REF = doc(db, 'clubs', 'skkubc')

// 이 기기가 마지막으로 클라우드와 일치했던 시점(클라우드 문서의 updatedAt 값).
// 공유 데이터가 아닌 기기별 정보라 AppState가 아닌 별도 localStorage 키에 둔다.
const LAST_SYNC_KEY = 'billiards-last-sync-at'

export const getLastSyncedAt = (): string | null => localStorage.getItem(LAST_SYNC_KEY)

export function markSynced(updatedAt: string | null): void {
  if (updatedAt) localStorage.setItem(LAST_SYNC_KEY, updatedAt)
}

/** 다른 기기의 최신 클라우드 데이터를 덮어쓰지 않으려고 사용자가 업로드를 취소함 */
export class UploadCancelledError extends Error {
  constructor() {
    super('클라우드에 더 최신 데이터가 있어 업로드를 취소했습니다.')
    this.name = 'UploadCancelledError'
  }
}

export async function uploadToCloud(state: AppState): Promise<void> {
  // 마지막 동기화 이후 다른 기기가 업로드했으면 덮어쓰기 전에 확인
  let cloudUpdatedAt: string | null = null
  try {
    const snap = await getDoc(DOC_REF)
    cloudUpdatedAt = snap.exists() ? ((snap.data().updatedAt as string | undefined) ?? null) : null
  } catch {
    // 조회 실패(오프라인 등) 시 확인을 생략하고 업로드 시도 — setDoc도 실패하면 호출부에서 처리
  }
  if (cloudUpdatedAt && cloudUpdatedAt !== getLastSyncedAt()) {
    const ok = window.confirm(
      '다른 기기에서 저장한 더 최신 클라우드 데이터가 있을 수 있습니다.\n지금 업로드하면 클라우드 데이터를 이 기기의 데이터로 덮어씁니다.\n계속할까요?',
    )
    if (!ok) throw new UploadCancelledError()
  }
  const updatedAt = new Date().toISOString()
  await setDoc(DOC_REF, {
    data: JSON.stringify(state),
    updatedAt,
  })
  markSynced(updatedAt)
}

export interface CloudSnapshot {
  state: AppState
  updatedAt: string | null
}

export async function downloadFromCloud(): Promise<CloudSnapshot | null> {
  const snap = await getDoc(DOC_REF)
  if (!snap.exists()) return null
  const raw = snap.data()
  return {
    state: JSON.parse(raw.data) as AppState,
    updatedAt: (raw.updatedAt as string | undefined) ?? null,
  }
}
