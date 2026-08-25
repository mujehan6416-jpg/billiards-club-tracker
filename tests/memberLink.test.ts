import { describe, it, expect, vi, beforeEach } from 'vitest'

// Firestore 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 절대 접근하지 않는다.
const setDocMock = vi.fn()
const deleteDocMock = vi.fn()
const updateDocMock = vi.fn()
const getDocMock = vi.fn()
const getDocsMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
}))
vi.mock('../src/lib/firebase', () => ({ db: {} }))

import {
  approveLinkRequest, cancelMyRequest, createLinkRequest, fetchMemberLinks,
  fetchMyLink, fetchMyRequest, fetchPendingRequests, rejectLinkRequest, setLinkActive,
} from '../src/lib/memberLink'

// 아래 UID·회원 ID는 전부 테스트용 가상 값이며 실제 회원 정보가 아니다.
const UID = 'anon-uid-1'
const MEMBER_ID = 'member-abc'

beforeEach(() => {
  setDocMock.mockReset(); setDocMock.mockResolvedValue(undefined)
  deleteDocMock.mockReset(); deleteDocMock.mockResolvedValue(undefined)
  updateDocMock.mockReset(); updateDocMock.mockResolvedValue(undefined)
  getDocMock.mockReset()
  getDocsMock.mockReset()
})

/** setDoc/deleteDoc에 넘어간 문서 경로 */
const pathOf = (mock: typeof setDocMock, call = 0) => (mock.mock.calls[call][0] as { path: string }).path
const payloadOf = (mock: typeof setDocMock, call = 0) => mock.mock.calls[call][1] as Record<string, unknown>

describe('연결 요청 만들기 — 요청자가 넣을 수 있는 값', () => {
  it('자기 UID 문서에 memberId와 requestedAt만 쓴다', async () => {
    await createLinkRequest(UID, MEMBER_ID)

    expect(pathOf(setDocMock)).toBe(`clubs/skkubc/linkRequests/${UID}`)
    const payload = payloadOf(setDocMock)
    expect(Object.keys(payload).sort()).toEqual(['memberId', 'requestedAt'])
    expect(payload.memberId).toBe(MEMBER_ID)
  })

  it('요청에 role·active·승인정보를 절대 함께 쓰지 않는다', async () => {
    await createLinkRequest(UID, MEMBER_ID)

    const payload = payloadOf(setDocMock)
    expect(payload).not.toHaveProperty('role')
    expect(payload).not.toHaveProperty('active')
    expect(payload).not.toHaveProperty('approvedBy')
  })

  it('요청 취소는 자기 요청 문서만 지운다', async () => {
    await cancelMyRequest(UID)
    expect(pathOf(deleteDocMock)).toBe(`clubs/skkubc/linkRequests/${UID}`)
  })
})

describe('내 연결 상태 조회', () => {
  it('연결 기록이 있으면 그대로 돌려준다', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ memberId: MEMBER_ID, role: 'member', active: true, linkedAt: '2026-08-24T00:00:00.000Z' }),
    })
    const link = await fetchMyLink(UID)
    expect(link?.memberId).toBe(MEMBER_ID)
    expect(link?.role).toBe('member')
  })

  it('연결 기록이 없으면 null', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    expect(await fetchMyLink(UID)).toBeNull()
  })

  it('요청 기록이 없으면 null', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    expect(await fetchMyRequest(UID)).toBeNull()
  })
})

