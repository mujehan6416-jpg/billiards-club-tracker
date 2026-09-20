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

  it('JSON 전체 복원은 로컬에만 반영되고, split 모드에서는 서버 반영이 막혀 있음을 안내한다', async () => {
    const { container } = render(<SettingsTab />)
    const restored: AppState = { members: [], sessions: [], settings: { lastBackupAt: null }, ledger: [] }
    dropFile(container, 'backupJson', 'backup.json', JSON.stringify(restored))

    await waitFor(() => expect(screen.getByText(/이 기기 내용만 되돌렸습니다/)).toBeInTheDocument())
    // split 모드에서는 수동 올리기 버튼 자체가 없다(안내 문구가 없는 버튼을 가리키지 않는다).
    expect(screen.queryByRole('button', { name: '이 기기 내용을 서버에 올리기' })).not.toBeInTheDocument()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(syncSplitChangesMock).not.toHaveBeenCalled()
  })
})

// 화면 정리(2026-09): 이미 끝난 작업의 관리자 카드 다섯 개를 설정 탭에서 내렸다.
// 기능·데이터·컴포넌트 파일은 그대로 두고 보여주기만 멈춘 것이라, 여기서는 "화면에
// 나타나지 않는다"만 확인한다.
describe('SettingsTab — 끝난 작업 카드는 화면에 나타나지 않는다', () => {
  it('데이터 관리 카드와 수동 받기·올리기 버튼이 없다', () => {
    render(<SettingsTab />)
    expect(screen.queryByText(/💾 데이터 관리/)).not.toBeInTheDocument()
    expect(screen.queryByText(/자동으로 서버에 저장됩니다/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '서버 내용을 이 기기로 받기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '이 기기 내용을 서버에 올리기' })).not.toBeInTheDocument()
  })

  it('이름 찾기 목록·새 구조 복사·과거 대회 가져오기 카드가 없다', () => {
    render(<SettingsTab />)
    expect(screen.queryByText(/이름 찾기 목록/)).not.toBeInTheDocument()
    expect(screen.queryByText(/새 구조로 데이터 복사/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026-04-18/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2025-11-29/)).not.toBeInTheDocument()
  })

  it('legacy 함수 자체는 이 화면 어디에서도 호출되지 않는다', () => {
    render(<SettingsTab />)
    expect(downloadFromCloudMock).not.toHaveBeenCalled()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })
})

// 화면에서 내린 카드와 무관하게, 남겨 두기로 한 설정 기능은 그대로 보여야 한다.
describe('SettingsTab — 남겨 둔 설정 기능은 그대로 보인다', () => {
  it('핸디 이력 파일 카드와 그 아래 파일 기능이 그대로 있다', () => {
    render(<SettingsTab />)
    expect(screen.getByText('핸디 이력 파일')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '핸디 이력 파일 받기 (CSV)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '핸디 이력 파일 올리기 (CSV)' })).toBeInTheDocument()
  })

  it('회원명부·경기 기록·전체 보관 카드가 그대로 있다', () => {
    render(<SettingsTab />)
    expect(screen.getByText('👥 회원명부 파일')).toBeInTheDocument()
    expect(screen.getByText('🎱 경기 기록 파일')).toBeInTheDocument()
    expect(screen.getByText('🗄️ 전체 데이터 보관하기')).toBeInTheDocument()
  })

  // 경기결과·번개모임 승인 카드는 대기 건수가 0이면 원래부터 렌더되지 않으므로
  // (PendingGamesCard / PendingFlashCard의 early return), 여기서는 항상 보이는
  // 핸디 관리 카드로 "위쪽 관리자 기능이 남아 있다"를 확인한다.
  it('위쪽 관리자 기능(핸디 관리)이 그대로 있다', () => {
    render(<SettingsTab />)
    expect(screen.getByText('🎯 에버리지(핸디) 수정')).toBeInTheDocument()
  })
})
