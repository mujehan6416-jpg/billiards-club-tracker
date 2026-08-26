import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * 신규 기기(iPad) 연결 승인 흐름을 실제 사용자 경로 그대로 재현한다.
 *
 *   앱 부팅(연결 안 됨) → 이름 선택 → 연결 요청 → 관리자 승인(다른 기기에서)
 *   → "승인됐는지 다시 확인" → split 데이터 읽기 → 그 회원으로 앱 진입
 *
 * 추측을 줄이려고 Firestore를 낮은 수준에서 흉내 내되, 권한 판정은 실제 firestore.rules와
 * 같은 규칙으로 흉내 낸다(연결된 활성 회원만 members/sessions/ledger/config를 읽을 수 있고,
 * memberIndex는 로그인만 했으면 읽을 수 있다). 그래서 memberLink.ts·splitFirestore.ts·
 * App.tsx의 실제 코드가 그대로 실행된다 — 이 세 파일은 모킹하지 않는다.
 */

const CLUB = 'skkubc'

// ── 가짜 Firebase Auth ────────────────────────────────────────────────
const authState = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; isAnonymous: boolean; email: string | null },
  listeners: [] as Array<(u: unknown) => void>,
  anonCounter: 0,
  /** 다음 익명 로그인에서 강제로 새 UID를 만들지 — 저장소가 비워진 상황(UID 교체) 재현용. */
  forceNewAnonUid: false,
}))

vi.mock('firebase/auth', () => ({
  getAuth: () => authState,
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => {
    authState.listeners.push(cb)
    cb(authState.currentUser) // 실제 Firebase처럼 구독 즉시 현재 상태를 한 번 알려준다
    return () => {
      const i = authState.listeners.indexOf(cb)
      if (i >= 0) authState.listeners.splice(i, 1)
    }
  },
  signInAnonymously: async () => {
    if (authState.currentUser?.isAnonymous && !authState.forceNewAnonUid) {
      return { user: authState.currentUser }
    }
    authState.forceNewAnonUid = false
    authState.anonCounter += 1
    authState.currentUser = { uid: `anon-uid-${authState.anonCounter}`, isAnonymous: true, email: null }
    authState.listeners.forEach((cb) => cb(authState.currentUser))
    return { user: authState.currentUser }
  },
  signInWithEmailAndPassword: vi.fn(),
  signOut: async () => {
    authState.currentUser = null
    authState.listeners.forEach((cb) => cb(null))
  },
}))

// ── 가짜 Firestore (실제 Rules와 같은 권한 판정 포함) ──────────────────
const store = vi.hoisted(() => ({ docs: new Map<string, Record<string, unknown>>() }))

const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })

/** firestore.rules의 hasActiveMemberLink(clubId)와 같은 판정. */
function hasActiveMemberLink(): boolean {
  const uid = authState.currentUser?.uid
  if (!uid) return false
  const link = store.docs.get(`clubs/${CLUB}/memberLinks/${uid}`)
  return link?.active === true
}

