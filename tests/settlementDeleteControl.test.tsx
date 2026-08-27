import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// settlementSync(Firestore 실제 호출부)를 통째로 모킹 — 실제 Firebase에 절대 접근하지 않는다.
const deleteSettlementMock = vi.fn()
vi.mock('../src/lib/settlementSync', () => ({
  saveSettlement: vi.fn(),
  listSettlements: vi.fn(),
  getSettlement: vi.fn(),
  deleteSettlement: (...args: unknown[]) => deleteSettlementMock(...args),
}))

// Firebase 관리자 재인증도 모킹 — 실제 계정·네트워크에 접근하지 않는다.
const reauthenticateAdminMock = vi.fn()
vi.mock('../src/lib/adminAuth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/adminAuth')>('../src/lib/adminAuth')
  return {
    ...actual,
    adminSignIn: vi.fn(),
    adminSignOut: vi.fn(),
    subscribeAuthState: () => () => {},
    fetchAdminDoc: vi.fn(),
    reauthenticateAdmin: (...args: unknown[]) => reauthenticateAdminMock(...args),
  }
})
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: () => () => {},
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))

import { SettlementDeleteControl } from '../src/components/settlement/SettlementDeleteControl'
import { useSettlementStore } from '../src/store/settlementStore'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useAdmin } from '../src/store/adminStore'
import { ReauthError } from '../src/lib/adminAuth'
import type { RegularSettlement } from '../src/types/settlement'

// 아래 이름·ID·금액은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.
const PASSWORD = 'fake-admin-password' // 가상 테스트 전용 — 실제 관리자 비밀번호가 아니다

function fakeSettlement(overrides: Partial<RegularSettlement> = {}): RegularSettlement {
  return {
    id: 'settle-del-1',
    meetingName: '가상 27차 정기모임',
    meetingDate: '2026-07-15',
    meetingType: 'regular',
    status: 'draft',
    participants: [],
    expenses: [],
    dinnerContributions: [],
    cashDeposits: [],
    prevBankBalance: 0,
    otherBankAdjustment: 0,
    createdAt: '2026-07-15T00:00:00.000Z',
    version: 1,
    revisionLog: [],
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let confirmSpy: any

const asAuthorizedAdmin = () =>
  useAdminAuthStore.setState({
    status: 'authorizedAdmin', uid: 'fake-admin-uid', email: 'fake-admin@example.test',
    adminDisplayName: '가상관리자', errorMessage: null,
  })

beforeEach(() => {
  localStorage.removeItem('billiards-admin-pin')
  useAdmin.setState({ isAdmin: true })
  useSettlementStore.setState({ settlements: [fakeSettlement()], currentId: 'settle-del-1', syncStatus: 'idle', lastSyncError: null })
  asAuthorizedAdmin()
  deleteSettlementMock.mockReset()
  deleteSettlementMock.mockResolvedValue(undefined)
  reauthenticateAdminMock.mockReset()
  reauthenticateAdminMock.mockResolvedValue(undefined)
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  confirmSpy.mockRestore()
})

/** 1단계 경고를 통과해 비밀번호 입력 단계까지 진행한다. */
const openAuthStep = async () => {
  fireEvent.click(screen.getByRole('button', { name: '정산 삭제' }))
  await waitFor(() => expect(screen.getByLabelText('관리자 비밀번호')).toBeInTheDocument())
}

describe('SettlementDeleteControl — 삭제 대상 표시 및 1단계 경고', () => {
  it('선택한 정산의 날짜·제목·상태를 화면에 표시한다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)

    expect(screen.getByText('2026-07-15')).toBeInTheDocument()
    expect(screen.getByText('가상 27차 정기모임')).toBeInTheDocument()
    expect(screen.getByText('작성 중(draft)')).toBeInTheDocument()
  })

  it('삭제 버튼을 누르면 확인 문구와 함께 window.confirm을 띄운다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByRole('button', { name: '정산 삭제' }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(String(confirmSpy.mock.calls[0][0])).toContain('2026-07-15')
  })

  it('1단계에서 취소하면 비밀번호 입력 화면이 나타나지 않는다', () => {
    confirmSpy.mockReturnValue(false)
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    fireEvent.click(screen.getByRole('button', { name: '정산 삭제' }))

    expect(screen.queryByLabelText('관리자 비밀번호')).not.toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })
})

