import { describe, it, expect, vi, beforeEach } from 'vitest'

// firebase/firestore를 모킹해 실제 네트워크 호출 없이 settlementSync 로직만 검증한다.
const getDocMock = vi.fn()
const getDocsMock = vi.fn()
const setDocMock = vi.fn()
const deleteDocMock = vi.fn()

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => 'COL_REF'),
  doc: vi.fn(() => 'DOC_REF'),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((...args: unknown[]) => args),
  getDoc: (...args: unknown[]) => getDocMock(...args),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

import { listSettlements, findSettlementBySessionId, saveSettlement, deleteSettlement, stripUndefinedDeep, SettlementSyncError } from '../src/lib/settlementSync'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-sync-1',
    meetingName: '가상 정기모임',
    meetingDate: '2026-01-10',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-01-10T00:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

beforeEach(() => {
  getDocMock.mockReset()
  getDocsMock.mockReset()
  setDocMock.mockReset()
  deleteDocMock.mockReset()
})

describe('listSettlements', () => {
  it('문서 목록을 RegularSettlement 배열로 변환한다', async () => {
    const a = fakeSettlement({ id: 'a' })
    const b = fakeSettlement({ id: 'b' })
    getDocsMock.mockResolvedValue({ docs: [{ data: () => a }, { data: () => b }] })
    const result = await listSettlements()
    expect(result).toEqual([a, b])
  })
})

describe('findSettlementBySessionId', () => {
  it('일치하는 문서가 없으면 null', async () => {
    getDocsMock.mockResolvedValue({ empty: true, docs: [] })
    expect(await findSettlementBySessionId('session-x')).toBeNull()
  })

  it('일치하는 문서가 있으면 반환', async () => {
    const s = fakeSettlement({ sessionId: 'session-x' })
    getDocsMock.mockResolvedValue({ empty: false, docs: [{ data: () => s }] })
    expect(await findSettlementBySessionId('session-x')).toEqual(s)
  })
})

describe('saveSettlement — 버전 소유권 모델(로컬 편집은 버전을 안 바꾸고, 저장 성공 시에만 서버가 새 버전을 정한다)', () => {
  it('신규 생성(로컬 version 0) 시 같은 sessionId 정산이 있으면 duplicate-session 오류', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    getDocsMock.mockResolvedValue({ empty: false, docs: [{ data: () => fakeSettlement({ id: 'other-id', sessionId: 'session-x' }) }] })

    const settlement = fakeSettlement({ id: 'new-id', sessionId: 'session-x', version: 0 })
    await expect(saveSettlement(settlement)).rejects.toMatchObject({ code: 'duplicate-session' })
    expect(setDocMock).not.toHaveBeenCalled()
  })

  it('신규 생성: 로컬 version 0 → 저장 성공 → 새 버전 1을 반환하고 그 값으로 저장한다', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    getDocsMock.mockResolvedValue({ empty: true, docs: [] })
    setDocMock.mockResolvedValue(undefined)

    const settlement = fakeSettlement({ id: 'new-id', sessionId: 'session-y', version: 0 })
    const newVersion = await saveSettlement(settlement)
    expect(newVersion).toBe(1)
    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(setDocMock.mock.calls[0][1]).toMatchObject({ version: 1 })
  })

  it('기존 문서 수정: 서버 version 1 / 로컬 version 1(같음) → 저장 성공 → 새 버전 2', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => fakeSettlement({ version: 1 }) })
    setDocMock.mockResolvedValue(undefined)
    const settlement = fakeSettlement({ version: 1 })
    const newVersion = await saveSettlement(settlement)
    expect(newVersion).toBe(2)
    expect(setDocMock).toHaveBeenCalledTimes(1)
    expect(setDocMock.mock.calls[0][1]).toMatchObject({ version: 2 })
  })

  it('기존 문서 수정: 서버 version 2 / 로컬 version 1(다름) → conflict, 저장하지 않는다', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => fakeSettlement({ version: 2 }) })
    const settlement = fakeSettlement({ version: 1 })
    await expect(saveSettlement(settlement)).rejects.toMatchObject({ code: 'conflict' })
    expect(setDocMock).not.toHaveBeenCalled()
  })

  it('permission-denied 오류는 안내 메시지가 있는 SettlementSyncError로 변환된다', async () => {
    getDocMock.mockRejectedValue({ code: 'permission-denied' })
    const settlement = fakeSettlement()
    await expect(saveSettlement(settlement)).rejects.toBeInstanceOf(SettlementSyncError)
    await expect(saveSettlement(settlement)).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('저장 payload에 undefined가 남지 않는다(confirmedByUid 등 optional 필드가 비어있어도 setDoc이 거부하지 않도록)', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    getDocsMock.mockResolvedValue({ empty: true, docs: [] })
    setDocMock.mockResolvedValue(undefined)

    const settlement = fakeSettlement({ id: 'new-id', version: 0, confirmedByUid: undefined, cancelledByUid: undefined })
    await saveSettlement(settlement)
    const payload = setDocMock.mock.calls[0][1]
    expect(Object.values(payload)).not.toContain(undefined)
    expect('confirmedByUid' in payload).toBe(false)
  })

  it('actor.uid가 있으면 confirmedByUid가 payload에 실제로 저장된다', async () => {
    getDocMock.mockResolvedValue({ exists: () => false })
    getDocsMock.mockResolvedValue({ empty: true, docs: [] })
    setDocMock.mockResolvedValue(undefined)

    const settlement = fakeSettlement({ id: 'new-id', version: 0, status: 'confirmed', confirmedByUid: 'fake-admin-uid' })
    await saveSettlement(settlement)
    const payload = setDocMock.mock.calls[0][1]
    expect(payload.confirmedByUid).toBe('fake-admin-uid')
  })
})