describe('관리자 승인', () => {
  it('승인하면 연결을 만들고 요청을 지운다', async () => {
    await approveLinkRequest(UID, MEMBER_ID, 'admin-uid')

    expect(pathOf(setDocMock)).toBe(`clubs/skkubc/memberLinks/${UID}`)
    expect(pathOf(deleteDocMock)).toBe(`clubs/skkubc/linkRequests/${UID}`)
  })

  it('승인으로 만들어지는 역할은 반드시 member다 (관리자 권한을 주지 않는다)', async () => {
    await approveLinkRequest(UID, MEMBER_ID, 'admin-uid')

    const link = payloadOf(setDocMock)
    expect(link.role).toBe('member')
    expect(link.active).toBe(true)
    expect(link.memberId).toBe(MEMBER_ID)
    expect(link.linkedAt).toBeTruthy()
  })

  it('신뢰할 수 있는 관리자 UID가 있으면 approvedBy로 남긴다', async () => {
    await approveLinkRequest(UID, MEMBER_ID, 'admin-uid')
    expect(payloadOf(setDocMock).approvedBy).toBe('admin-uid')
  })

  it('관리자 UID가 없으면 approvedBy를 넣지 않는다 (PIN 값을 ID처럼 쓰지 않는다)', async () => {
    await approveLinkRequest(UID, MEMBER_ID, undefined)
    expect(payloadOf(setDocMock)).not.toHaveProperty('approvedBy')
  })

  it('거절하면 요청만 지우고 연결은 만들지 않는다', async () => {
    await rejectLinkRequest(UID)

    expect(pathOf(deleteDocMock)).toBe(`clubs/skkubc/linkRequests/${UID}`)
    expect(setDocMock).not.toHaveBeenCalled()
  })
})

describe('연결 해제', () => {
  it('문서를 지우지 않고 active만 false로 바꾼다(기록 보존)', async () => {
    await setLinkActive(UID, false)

    expect(updateDocMock).toHaveBeenCalledTimes(1)
    expect(pathOf(updateDocMock)).toBe(`clubs/skkubc/memberLinks/${UID}`)
    expect(payloadOf(updateDocMock)).toEqual({ active: false })
    expect(deleteDocMock).not.toHaveBeenCalled()
  })

  it('다시 연결하면 active만 true로 되돌린다', async () => {
    await setLinkActive(UID, true)
    expect(payloadOf(updateDocMock)).toEqual({ active: true })
  })
})

describe('한 회원이 여러 기기를 쓰는 경우', () => {
  it('서로 다른 UID가 같은 memberId를 가리키는 것을 막지 않는다', async () => {
    await approveLinkRequest('uid-phone', MEMBER_ID)
    await approveLinkRequest('uid-home-pc', MEMBER_ID)
    await approveLinkRequest('uid-office-pc', MEMBER_ID)

    expect(setDocMock).toHaveBeenCalledTimes(3)
    expect(pathOf(setDocMock, 0)).toBe('clubs/skkubc/memberLinks/uid-phone')
    expect(pathOf(setDocMock, 1)).toBe('clubs/skkubc/memberLinks/uid-home-pc')
    expect(pathOf(setDocMock, 2)).toBe('clubs/skkubc/memberLinks/uid-office-pc')
    for (let i = 0; i < 3; i++) expect(payloadOf(setDocMock, i).memberId).toBe(MEMBER_ID)
  })

  it('연결 목록은 문서 ID(UID)를 함께 돌려준다', async () => {
    getDocsMock.mockResolvedValue({
      docs: [
        { id: 'uid-phone', data: () => ({ memberId: MEMBER_ID, role: 'member', active: true, linkedAt: 'x' }) },
        { id: 'uid-home-pc', data: () => ({ memberId: MEMBER_ID, role: 'member', active: false, linkedAt: 'y' }) },
      ],
    })
    const links = await fetchMemberLinks()
    expect(links.map((l) => l.firebaseUid)).toEqual(['uid-phone', 'uid-home-pc'])
    expect(links.every((l) => l.link.memberId === MEMBER_ID)).toBe(true)
  })

  it('대기 요청 목록도 문서 ID(UID)를 함께 돌려준다', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ id: 'uid-new', data: () => ({ memberId: MEMBER_ID, requestedAt: 'z' }) }],
    })
    const reqs = await fetchPendingRequests()
    expect(reqs).toEqual([{ firebaseUid: 'uid-new', request: { memberId: MEMBER_ID, requestedAt: 'z' } }])
  })
})
