import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync·splitFirestore(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
// CSV 반영(회원명부·핸디이력·경기기록)은 saveToServer(previous)를 거치므로
// USE_SPLIT_FIRESTORE=true(운영 기본값)에서는 syncSplitChanges를 쓴다. 반면 "이 기기 내용을
// 서버에 올리기/받기"는 설계상 항상 legacy(uploadToCloud/downloadFromCloud)만 쓴다 — 그래서
// 그 두 버튼을 확인하는 테스트는 그대로 둔다.
const uploadToCloudMock = vi.fn()
const downloadFromCloudMock = vi.fn()
const markSyncedMock = vi.fn()
const syncSplitChangesMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  downloadFromCloud: (...args: unknown[]) => downloadFromCloudMock(...args),
  markSynced: (...args: unknown[]) => markSyncedMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))
vi.mock('../src/lib/splitFirestore', () => ({
  USE_SPLIT_FIRESTORE: true,
  syncSplitChanges: (...args: unknown[]) => syncSplitChangesMock(...args),
}))

import { SettingsTab } from '../src/tabs/SettingsTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import type { AppState, Member } from '../src/types'

// 아래 이름·핸디·경기 기록은 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [{ value: 25, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

/** syncSplitChanges(previous, next)에 넘어간 "바뀐 뒤" 상태(next, 두 번째 인자) — CSV 반영용 */
const lastSynced = () => syncSplitChangesMock.mock.calls[syncSplitChangesMock.mock.calls.length - 1][1] as AppState

/**
 * 숨겨진 file input에 파일을 흘려 넣는다(버튼은 input.click()만 하므로 input을 직접 찾는다).
 * 설정탭의 file input은 화면에 놓인 순서대로 아래 FILE_INPUT의 위치에 있다.
 */
const FILE_INPUT = { handicapCsv: 0, memberCsv: 1, gameCsv: 2, backupJson: 3 } as const

function dropFile(container: HTMLElement, which: keyof typeof FILE_INPUT, name: string, text: string) {
  const inputs = [...container.querySelectorAll('input[type="file"]')] as HTMLInputElement[]
  const input = inputs[FILE_INPUT[which]]
  const file = new File([text], name, { type: name.endsWith('.json') ? 'application/json' : 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new TextEncoder().encode(text).buffer) })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  useAdmin.setState({ isAdmin: true })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
  downloadFromCloudMock.mockReset()
  markSyncedMock.mockReset()
  syncSplitChangesMock.mockReset()
  syncSplitChangesMock.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('SettingsTab — 파일 불러오기 후 자동 서버 저장', () => {
  it('회원명부 CSV를 반영하면 서버(split)에 올라간다', async () => {
    const { container } = render(<SettingsTab />)
    dropFile(container, 'memberCsv', '회원명부.csv', '이름,에버리지\n테스트회원C,18\n')

    await waitFor(() => expect(syncSplitChangesMock).toHaveBeenCalledTimes(1))
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(lastSynced().members.map((m) => m.name)).toContain('테스트회원C')
  })

  it('핸디이력 CSV를 반영하면 서버(split)에 올라간다', async () => {
    const { container } = render(<SettingsTab />)
    dropFile(container, 'handicapCsv', '핸디.csv', '이름,날짜,핸디\n테스트회원A,2026-03-01,23\n')

    await waitFor(() => expect(syncSplitChangesMock).toHaveBeenCalledTimes(1))
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(lastSynced().members.find((m) => m.id === 'm1')!.handicap).toBe(23)
  })

  it('경기기록 CSV를 반영하면 서버(split)에 올라간다', async () => {
    const { container } = render(<SettingsTab />)
    dropFile(container, 'gameCsv', '경기.csv',
      '날짜,선수1,선수2,승자,패자,승자점수,패자점수\n2026-03-05,테스트회원A,테스트회원B,테스트회원A,테스트회원B,20,15\n')

    await waitFor(() => expect(syncSplitChangesMock).toHaveBeenCalledTimes(1))
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(lastSynced().sessions).toHaveLength(1)
  })

  it('CSV 형식이 잘못돼 반영에 실패하면 서버에 올리지 않는다', async () => {
    const { container } = render(<SettingsTab />)
    dropFile(container, 'memberCsv', '엉뚱한파일.csv', '알수없는열\n값\n')

    await waitFor(() => expect(screen.getByText(/찾을 수 없습니다|데이터가 없습니다/)).toBeInTheDocument())
    expect(syncSplitChangesMock).not.toHaveBeenCalled()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })

  it('JSON 전체 복원은 자동으로 서버에 올리지 않고, 직접 올리도록 안내한다', async () => {
    const { container } = render(<SettingsTab />)
    const restored: AppState = { members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] }
    dropFile(container, 'backupJson', 'backup.json', JSON.stringify(restored))

    await waitFor(() => expect(screen.getByText(/보관한 파일로 되돌렸습니다/)).toBeInTheDocument())
    // 안내 문구가 수동 올리기 버튼을 정확히 가리켜야 한다(버튼 자체는 그대로 남아 있다)
    expect(screen.getByRole('button', { name: '이 기기 내용을 서버에 올리기' })).toBeInTheDocument()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(syncSplitChangesMock).not.toHaveBeenCalled()
  })
})

describe('SettingsTab — 데이터 관리 메뉴', () => {
  it('자동 저장 안내와 함께 받기·올리기 버튼이 모두 남아 있다', () => {
    render(<SettingsTab />)
    expect(screen.getByText(/자동으로 서버에 저장됩니다/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '서버 내용을 이 기기로 받기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이 기기 내용을 서버에 올리기' })).toBeInTheDocument()
  })

  it('"서버 내용을 이 기기로 받기"는 기존 동작(받아서 교체 + 동기화 시각 기록)을 유지한다', async () => {
    const cloud: AppState = {
      members: [{ id: 'm9', name: '서버회원', handicap: 15, handicapHistory: [], active: true }],
      sessions: [], settings: { lastBackupAt: null }, ledger: [],
    }
    downloadFromCloudMock.mockResolvedValue({ state: cloud, updatedAt: '2026-08-23T00:00:00.000Z' })
    render(<SettingsTab />)
    fireEvent.click(screen.getByRole('button', { name: '서버 내용을 이 기기로 받기' }))

    await waitFor(() => expect(screen.getByText(/서버 내용을 이 기기로 받았습니다/)).toBeInTheDocument())
    expect(useApp.getState().members.map((m) => m.name)).toEqual(['서버회원'])
    expect(markSyncedMock).toHaveBeenCalledWith('2026-08-23T00:00:00.000Z')
  })

  it('수동 "이 기기 내용을 서버에 올리기"는 그대로 동작한다', async () => {
    render(<SettingsTab />)
    fireEvent.click(screen.getByRole('button', { name: '이 기기 내용을 서버에 올리기' }))

    await waitFor(() => expect(screen.getByText('서버에 올렸습니다.')).toBeInTheDocument())
    expect(uploadToCloudMock).toHaveBeenCalledTimes(1)
  })
})
