import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// cloudSync(실제 Firebase 호출부)를 모킹 — 실제 네트워크에 절대 접근하지 않는다.
const uploadToCloudMock = vi.fn()
vi.mock('../src/lib/cloudSync', () => ({
  uploadToCloud: (...args: unknown[]) => uploadToCloudMock(...args),
  UploadCancelledError: class UploadCancelledError extends Error {},
}))

import { CompletedGameEditor } from '../src/components/meeting/CompletedGameEditor'
import { useApp } from '../src/store/appStore'
import { winnerId } from '../src/logic/game'
import type { Game, Member, Session } from '../src/types'

// 아래 이름·ID·점수는 전부 테스트용 가상 데이터이며 실제 회원 정보가 아니다.

const members: Member[] = [
  { id: 'm1', name: '테스트회원A', handicap: 20, handicapHistory: [{ value: 20, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
  { id: 'm2', name: '테스트회원B', handicap: 25, handicapHistory: [{ value: 25, changedAt: '2026-01-01T00:00:00.000Z' }], active: true },
]

function makeGame(over: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerAId: 'm1', playerBId: 'm2',
    handicapA: 20, handicapB: 25,
    scoreA: 10, scoreB: 20,
    endType: 'time',
    playedAt: '2026-07-10T00:00:00.000Z',
    round: 1,
    ...over,
  }
}

const session = (games: Game[]): Session => ({
  id: 's1', date: '2026-07-10', type: 'regular', approved: true,
  attendeeIds: ['m1', 'm2'], games,
})

const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id
const storedGame = () => useApp.getState().sessions.find((s) => s.id === 's1')!.games[0]

beforeEach(() => {
  useApp.setState({ members, sessions: [session([makeGame()])], settings: { lastBackupAt: null }, ledger: [] })
  uploadToCloudMock.mockReset()
  uploadToCloudMock.mockResolvedValue(undefined)
})

function renderEditor(game: Game = makeGame(), onDone = vi.fn()) {
  render(
    <CompletedGameEditor
      game={game} sessionId="s1" sessionDate="2026-07-10" nameOf={nameOf} onDone={onDone}
    />,
  )
  return { onDone }
}

/** 1단계에서 값을 고치고 비교 화면으로 넘어간다. */
function editAndGoConfirm(fields: Partial<Record<string, string>>) {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value: value as string } })
  }
  fireEvent.click(screen.getByRole('button', { name: '다음 (변경 내용 확인)' }))
}

describe('CompletedGameEditor — 1단계: 입력', () => {
  it('현재 저장된 적용 핸디와 득점을 입력칸에 채워서 보여준다', () => {
    renderEditor()
    expect(screen.getByLabelText('테스트회원A 적용 핸디')).toHaveValue(20)
    expect(screen.getByLabelText('테스트회원A 득점')).toHaveValue(10)
    expect(screen.getByLabelText('테스트회원B 적용 핸디')).toHaveValue(25)
    expect(screen.getByLabelText('테스트회원B 득점')).toHaveValue(20)
  })

  it('값을 고쳐도 "다음"을 누르기 전에는 아무것도 저장되지 않는다', () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('테스트회원A 득점'), { target: { value: '19' } })

    expect(storedGame().scoreA).toBe(10)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })

  it('입력 점수가 그 경기의 적용 핸디를 넘으면 비교 화면으로 넘어가지 않고 안내한다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '21' })

    expect(screen.getByText('입력 점수는 이 경기의 적용 핸디를 초과할 수 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '변경 확정' })).not.toBeInTheDocument()
    expect(storedGame().scoreA).toBe(10)
  })

  it('적용 핸디를 올리면 그 핸디까지의 점수는 통과한다(핸디를 올려 친 경우)', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 적용 핸디': '22', '테스트회원A 득점': '22' })

    expect(screen.getByRole('button', { name: '변경 확정' })).toBeInTheDocument()
  })
})