describe('deleteSettlement', () => {
  it('해당 id의 문서에 deleteDoc을 호출한다', async () => {
    deleteDocMock.mockResolvedValue(undefined)
    await deleteSettlement('settle-sync-1')
    expect(deleteDocMock).toHaveBeenCalledTimes(1)
    expect(deleteDocMock).toHaveBeenCalledWith('DOC_REF')
  })

  it('permission-denied 오류는 안내 메시지가 있는 SettlementSyncError로 변환된다', async () => {
    deleteDocMock.mockRejectedValue({ code: 'permission-denied' })
    await expect(deleteSettlement('settle-sync-1')).rejects.toBeInstanceOf(SettlementSyncError)
    await expect(deleteSettlement('settle-sync-1')).rejects.toMatchObject({ code: 'permission-denied' })
  })

  it('알 수 없는 오류도 SettlementSyncError(unknown)로 변환된다', async () => {
    deleteDocMock.mockRejectedValue(new Error('가상 네트워크 오류'))
    await expect(deleteSettlement('settle-sync-1')).rejects.toMatchObject({ code: 'unknown', message: '가상 네트워크 오류' })
  })
})

describe('stripUndefinedDeep', () => {
  it('최상위 undefined 필드를 제거한다', () => {
    expect(stripUndefinedDeep({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('중첩 객체 내부의 undefined도 제거한다', () => {
    expect(stripUndefinedDeep({ a: { b: 1, c: undefined } })).toEqual({ a: { b: 1 } })
  })

  it('배열 내부 객체의 undefined도 제거한다', () => {
    expect(stripUndefinedDeep({ list: [{ a: 1, b: undefined }, { a: 2 }] })).toEqual({ list: [{ a: 1 }, { a: 2 }] })
  })

  it('null, false, 0, 빈 문자열은 유지한다(제거하지 않음)', () => {
    const input = { a: null, b: false, c: 0, d: '' }
    expect(stripUndefinedDeep(input)).toEqual({ a: null, b: false, c: 0, d: '' })
  })
})