/** 이 경로를 지금 사용자가 읽을 수 있는지 — firestore.rules와 같은 기준. */
function canRead(path: string): boolean {
  const uid = authState.currentUser?.uid
  if (!uid) return false
  // memberIndex: 로그인만 했으면 누구나(연결 여부 무관) — 이름 찾기 전용 최소 목록
  if (path.startsWith(`clubs/${CLUB}/memberIndex`)) return true
  // 본인 연결 문서·본인 요청 문서는 본인이 읽을 수 있다
  if (path === `clubs/${CLUB}/memberLinks/${uid}`) return true
  if (path === `clubs/${CLUB}/linkRequests/${uid}`) return true
  // 나머지 split 데이터는 연결된 활성 회원만
  if (
    path.startsWith(`clubs/${CLUB}/members`) || path.startsWith(`clubs/${CLUB}/sessions`) ||
    path.startsWith(`clubs/${CLUB}/ledger`) || path.startsWith(`clubs/${CLUB}/config`)
  ) return hasActiveMemberLink()
  return false
}

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  doc: (_db: unknown, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: async (ref: { __path: string }) => {
    if (!canRead(ref.__path)) throw denied()
    const data = store.docs.get(ref.__path)
    return { exists: () => data !== undefined, data: () => data }
  },
  getDocs: async (ref: { __path: string }) => {
    if (!canRead(ref.__path)) throw denied()
    const prefix = `${ref.__path}/`
    const docs = [...store.docs.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map(([p, data]) => ({ id: p.slice(prefix.length), data: () => data }))
    return { docs }
  },
  setDoc: async (ref: { __path: string }, data: Record<string, unknown>) => {
    store.docs.set(ref.__path, data)
  },
  deleteDoc: async (ref: { __path: string }) => { store.docs.delete(ref.__path) },
  updateDoc: async (ref: { __path: string }, patch: Record<string, unknown>) => {
    store.docs.set(ref.__path, { ...(store.docs.get(ref.__path) ?? {}), ...patch })
  },
  writeBatch: () => {
    const ops: Array<() => void> = []
    return {
      set: (ref: { __path: string }, data: Record<string, unknown>) => ops.push(() => store.docs.set(ref.__path, data)),
      delete: (ref: { __path: string }) => ops.push(() => store.docs.delete(ref.__path)),
      commit: async () => { ops.forEach((op) => op()) },
    }
  },
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

// 화면 렌더링에 딸려오는(이 재현과 무관한) 무거운 모듈만 가볍게 막아 둔다.
vi.mock('../src/lib/backup', () => ({
  exportCsv: vi.fn(), exportHandicapCsv: vi.fn(), exportJson: vi.fn(), exportMemberCsv: vi.fn(),
  importHandicapCsv: vi.fn(), importJson: vi.fn(), importMemberCsv: vi.fn(), importGameCsv: vi.fn(),
}))
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: vi.fn(), downloadFromCloud: vi.fn().mockResolvedValue(null), markSynced: vi.fn(),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/autoSave', () => ({ saveToServer: vi.fn().mockResolvedValue(null) }))

import { App } from '../src/App'
import { useApp } from '../src/store/appStore'
import { useAuth } from '../src/store/authStore'
import { useAdmin } from '../src/store/adminStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { approveLinkRequest } from '../src/lib/memberLink'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const MEMBER_ID = 'm-ipad'
const MEMBER_NAME = '테스트회원A'
const members: Member[] = [
  { id: MEMBER_ID, name: MEMBER_NAME, handicap: 20, handicapHistory: [], active: true },
  { id: 'm-other', name: '테스트회원B', handicap: 25, handicapHistory: [], active: true },
]

/** 운영 서버에 이미 있는 split 데이터(회원·이름찾기목록·설정)를 심는다. */
function seedServer() {
  store.docs.set(`clubs/${CLUB}/config/main`, { lastBackupAt: null })
  for (const m of members) {
    store.docs.set(`clubs/${CLUB}/members/${m.id}`, {
      id: m.id, name: m.name, handicap: m.handicap, handicapHistory: [], active: m.active,
    })
    store.docs.set(`clubs/${CLUB}/memberIndex/${m.id}`, { id: m.id, name: m.name, active: m.active })
  }
}

/** 관리자(갤럭시)가 다른 기기에서 승인하는 상황 — 실제 approveLinkRequest를 그대로 쓴다. */
async function adminApproves(requestUid: string, memberId: string) {
  const before = authState.currentUser
  authState.currentUser = { uid: 'admin-uid', isAnonymous: false, email: 'a@example.test' }
  await approveLinkRequest(requestUid, memberId, 'admin-uid')
  authState.currentUser = before // iPad 쪽 세션으로 되돌린다
}

beforeEach(() => {
  store.docs.clear()
  authState.currentUser = null
  authState.listeners = []
  authState.anonCounter = 0
  authState.forceNewAnonUid = false
  seedServer()

  useApp.setState({ members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: null, memberName: null, isGuest: false })
  useAdmin.setState({ isAdmin: false })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
})

/** 신규 기기가 이름을 골라 연결을 요청하는 데까지 진행한다. 요청에 쓰인 UID를 돌려준다. */
async function requestConnectionAsNewDevice() {
  render(<App />)
  await waitFor(() => expect(screen.getByText('처음 사용하는 기기입니다', { exact: false })).toBeInTheDocument())
  await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())

  fireEvent.change(screen.getByRole('combobox'), { target: { value: MEMBER_ID } })
  fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 요청' }))
  await waitFor(() => expect(screen.getByText(/연결을 요청했습니다/)).toBeInTheDocument())

  const uid = authState.currentUser!.uid
  expect(store.docs.get(`clubs/${CLUB}/linkRequests/${uid}`)).toMatchObject({ memberId: MEMBER_ID })
  return uid
}

describe('신규 기기 연결 승인 — 실제 사용자 경로 재현', () => {
  it('승인 후 "승인됐는지 다시 확인"을 누르면 그 회원으로 앱에 진입한다', async () => {
    const uid = await requestConnectionAsNewDevice()

    // 관리자(갤럭시)가 승인 — memberLinks 생성 + linkRequests 삭제
    await adminApproves(uid, MEMBER_ID)
    expect(store.docs.get(`clubs/${CLUB}/memberLinks/${uid}`)).toMatchObject({ memberId: MEMBER_ID, active: true })
    expect(store.docs.has(`clubs/${CLUB}/linkRequests/${uid}`)).toBe(false)

    // iPad에서 "승인됐는지 다시 확인"
    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    // 승인 감지 → split 데이터 읽기 → 그 회원으로 자동 진입
    await waitFor(() => expect(screen.getByText(`👤 ${MEMBER_NAME} 님`)).toBeInTheDocument())
    expect(useAuth.getState().memberId).toBe(MEMBER_ID)
    expect(screen.queryByText('처음 사용하는 기기입니다', { exact: false })).not.toBeInTheDocument()
  })

  it('승인 전에 눌렀을 때는 아직 승인되지 않았다고 화면에 분명히 알려준다', async () => {
    await requestConnectionAsNewDevice()

    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    // 예전에는 같은 화면이 다시 그려질 뿐이라 눌러도 아무 반응이 없는 것처럼 보였다.
    await waitFor(() => expect(screen.getByText(/아직 이 기기는 승인되지 않았습니다/)).toBeInTheDocument())
    expect(screen.getByText(/연결을 요청했습니다/)).toBeInTheDocument()
    expect(useAuth.getState().memberId).toBeNull()
  })

  it('연결이 비활성(active:false)이면 진입하지 않는다', async () => {
    const uid = await requestConnectionAsNewDevice()
    await adminApproves(uid, MEMBER_ID)
    // 관리자가 곧바로 연결을 해제한 상황
    store.docs.set(`clubs/${CLUB}/memberLinks/${uid}`, {
      ...(store.docs.get(`clubs/${CLUB}/memberLinks/${uid}`) as Record<string, unknown>), active: false,
    })

    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    await waitFor(() => expect(screen.getByText('처음 사용하는 기기입니다', { exact: false })).toBeInTheDocument())
    expect(useAuth.getState().memberId).toBeNull()
  })
})

describe('신규 기기 연결 승인 — 기기 UID가 바뀐 경우', () => {
  it('승인이 다른 기기 요청에 적용된 상태면 그 사실과 대처 방법을 안내한다', async () => {
    // 실제 신고 상황: 관리자는 분명히 승인했는데 iPad는 계속 "승인됐는지 다시 확인" 화면.
    // 승인이 이 기기가 아닌 다른 기기(예전 UID)의 요청 앞으로 처리된 경우다.
    const otherDeviceUid = 'anon-uid-other-device'
    store.docs.set(`clubs/${CLUB}/linkRequests/${otherDeviceUid}`, {
      memberId: MEMBER_ID, requestedAt: '2026-08-26T00:00:00.000Z',
    })
    const thisUid = await requestConnectionAsNewDevice()
    await adminApproves(otherDeviceUid, MEMBER_ID) // 관리자가 "다른 기기" 요청을 승인

    // 이 기기의 요청은 그대로 남아 있고, 이 기기 앞으로는 연결이 없다
    expect(store.docs.has(`clubs/${CLUB}/linkRequests/${thisUid}`)).toBe(true)
    expect(store.docs.has(`clubs/${CLUB}/memberLinks/${thisUid}`)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    await waitFor(() => expect(screen.getByText(/아직 이 기기는 승인되지 않았습니다/)).toBeInTheDocument())
    expect(screen.getByText(/다른 기기의 요청/)).toBeInTheDocument()
    // 대처 방법(요청 취소 후 다시 요청)까지 화면에서 바로 실행할 수 있어야 한다
    expect(screen.getByRole('button', { name: '요청 취소' })).toBeInTheDocument()
    expect(useAuth.getState().memberId).toBeNull()
  })

  it('요청 취소 후 다시 요청하면 이번 기기 앞으로 승인받아 정상 진입한다', async () => {
    const otherDeviceUid = 'anon-uid-other-device'
    store.docs.set(`clubs/${CLUB}/linkRequests/${otherDeviceUid}`, {
      memberId: MEMBER_ID, requestedAt: '2026-08-26T00:00:00.000Z',
    })
    const thisUid = await requestConnectionAsNewDevice()
    await adminApproves(otherDeviceUid, MEMBER_ID)

    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))
    await waitFor(() => expect(screen.getByText(/아직 이 기기는 승인되지 않았습니다/)).toBeInTheDocument())

    // 안내대로 요청 취소 → 이름 다시 선택 → 다시 요청
    fireEvent.click(screen.getByRole('button', { name: '요청 취소' }))
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: MEMBER_ID } })
    fireEvent.click(screen.getByRole('button', { name: '이 기기 연결 요청' }))
    await waitFor(() => expect(screen.getByText(/연결을 요청했습니다/)).toBeInTheDocument())

    // 이번에는 관리자가 이 기기의 요청을 승인
    await adminApproves(thisUid, MEMBER_ID)
    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    await waitFor(() => expect(screen.getByText(`👤 ${MEMBER_NAME} 님`)).toBeInTheDocument())
    expect(useAuth.getState().memberId).toBe(MEMBER_ID)
  })

  it('저장소가 비워져 UID가 바뀌면 요청 기록이 사라져 이름 선택부터 다시 시작한다', async () => {
    const requestUid = await requestConnectionAsNewDevice()
    await adminApproves(requestUid, MEMBER_ID)

    // 사파리 데이터 삭제·PWA 저장소 분리 등으로 다음 실행에서 새 UID가 발급되는 상황
    authState.currentUser = null
    authState.forceNewAnonUid = true

    fireEvent.click(screen.getByRole('button', { name: '승인됐는지 다시 확인' }))

    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
    const newUid = authState.currentUser!.uid
    expect(newUid).not.toBe(requestUid)
    expect(store.docs.has(`clubs/${CLUB}/memberLinks/${newUid}`)).toBe(false)
    expect(useAuth.getState().memberId).toBeNull()
  })
})
