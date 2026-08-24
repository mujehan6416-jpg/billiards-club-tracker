import { useState } from 'react'
import { useApp } from '../../store/appStore'
import { uploadToCloud, UploadCancelledError } from '../../lib/cloudSync'
import { validateGameResult, winnerId } from '../../logic/game'
import type { Game } from '../../types'

/** 승자 표시용 이름 (무승부는 null → '무승부'). */
function winnerText(game: Game, nameOf: (id: string) => string): string {
  const w = winnerId(game)
  return w === null ? '무승부' : nameOf(w)
}

/** 변경 전 → 변경 후 한 줄. 값이 그대로면 화살표 없이 한 번만 보여준다. */
function DiffRow({ label, before, after }: { label: string; before: string; after: string }) {
  const changed = before !== after
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' }}>
      <span style={{ minWidth: 96, fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      {changed ? (
        <span style={{ fontSize: 15 }}>
          <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{before}</span>
          <span style={{ margin: '0 6px' }}>→</span>
          <span style={{ fontWeight: 700, color: '#0f6e56' }}>{after}</span>
        </span>
      ) : (
        <span style={{ fontSize: 15 }}>{before}</span>
      )}
    </div>
  )
}

/**
 * 이미 저장된 경기의 "적용 핸디 / 득점"을 관리자가 고치는 폼.
 *
 * 흐름: 입력 → 변경 전/후 비교 → 관리자가 "변경 확정"을 눌러야 저장. 수정 버튼을 누른 것만으로는
 * 아무것도 저장되지 않는다.
 *
 * 적용 핸디(Game.handicapA/handicapB)는 경기 시점 스냅샷이라 여기서 고쳐도 회원의 현재 핸디는
 * 바뀌지 않고, 다른 경기의 과거 핸디에도 영향이 없다. 승패·달성률·승률·상대전적은 저장된 값이
 * 아니라 경기 데이터에서 매번 다시 계산되므로(logic/stats.ts) 별도 통계 갱신 처리는 하지 않는다.
 * 승자는 관리자가 고르지 않고 기존 달성률 판정(logic/game.ts의 winnerId)으로 자동 계산한다.
 */
export function CompletedGameEditor({ game, sessionId, sessionDate, nameOf, onDone }: {
  game: Game
  sessionId: string
  sessionDate: string
  nameOf: (id: string) => string
  onDone: () => void
}) {
  const updateGameResult = useApp((s) => s.updateGameResult)
  const members = useApp((s) => s.members)
  const [handicapA, setHandicapA] = useState(String(game.handicapA))
  const [scoreA, setScoreA] = useState(String(game.scoreA))
  const [handicapB, setHandicapB] = useState(String(game.handicapB))
  const [scoreB, setScoreB] = useState(String(game.scoreB))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  /** 'edit' = 입력 중, 'confirm' = 변경 전/후 비교 확인 중 */
  const [step, setStep] = useState<'edit' | 'confirm'>('edit')
  const [pending, setPending] = useState<{ handicapA: number; scoreA: number; handicapB: number; scoreB: number } | null>(null)

  const nameA = nameOf(game.playerAId)
  const nameB = nameOf(game.playerBId)
  const baseHandicapOf = (id: string) => members.find((m) => m.id === id)?.handicap

  const goConfirm = () => {
    const checked = validateGameResult({ handicapA, scoreA, handicapB, scoreB })
    if (!checked.ok) { setError(checked.message); return }
    setPending(checked.values)
    setStep('confirm')
  }

  const doSave = async () => {
    if (!pending) return
    setSaving(true)
    updateGameResult(sessionId, game.id, pending)
    // 다른 저장 경로(MeetingTab의 save 등)와 동일하게 저장 직후 서버에 반영한다.
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

  // ── 2단계: 변경 전 → 변경 후 비교 확인 ──────────────────────────────
  if (step === 'confirm' && pending) {
    // 저장하지 않고 "고쳤다면 이렇게 된다"는 가상 경기로 승자를 미리 계산한다.
    // updateGameResult와 똑같이 명시적 winnerId를 지운 상태로 판정해야 실제 저장 결과와 일치한다.
    const afterGame: Game = { ...game, ...pending }
    delete afterGame.winnerId

    const lowered = [
      { name: nameA, base: baseHandicapOf(game.playerAId), applied: pending.handicapA },
      { name: nameB, base: baseHandicapOf(game.playerBId), applied: pending.handicapB },
    ].filter((p) => p.base !== undefined && p.applied < p.base)

    return (
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 15 }}>🔎 이렇게 바꿀까요?</span>
        <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          아직 저장되지 않았습니다. 아래 내용을 확인한 뒤 <b>변경 확정</b>을 눌러 주세요.
        </span>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <DiffRow label="경기 날짜" before={sessionDate} after={sessionDate} />
          <DiffRow label="선수" before={`${nameA} vs ${nameB}`} after={`${nameA} vs ${nameB}`} />
          <DiffRow label={`${nameA} 적용 핸디`} before={String(game.handicapA)} after={String(pending.handicapA)} />
          <DiffRow label={`${nameA} 점수`} before={String(game.scoreA)} after={String(pending.scoreA)} />
          <DiffRow label={`${nameB} 적용 핸디`} before={String(game.handicapB)} after={String(pending.handicapB)} />
          <DiffRow label={`${nameB} 점수`} before={String(game.scoreB)} after={String(pending.scoreB)} />
          <DiffRow label="승자" before={winnerText(game, nameOf)} after={winnerText(afterGame, nameOf)} />
        </div>

        {lowered.length > 0 && (
          <div style={{ background: '#fff8e1', borderRadius: 8, padding: '10px 12px', fontSize: 14, lineHeight: 1.5 }}>
            {lowered.map((p) => (
              <div key={p.name}>
                ⚠ {p.name} 님의 현재 기본 핸디는 {p.base}입니다. 적용 핸디를 {p.applied}로 낮춰 진행합니다.
              </div>
            ))}
          </div>
        )}

        <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          승자는 바뀐 점수와 적용 핸디로 자동 계산됩니다. 회원의 현재 핸디는 바뀌지 않습니다.
        </span>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" style={{ flex: 1 }} disabled={saving} onClick={doSave}>
            {saving ? '저장 중...' : '변경 확정'}
          </button>
          <button style={{ flex: 1 }} disabled={saving} onClick={() => setStep('edit')}>다시 고치기</button>
          <button style={{ flex: 1 }} disabled={saving} onClick={onDone}>취소</button>
        </div>
      </div>
    )
  }

  // ── 1단계: 값 입력 ────────────────────────────────────────────────
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
        <button className="primary" style={{ flex: 1 }} onClick={goConfirm}>다음 (변경 내용 확인)</button>
        <button style={{ flex: 1 }} onClick={onDone}>취소</button>
      </div>
    </div>
  )
}
