import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

// 모킹된 모듈에서 되받아 온 클래스라야 컴포넌트 쪽 instanceof 검사와 일치한다
import { UploadCancelledError } from '../src/lib/cloudSync'
import { MembersTab } from '../src/tabs/MembersTab'
import { useApp } from '../src/store/appStore'
import { useAdmin } from '../src/store/adminStore'
import { useAuth } from '../src/store/authStore'
import type { Member } from '../src/types'

// 아래 이름·ID는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [{ value: 25, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

const memberOf = (id: string) => useApp.getState().members.find((m) => m.id === id)!
/** 마지막으로 서버에 올라간 상태 (uploadToCloud에 넘어간 인자) */
const lastUploaded = () => uploadToCloudMock.mock.calls[uploadToCloudMock.mock.calls.length - 1][0] as { members: Member[] }

beforeEach(() => {
  useApp.setState({ members, sessions: [], settings: { lastBackupAt: null }, ledger: [] })
  // 로그인 회원(m1)은 "내 실적" 카드로 빠지므로, 목록 조작은 m2로 한다
  useAuth.setState({ memberId: 'm1', memberName: '테스트회원A', isGuest: false })
  useAdmin.setState({ isAdmin: true })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

describe('MembersTab — 회원 변경 시 자동 서버 저장', () => {
  it('회원을 추가하면 추가된 회원이 포함된 상태로 서버에 올라간다', async () => {
    render(<MembersTab />)
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '테스트회원C' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    // 변경 "전" 상태가 아니라 변경 후 최신 상태가 올라가야 한다
    expect(lastUploaded().members.map((m) => m.name)).toContain('테스트회원C')
  })

  it('이름 입력칸에서 Enter로 추가해도 서버에 올라간다', async () => {
    render(<MembersTab />)
    const input = screen.getByPlaceholderText('이름')
    fireEvent.change(input, { target: { value: '테스트회원D' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(lastUploaded().members.map((m) => m.name)).toContain('테스트회원D')
  })

  it('회원 이름을 수정하면 서버에 올라간다', async () => {
    render(<MembersTab />)
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0])
    const nameInput = screen.getByDisplayValue('테스트회원B')
    fireEvent.change(nameInput, { target: { value: '이름바꿈' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(memberOf('m2').name).toBe('이름바꿈')
    expect(lastUploaded().members.find((m) => m.id === 'm2')!.name).toBe('이름바꿈')
  })

  it('회원 핸디를 수정하면 서버에 올라간다', async () => {
    render(<MembersTab />)
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0])
    fireEvent.change(screen.getByDisplayValue('25'), { target: { value: '28' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(memberOf('m2').handicap).toBe(28)
    expect(lastUploaded().members.find((m) => m.id === 'm2')!.handicap).toBe(28)
  })

  it('이름과 핸디를 함께 고쳐도 서버 저장은 한 번만 호출된다(중복 업로드 없음)', async () => {
    render(<MembersTab />)
    fireEvent.click(screen.getAllByRole('button', { name: '수정' })[0])
    fireEvent.change(screen.getByDisplayValue('테스트회원B'), { target: { value: '둘다바꿈' } })
    fireEvent.change(screen.getByDisplayValue('25'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    const saved = lastUploaded().members.find((m) => m.id === 'm2')!
    expect(saved.name).toBe('둘다바꿈')
    expect(saved.handicap).toBe(30)
  })

  it('활성/비활성을 바꾸면 서버에 올라간다', async () => {
    render(<MembersTab />)
    fireEvent.click(screen.getAllByRole('button', { name: '비활성' })[0])

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(memberOf('m2').active).toBe(false)
    expect(lastUploaded().members.find((m) => m.id === 'm2')!.active).toBe(false)
  })

  it('서버 저장에 실패하면 쉬운 말로 안내하고, 변경 자체는 이 기기에 남는다', async () => {
    uploadToCloudMock.mockRejectedValue(new Error('network down'))
    render(<MembersTab />)
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '테스트회원E' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() =>
      expect(screen.getByText(/서버에 반영하지 못했습니다/)).toBeInTheDocument(),
    )
    // 로컬 변경은 유지된다
    expect(useApp.getState().members.map((m) => m.name)).toContain('테스트회원E')
    // 기술 용어를 사용자에게 노출하지 않는다
    const msg = screen.getByText(/서버에 반영하지 못했습니다/).textContent ?? ''
    expect(msg).not.toMatch(/Firebase|Firestore|upload|sync|network down/i)
  })

  it('다른 기기 충돌로 업로드가 취소되면 그 사실을 안내한다', async () => {
    uploadToCloudMock.mockRejectedValue(new UploadCancelledError())
    render(<MembersTab />)
    fireEvent.change(screen.getByPlaceholderText('이름'), { target: { value: '테스트회원F' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))

    await waitFor(() =>
      expect(screen.getByText(/서버 저장을 취소했습니다/)).toBeInTheDocument(),
    )
  })

  it('일반회원(관리자 아님)에게는 회원 추가·수정 자체가 없어 서버 저장도 일어나지 않는다', () => {
    useAdmin.setState({ isAdmin: false })
    render(<MembersTab />)
    expect(screen.queryByRole('button', { name: '추가' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })
})