describe('SettlementDeleteControl — Firebase 관리자 재인증', () => {
  it('Firebase 관리자 인증이 없으면 삭제 버튼 자체를 보여주지 않는다', () => {
    useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)

    expect(screen.getByText(/관리자 로그인이 필요합니다/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '정산 삭제' })).not.toBeInTheDocument()
  })

  it('관리자 번호(PIN)가 아니라 계정 비밀번호를 요구한다고 안내한다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    expect(screen.getByText(/관리자 비밀번호를 다시 입력해 주세요/)).toBeInTheDocument()
    expect(screen.getByText(/관리자 번호\(PIN\)가 아닙니다/)).toBeInTheDocument()
    expect(screen.getByText(/fake-admin@example.test/)).toBeInTheDocument()
  })

  it('비밀번호가 틀리면 어떤 문서도 삭제하지 않고 오류만 보여준다', async () => {
    reauthenticateAdminMock.mockRejectedValue(new ReauthError('wrong-password', '비밀번호가 올바르지 않습니다.'))
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(screen.getByText('비밀번호가 올바르지 않습니다.')).toBeInTheDocument())
    expect(deleteSettlementMock).not.toHaveBeenCalled()
    expect(useSettlementStore.getState().settlements).toHaveLength(1)
  })

  it('재인증이 다른 이유로 실패해도 삭제하지 않는다', async () => {
    reauthenticateAdminMock.mockRejectedValue(new ReauthError('no-session', '관리자 로그인이 확인되지 않습니다. 다시 로그인해 주세요.'))
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(screen.getByText(/다시 로그인해 주세요/)).toBeInTheDocument())
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })

  it('재인증에 성공하면 그 정산 1건만 정확한 id로 삭제한다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(deleteSettlementMock).toHaveBeenCalledWith('settle-del-1'))
    expect(deleteSettlementMock).toHaveBeenCalledTimes(1)
    expect(reauthenticateAdminMock).toHaveBeenCalledWith(PASSWORD)
  })

  it('취소를 누르면 비밀번호 화면이 닫히고 삭제하지 않는다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    await waitFor(() => expect(screen.queryByLabelText('관리자 비밀번호')).not.toBeInTheDocument())
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })

  it('비밀번호를 비워 두면 삭제 버튼이 눌리지 않는다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    expect(screen.getByRole('button', { name: '정산 영구 삭제' })).toBeDisabled()
  })
})

describe('SettlementDeleteControl — confirmed 정산의 추가 확인', () => {
  const confirmedSettlement = () => fakeSettlement({ status: 'confirmed' })

  it('확정 상태를 화면에 분명히 표시한다', () => {
    render(<SettlementDeleteControl settlement={confirmedSettlement()} />)
    expect(screen.getByText('확정됨')).toBeInTheDocument()
  })

  it('draft보다 강한 경고 문구를 1단계 확인에 보여준다', () => {
    render(<SettlementDeleteControl settlement={confirmedSettlement()} />)
    fireEvent.click(screen.getByRole('button', { name: '정산 삭제' }))

    const message = String(confirmSpy.mock.calls[0][0])
    expect(message).toContain('이미 확정된 정산입니다')
    expect(message).toContain('되돌릴 수 없습니다')
  })

  it('추가 확인(체크)을 하지 않으면 비밀번호를 넣어도 삭제할 수 없다', async () => {
    render(<SettlementDeleteControl settlement={confirmedSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })

    expect(screen.getByRole('button', { name: '정산 영구 삭제' })).toBeDisabled()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })

  it('추가 확인까지 하면 삭제할 수 있다', async () => {
    render(<SettlementDeleteControl settlement={confirmedSettlement()} />)
    await openAuthStep()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(deleteSettlementMock).toHaveBeenCalledWith('settle-del-1'))
  })

  it('draft 정산에는 추가 확인 체크가 나타나지 않는다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement({ status: 'draft' })} />)
    await openAuthStep()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('SettlementDeleteControl — 삭제 결과', () => {
  it('삭제에 성공하면 안내를 보여주고 store에서 그 정산이 사라진다', async () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(screen.getByText('정산이 삭제되었습니다.')).toBeInTheDocument())
    expect(useSettlementStore.getState().settlements).toHaveLength(0)
  })

  it('서버 삭제가 실패하면 목록에서 제거하지 않고 오류를 보여준다', async () => {
    deleteSettlementMock.mockRejectedValue(new Error('offline'))
    render(<SettlementDeleteControl settlement={fakeSettlement()} />)
    await openAuthStep()

    fireEvent.change(screen.getByLabelText('관리자 비밀번호'), { target: { value: PASSWORD } })
    fireEvent.click(screen.getByRole('button', { name: '정산 영구 삭제' }))

    await waitFor(() => expect(screen.queryByText('정산이 삭제되었습니다.')).not.toBeInTheDocument())
    expect(useSettlementStore.getState().settlements).toHaveLength(1)
  })

  it('개발 미리보기에서는 삭제를 시작하지 않는다', () => {
    render(<SettlementDeleteControl settlement={fakeSettlement()} previewMode />)
    fireEvent.click(screen.getByRole('button', { name: '정산 삭제' }))

    expect(screen.getByText(/개발 미리보기에서는 정산을 삭제할 수 없습니다/)).toBeInTheDocument()
    expect(deleteSettlementMock).not.toHaveBeenCalled()
  })
})
