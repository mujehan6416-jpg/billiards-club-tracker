import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Firestore/Firebase 실제 호출부를 전부 모킹 — 실제 네트워크·운영 데이터에 접근하지 않는다.
const runAdminMigrationMock = vi.fn()
const verifyMigrationMock = vi.fn()

vi.mock('../src/lib/migration', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/migration')>('../src/lib/migration')
  return {
    ...actual, // prepareMigration은 순수 계산이라 실제 함수를 그대로 쓴다(Firestore 접근 없음)
    runAdminMigration: (...a: unknown[]) => runAdminMigrationMock(...a),
    verifyMigration: (...a: unknown[]) => verifyMigrationMock(...a),
  }
})
vi.mock('../src/lib/splitFirestore', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/splitFirestore')>('../src/lib/splitFirestore')
  return { ...actual, writeAllSplitData: vi.fn() }
})
vi.mock('../src/lib/firebase', () => ({ db: {} }))
vi.mock('../src/lib/adminAuth', () => ({
  adminSignIn: vi.fn(), adminSignOut: vi.fn(),
  subscribeAuthState: () => () => {},
  fetchAdminDoc: vi.fn(),
}))

import { SplitMigrationCard } from '../src/components/admin/SplitMigrationCard'
import { MIGRATION_CONFIRM_PHRASE } from '../src/lib/migration'
import { useAdminAuthStore } from '../src/store/adminAuthStore'
import { useApp } from '../src/store/appStore'
import { makeLegacyAppState } from './fixtures/legacyAppState'

const ADMIN_UID = 'admin-uid-test'

const asAuthorizedAdmin = () =>
  useAdminAuthStore.setState({
    status: 'authorizedAdmin', uid: ADMIN_UID, email: 'a@example.test',
    adminDisplayName: '가상관리자', errorMessage: null,
  })

// 전부 가상 fixture다. 실제 회원 데이터가 아니다.
const legacy = makeLegacyAppState()

beforeEach(() => {
  useApp.setState({
    members: legacy.members, sessions: legacy.sessions,
    settings: legacy.settings, ledger: legacy.ledger,
  })
  useAdminAuthStore.setState({ status: 'unauthenticated', uid: null, email: null, adminDisplayName: null, errorMessage: null })
  runAdminMigrationMock.mockReset()
  runAdminMigrationMock.mockResolvedValue({ written: true, documentCount: 207, validation: { ok: true, counts: {}, issues: [] } })
  verifyMigrationMock.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 미리보기까지 진행한 상태를 만든다. */
const doDryRun = () => fireEvent.click(screen.getByText(/미리보기/))

describe('SplitMigrationCard — 관리자 인증 게이트', () => {
  it('관리자 로그인 전에는 실행 화면을 보여주지 않는다', () => {
    render(<SplitMigrationCard />)

    expect(screen.getByText(/관리자 로그인이 필요합니다/)).toBeInTheDocument()
    expect(screen.queryByText(/미리보기/)).not.toBeInTheDocument()
  })

  it('관리자 번호(PIN)만으로는 실행할 수 없다고 안내한다', () => {
    render(<SplitMigrationCard />)
    expect(screen.getByText(/관리자 번호\(PIN\)만으로는/)).toBeInTheDocument()
  })

  it('관리자 로그인 후에는 미리보기 버튼이 보인다', () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    expect(screen.getByText(/미리보기/)).toBeInTheDocument()
  })
})

describe('SplitMigrationCard — 미리보기(dry-run)', () => {
  it('미리보기는 실제 복사를 호출하지 않는다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)

    doDryRun()

    await waitFor(() => expect(screen.getByText('미리보기 결과')).toBeInTheDocument())
    expect(runAdminMigrationMock).not.toHaveBeenCalled()
  })

  it('미리보기 결과를 개수로 보여준다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)

    doDryRun()

    await waitFor(() => expect(screen.getByText('미리보기 결과')).toBeInTheDocument())
    expect(screen.getAllByText('회원').length).toBeGreaterThan(0)
    expect(screen.getAllByText('모임').length).toBeGreaterThan(0)
    expect(screen.getAllByText('경기').length).toBeGreaterThan(0)
    expect(screen.getAllByText('회계').length).toBeGreaterThan(0)
    expect(screen.getByText('통과')).toBeInTheDocument()
  })

  it('미리보기 화면에 회원 이름 같은 실제 값을 표시하지 않는다', async () => {
    asAuthorizedAdmin()
    const { container } = render(<SplitMigrationCard />)

    doDryRun()

    await waitFor(() => expect(screen.getByText('미리보기 결과')).toBeInTheDocument())
    for (const m of legacy.members) {
      expect(container.textContent).not.toContain(m.name)
    }
  })

  it('저장하지 않았다는 사실을 안내한다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)

    doDryRun()

    await waitFor(() => expect(screen.getByText(/아직 아무것도 저장하지 않았습니다/)).toBeInTheDocument())
  })
})

