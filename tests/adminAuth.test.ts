import { describe, it, expect, vi, beforeEach } from 'vitest'

// firebase/auth, firebase/firestore, firebase.ts를 전부 모킹해 실제 네트워크 호출 없이 로직만 검증한다.
vi.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
}))

const getDocMock = vi.fn()
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: (...args: unknown[]) => getDocMock(...args),
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { fetchAdminDoc } from '../src/lib/adminAuth'

beforeEach(() => {
  getDocMock.mockReset()
})

describe('fetchAdminDoc', () => {
  it('문서가 없으면 null', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    expect(await fetchAdminDoc('uid-1')).toBeNull()
  })

  it('active !== true면 null', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ active: false, displayName: '가상관리자' }) })
    expect(await fetchAdminDoc('uid-1')).toBeNull()
  })

  it('active === true면 문서를 반환', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ active: true, displayName: '가상관리자' }) })
    const result = await fetchAdminDoc('uid-1')
    expect(result).toEqual({ active: true, displayName: '가상관리자' })
  })

  it('permission-denied 오류는 null로 취급(관리자 아님과 동일하게)', async () => {
    getDocMock.mockRejectedValue({ code: 'permission-denied' })
    expect(await fetchAdminDoc('uid-1')).toBeNull()
  })

  it('permission-denied가 아닌 오류는 그대로 던진다', async () => {
    getDocMock.mockRejectedValue({ code: 'unavailable' })
    await expect(fetchAdminDoc('uid-1')).rejects.toBeTruthy()
  })
})
