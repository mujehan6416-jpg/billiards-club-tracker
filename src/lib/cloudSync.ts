import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { AppState } from '../types'

const DOC_REF = doc(db, 'clubs', 'skkubc')

export async function uploadToCloud(state: AppState): Promise<void> {
  await setDoc(DOC_REF, {
    data: JSON.stringify(state),
    updatedAt: new Date().toISOString(),
  })
}

export async function downloadFromCloud(): Promise<AppState | null> {
  const snap = await getDoc(DOC_REF)
  if (!snap.exists()) return null
  const raw = snap.data()
  return JSON.parse(raw.data) as AppState
}