describe('SplitMigrationCard — 실제 복사 안전장치', () => {
  it('미리보기 전에는 실제 복사 버튼이 아예 없다', () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)

    expect(screen.queryByText('새 구조에 복사하기')).not.toBeInTheDocument()
  })

  it('확인 문구를 입력하기 전에는 복사 버튼이 비활성화된다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    doDryRun()

    await waitFor(() => expect(screen.getByText('새 구조에 복사하기')).toBeInTheDocument())
    expect(screen.getByText('새 구조에 복사하기')).toBeDisabled()
  })

  it('확인 문구가 틀리면 복사 버튼이 계속 비활성화된다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: '옮깁니다' } })

    expect(screen.getByText('새 구조에 복사하기')).toBeDisabled()
  })

  it('확인 문구를 정확히 입력해야 복사 버튼이 활성화된다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })

    expect(screen.getByText('새 구조에 복사하기')).toBeEnabled()
  })

  it('복사 실행 시 관리자 UID와 확인 문구를 함께 넘긴다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })

    fireEvent.click(screen.getByText('새 구조에 복사하기'))

    await waitFor(() => expect(runAdminMigrationMock).toHaveBeenCalledTimes(1))
    const options = runAdminMigrationMock.mock.calls[0][1] as { adminUid: string; confirmPhrase: string }
    expect(options.adminUid).toBe(ADMIN_UID)
    expect(options.confirmPhrase).toBe(MIGRATION_CONFIRM_PHRASE)
  })

  it('확인창에서 취소하면 복사하지 않는다', async () => {
    asAuthorizedAdmin()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })

    fireEvent.click(screen.getByText('새 구조에 복사하기'))

    expect(runAdminMigrationMock).not.toHaveBeenCalled()
  })

  it('복사가 실패하면 성공으로 표시하지 않고, 기존 데이터는 그대로라고 안내한다', async () => {
    asAuthorizedAdmin()
    runAdminMigrationMock.mockRejectedValue(new Error('network down'))
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })

    fireEvent.click(screen.getByText('새 구조에 복사하기'))

    await waitFor(() => expect(screen.getByText(/기존 데이터는 그대로이니/)).toBeInTheDocument())
    expect(screen.queryByText(/복사를 마쳤습니다/)).not.toBeInTheDocument()
  })

  it('안전장치에 걸려 실행되지 않으면 그 이유를 보여준다', async () => {
    asAuthorizedAdmin()
    runAdminMigrationMock.mockResolvedValue({
      written: false, documentCount: 0,
      validation: { ok: true, counts: {}, issues: [] },
      skippedReason: '관리자 로그인이 확인되지 않아 실행하지 않았습니다.',
    })
    render(<SplitMigrationCard />)
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })

    fireEvent.click(screen.getByText('새 구조에 복사하기'))

    await waitFor(() =>
      expect(screen.getByText('관리자 로그인이 확인되지 않아 실행하지 않았습니다.')).toBeInTheDocument())
  })
})

describe('SplitMigrationCard — 복사 후 확인', () => {
  const copyThen = async () => {
    doDryRun()
    await waitFor(() => expect(screen.getByLabelText('확인 문구')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('확인 문구'), { target: { value: MIGRATION_CONFIRM_PHRASE } })
    fireEvent.click(screen.getByText('새 구조에 복사하기'))
    await waitFor(() => expect(screen.getByText('제대로 복사됐는지 확인하기')).toBeInTheDocument())
  }

  it('복사 전에는 확인 버튼이 없다', async () => {
    asAuthorizedAdmin()
    render(<SplitMigrationCard />)
    doDryRun()

    await waitFor(() => expect(screen.getByText('미리보기 결과')).toBeInTheDocument())
    expect(screen.queryByText('제대로 복사됐는지 확인하기')).not.toBeInTheDocument()
  })

  it('복사 후 확인을 누르면 결과를 개수로 보여준다', async () => {
    asAuthorizedAdmin()
    verifyMigrationMock.mockResolvedValue({
      ok: true, missing: 0, mismatched: 0, issues: [],
      counts: {
        config: { legacy: 1, split: 1 },
        members: { legacy: 24, split: 24 },
        sessions: { legacy: 18, split: 18 },
        games: { legacy: 108, split: 108 },
        ledger: { legacy: 32, split: 32 },
      },
    })
    render(<SplitMigrationCard />)
    await copyThen()

    fireEvent.click(screen.getByText('제대로 복사됐는지 확인하기'))

    await waitFor(() => expect(screen.getByText('확인 결과')).toBeInTheDocument())
    expect(screen.getByText('정상')).toBeInTheDocument()
  })

  it('확인 결과에 문제가 있으면 정상으로 표시하지 않는다', async () => {
    asAuthorizedAdmin()
    verifyMigrationMock.mockResolvedValue({
      ok: false, missing: 3, mismatched: 0, issues: ['members: 24건 중 21건만 확인됩니다.'],
      counts: {
        config: { legacy: 1, split: 1 },
        members: { legacy: 24, split: 21 },
        sessions: { legacy: 18, split: 18 },
        games: { legacy: 108, split: 108 },
        ledger: { legacy: 32, split: 32 },
      },
    })
    render(<SplitMigrationCard />)
    await copyThen()

    fireEvent.click(screen.getByText('제대로 복사됐는지 확인하기'))

    await waitFor(() => expect(screen.getByText('문제 있음')).toBeInTheDocument())
    expect(screen.queryByText('정상')).not.toBeInTheDocument()
  })
})
