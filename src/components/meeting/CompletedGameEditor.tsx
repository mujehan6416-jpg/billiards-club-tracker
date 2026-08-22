import { useState } from 'react'
import { useApp } from '../../store/appStore'
import { uploadToCloud, UploadCancelledError } from '../../lib/cloudSync'
import { validateGameResult } from '../../logic/game'
import type { Game } from '../../types'

/**
 * 이미 저장된 경기의 "적용 핸디 / 득점"을 관리자가 고치는 폼.
 *
 * 적용 핸디(Game.handicapA/handicapB)는 경기 시점 스냅샷이라 여기서 고쳐도 회원의 현재 핸디는
 * 바뀌지 않고, 다른 경기의 과거 핸디에도 영향이 없다. 승패·달성률·승률·상대전적은 저장된 값이
 * 아니라 경기 데이터에서 매번 다시 계산되므로(logic/stats.ts) 별도 통계 갱신 처리는 하지 않는다.
 *
 * 입력 검증은 새 경기 저장(MeetingTab의 save)과 같은 validateGameResult를 쓴다.
 */
export function CompletedGameEditor({ game, sessionId, nameOf, onDone }: {
  game: Game
  sessionId: string
  nameOf: (id: string) => string
  onDone: () => void
}) {
  const updateGameResult = useApp((s) => s.updateGameResult)
  const [handicapA, setHandicapA] = useState(String(game.handicapA))
  const [scoreA, setScoreA] = useState(String(game.scoreA))
  const [handicapB, setHandicapB] = useState(String(game.handicapB))
  const [scoreB, setScoreB] = useState(String(game.scoreB))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const nameA = nameOf(game.playerAId)
  const nameB = nameOf(game.playerBId)

  const doSave = async () => {
    const checked = validateGameResult({ handicapA, scoreA, handicapB, scoreB })
    if (!checked.ok) { setError(checked.message); return }
    setSaving(true)
    updateGameResult(sessionId, game.id, checked.values)
    // 다른 저장 경로(MeetingTab의 save 등)와 동일하게 저장 직후 클라우드에 반영한다.
    try {
      const s = useApp.getState()
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
    } catch (err) {
      if (err instanceof UploadCancelledError) {
        alert('서버 저장을 취소했습니다.\n수정한 내용은 이 기기에만 저장되었습니다.')
      } else {
        alert('수정한 내용은 이 기기에 저장되었지만 서버 저장에 실패했습니다.\n인터넷 확인 후 설정 탭에서 "이 기기 내용을 서버에 올리기"를 눌러 주세요.')
      }
    }
    setSaving(false)
    onDone()
  }

  const playerRow = (
    name: string,
    hcap: string,
    setHcap: (v: string) => void,
    score: string,
    setScore: (v: string) => void,
  ) => (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
      <span style={{ flex: 1, fontSize: 15, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{name}</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--muted)' }}>
        적용 핸디
        <input
          type="number" min={1} inputMode="numeric" style={{ width: 72 }}
          aria-label={`${name} 적용 핸디`}
          value={hcap}
          onChange={(e) => { setHcap(e.target.value); setError('') }}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12, color: 'var(--muted)' }}>
        득점
        <input
          type="number" min={0} inputMode="numeric" style={{ width: 72 }}
          aria-label={`${name} 득점`}
          value={score}
          onChange={(e) => { setScore(e.target.value); setError('') }}
        />
      </label>
    </div>
  )

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontWeight: 600, fontSize: 15 }}>✏️ 경기 결과 수정</span>
      <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        이 경기에만 적용되는 핸디입니다. 회원의 현재 핸디는 바뀌지 않습니다.
      </span>
      {playerRow(nameA, handicapA, setHandicapA, scoreA, setScoreA)}
      {playerRow(nameB, handicapB, setHandicapB, scoreB, setScoreB)}
      {error && <span style={{ fontSize: 14, color: 'var(--danger)' }}>{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" style={{ flex: 1 }} disabled={saving} onClick={doSave}>
          {saving ? '저장 중...' : '수정 저장'}
        </button>
        <button style={{ flex: 1 }} disabled={saving} onClick={onDone}>취소</button>
      </div>
    </div>
  )
}