describe('CompletedGameEditor — 2단계: 변경 전/후 비교', () => {
  it('비교 화면에 날짜·선수·핸디·점수·승자가 전 → 후로 표시된다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '19' })

    expect(screen.getByText('🔎 이렇게 바꿀까요?')).toBeInTheDocument()
    expect(screen.getByText('2026-07-10')).toBeInTheDocument()
    expect(screen.getByText('테스트회원A vs 테스트회원B')).toBeInTheDocument()
    expect(screen.getByText('테스트회원A 점수')).toBeInTheDocument()
    expect(screen.getByText('테스트회원A 적용 핸디')).toBeInTheDocument()
    expect(screen.getByText('승자')).toBeInTheDocument()
    // 승자 전(B) → 후(A) 가 모두 보여야 한다
    expect(screen.getAllByText('테스트회원B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('테스트회원A').length).toBeGreaterThan(0)
  })

  it('비교 화면을 보는 동안에도 아직 저장되지 않는다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '19' })

    expect(screen.getByRole('button', { name: '변경 확정' })).toBeInTheDocument()
    expect(storedGame().scoreA).toBe(10)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })

  it('"변경 확정"을 눌러야 저장되고 서버에 올라간다', async () => {
    const { onDone } = renderEditor()
    editAndGoConfirm({ '테스트회원A 적용 핸디': '22', '테스트회원A 득점': '21' })
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalledTimes(1))
    expect(storedGame().handicapA).toBe(22)
    expect(storedGame().scoreA).toBe(21)
    expect(onDone).toHaveBeenCalled()
  })

  it('"다시 고치기"를 누르면 입력 화면으로 돌아가고 저장하지 않는다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '19' })
    fireEvent.click(screen.getByRole('button', { name: '다시 고치기' }))

    expect(screen.getByLabelText('테스트회원A 득점')).toHaveValue(19)
    expect(storedGame().scoreA).toBe(10)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
  })

  it('비교 화면에서 "취소"를 누르면 저장하지 않고 닫는다', () => {
    const { onDone } = renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '19' })
    fireEvent.click(screen.getByRole('button', { name: '취소' }))

    expect(storedGame().scoreA).toBe(10)
    expect(uploadToCloudMock).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })
})

describe('CompletedGameEditor — 승자 재계산(달성률 기준 유지)', () => {
  it('수정 후 승자가 달성률 기준으로 다시 계산된다', async () => {
    // 수정 전: A 10/20(50%) vs B 20/25(80%) → B 승
    expect(winnerId(storedGame())).toBe('m2')
    renderEditor()
    editAndGoConfirm({ '테스트회원A 득점': '19' }) // A 19/20(95%) vs B 20/25(80%) → A 승
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(winnerId(storedGame())).toBe('m1')
  })

  it('원점수가 낮아도 달성률이 높으면 이긴다(원점수 비교로 바뀌지 않았다)', async () => {
    renderEditor()
    // A 18/20 = 90%, B 19/25 = 76% → 원점수는 B가 높지만 달성률은 A가 높다
    editAndGoConfirm({ '테스트회원A 득점': '18', '테스트회원B 득점': '19' })
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(storedGame().scoreA).toBe(18)
    expect(storedGame().scoreB).toBe(19)
    expect(winnerId(storedGame())).toBe('m1')
  })

  it('달성률이 같아지면 기존 규칙대로 무승부가 된다', async () => {
    renderEditor()
    // A 10/20 = 50%, B 12/24 = 50%
    editAndGoConfirm({ '테스트회원B 적용 핸디': '24', '테스트회원B 득점': '12' })
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(winnerId(storedGame())).toBeNull()
  })

  it('과거 CSV 임포트 경기의 명시적 승자가 남아 새 결과와 어긋나지 않는다', async () => {
    const imported = makeGame({ winnerId: 'm2' })
    useApp.setState({ sessions: [session([imported])] })
    expect(winnerId(storedGame())).toBe('m2')

    renderEditor(imported)
    editAndGoConfirm({ '테스트회원A 득점': '20', '테스트회원B 득점': '10' })
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    expect(storedGame().winnerId).toBeUndefined()
    expect(winnerId(storedGame())).toBe('m1')
  })
})

describe('CompletedGameEditor — 기본 핸디 대비 적용 핸디', () => {
  it('기본 핸디보다 높은 적용 핸디는 경고 없이 그대로 진행된다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 적용 핸디': '22' }) // 기본 20 → 22

    expect(screen.getByRole('button', { name: '변경 확정' })).toBeInTheDocument()
    expect(screen.queryByText(/낮춰 진행합니다/)).not.toBeInTheDocument()
  })

  it('기본 핸디보다 낮은 적용 핸디는 비교 화면에서 확인 문구를 보여준다', () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 적용 핸디': '18' }) // 기본 20 → 18

    expect(screen.getByText(/현재 기본 핸디는 20입니다\./)).toBeInTheDocument()
    expect(screen.getByText(/적용 핸디를 18로 낮춰 진행합니다/)).toBeInTheDocument()
    // 확인 문구를 보여줄 뿐 저장을 막지는 않는다 — 관리자가 확정을 눌러야 저장된다
    expect(screen.getByRole('button', { name: '변경 확정' })).toBeInTheDocument()
    expect(storedGame().handicapA).toBe(20)
  })
})

describe('CompletedGameEditor — 회원 핸디 보존', () => {
  it('경기 적용 핸디를 고쳐도 회원의 현재 핸디와 이력은 그대로다', async () => {
    renderEditor()
    editAndGoConfirm({ '테스트회원A 적용 핸디': '22' })
    fireEvent.click(screen.getByRole('button', { name: '변경 확정' }))

    await waitFor(() => expect(uploadToCloudMock).toHaveBeenCalled())
    const m1 = useApp.getState().members.find((m) => m.id === 'm1')!
    expect(m1.handicap).toBe(20)
    expect(m1.handicapHistory).toHaveLength(1)
  })
})
