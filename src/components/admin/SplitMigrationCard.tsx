import { useEffect, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { AdminAuthLogin } from './AdminAuthLogin'
import {
  MIGRATION_CONFIRM_PHRASE, prepareMigration, runAdminMigration, verifyMigration,
} from '../../lib/migration'
import type { MigrationPlan, MigrationVerification } from '../../lib/migration'
import type { AppState } from '../../types'

/**
 * 관리자용 "새 구조로 데이터 복사" 카드 (설정 탭).
 *
 * 이 화면은 기존 데이터를 옮기거나 지우지 않는다 — 지금 쓰고 있는 저장 공간은 그대로 두고,
 * 같은 내용을 새 저장 구조에 한 벌 더 복사해 둔다. 그래서 문제가 생겨도 기존 데이터는 안전하다.
 *
 * 안전장치:
 *  1. Firebase 관리자 로그인이 확인돼야 실행 단계에 들어갈 수 있다(기기 PIN으로는 안 된다).
 *  2. 미리보기를 먼저 돌려 검증을 통과해야 실제 복사 버튼이 켜진다.
 *  3. 실제 복사는 확인 문구를 정확히 입력해야 실행된다.
 *  4. 화면에는 회원 이름·경기 내용 같은 실제 값을 표시하지 않고 개수만 보여준다.
 */
export function SplitMigrationCard() {
  const status = useAdminAuthStore((s) => s.status)
  const adminUid = useAdminAuthStore((s) => s.uid)

  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [copied, setCopied] = useState<{ documentCount: number } | null>(null)
  const [verification, setVerification] = useState<MigrationVerification | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  if (status !== 'authorizedAdmin') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>🗂️ 새 구조로 데이터 복사</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>
          이 기능을 쓰려면 관리자 로그인이 필요합니다.
          (관리자 번호(PIN)만으로는 실행할 수 없습니다.)
        </span>
        <AdminAuthLogin />
      </div>
    )
  }

  // 미리보기는 계산만 한다 — 서버에 아무것도 저장하지 않는다.
  const onDryRun = () => {
    setBusy(true); setMessage(''); setErrorMessage(''); setCopied(null); setVerification(null)
    try {
      const state = useApp.getState() as unknown as AppState
      setPlan(prepareMigration(state))
      setMessage('미리보기를 마쳤습니다. 아래 숫자를 확인해 주세요. (서버에는 아직 아무것도 저장하지 않았습니다.)')
    } catch {
      setPlan(null)
      setErrorMessage('미리보기를 하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const onCopy = async () => {
    if (!window.confirm(
      '지금 쓰는 데이터는 그대로 두고, 같은 내용을 새 저장 구조에 복사합니다.\n'
      + '기존 데이터는 지워지지 않습니다.\n\n계속할까요?',
    )) return

    setBusy(true); setMessage(''); setErrorMessage(''); setVerification(null)
    try {
      const state = useApp.getState() as unknown as AppState
      const result = await runAdminMigration(state, { adminUid, confirmPhrase: confirmText })
      if (!result.written) {
        setErrorMessage(result.skippedReason ?? '복사하지 않았습니다.')
        return
      }
      setCopied({ documentCount: result.documentCount })
      setConfirmText('')
      setMessage(`복사를 마쳤습니다. (${result.documentCount}건) 아래에서 확인을 눌러 제대로 복사됐는지 확인해 주세요.`)
    } catch {
      // 도중에 실패해도 기존 데이터는 그대로다. 같은 내용으로 다시 실행하면 덮어써서 복구된다.
      setErrorMessage(
        '복사 도중 문제가 생겨 일부만 저장됐을 수 있습니다. 기존 데이터는 그대로이니 안심하셔도 됩니다.'
        + ' 인터넷 연결을 확인한 뒤 같은 순서로 다시 실행해 주세요.',
      )
    } finally { setBusy(false) }
  }

  const onVerify = async () => {
    setBusy(true); setMessage(''); setErrorMessage('')
    try {
      const state = useApp.getState() as unknown as AppState
      const result = await verifyMigration(state)
      setVerification(result)
      setMessage(result.ok ? '확인을 마쳤습니다. 새 구조에 제대로 복사됐습니다.' : '확인 결과 맞지 않는 부분이 있습니다.')
    } catch {
      setErrorMessage('확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const validationOk = plan?.validation.ok === true
  const canCopy = validationOk && confirmText === MIGRATION_CONFIRM_PHRASE && !busy

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🗂️ 새 구조로 데이터 복사</span>
      <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        지금 쓰는 데이터는 그대로 두고, 같은 내용을 새 저장 구조에 한 벌 더 복사합니다.
        기존 데이터는 지워지지 않으며, 앱 사용 방식도 달라지지 않습니다.
      </span>

      {/* ① 미리보기 */}
      <button className="primary block" disabled={busy} onClick={onDryRun}>
        {busy ? '처리 중...' : '① 미리보기 (저장하지 않음)'}
      </button>

      {plan && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>미리보기 결과</div>
          <CountRow label="회원" legacy={plan.validation.counts.members.legacy} split={plan.validation.counts.members.split} />
          <CountRow label="이름 찾기 목록" legacy={plan.validation.counts.memberIndex.legacy} split={plan.validation.counts.memberIndex.split} />
          <CountRow label="모임" legacy={plan.validation.counts.sessions.legacy} split={plan.validation.counts.sessions.split} />
          <CountRow label="경기" legacy={plan.validation.counts.games.legacy} split={plan.validation.counts.games.split} />
          <CountRow label="회계" legacy={plan.validation.counts.ledger.legacy} split={plan.validation.counts.ledger.split} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>새로 만들어질 문서</span><span style={{ fontWeight: 600 }}>{plan.documentCounts.total}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>검사 결과</span>
            <span style={{ fontWeight: 600, color: validationOk ? 'var(--green-dark)' : '#c0392b' }}>
              {validationOk ? '통과' : '문제 있음'}
            </span>
          </div>
          {plan.validation.issues.map((issue) => (
            <div key={issue} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {issue}</div>
          ))}
        </div>
      )}

      {/* ② 실제 복사 — 검사를 통과했을 때만 보여준다 */}
      {validationOk && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>② 실제 복사</div>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 4 }}>
            실행하려면 아래 칸에 <b>{MIGRATION_CONFIRM_PHRASE}</b> 라고 정확히 입력해 주세요.
          </span>
          <input
            type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
            placeholder={MIGRATION_CONFIRM_PHRASE} aria-label="확인 문구"
            style={{ width: '100%', marginTop: 6, fontSize: 15, padding: '10px 12px' }}
          />
          <button className="primary block" style={{ marginTop: 8 }} disabled={!canCopy} onClick={() => void onCopy()}>
            {busy ? '처리 중...' : '새 구조에 복사하기'}
          </button>
        </div>
      )}

      {/* ③ 복사 후 확인 */}
      {copied && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>③ 복사 후 확인</div>
          <button className="block" style={{ marginTop: 8 }} disabled={busy} onClick={() => void onVerify()}>
            {busy ? '처리 중...' : '제대로 복사됐는지 확인하기'}
          </button>
        </div>
      )}

      {verification && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>확인 결과</div>
          <CountRow label="회원" legacy={verification.counts.members.legacy} split={verification.counts.members.split} />
          <CountRow label="이름 찾기 목록" legacy={verification.counts.memberIndex.legacy} split={verification.counts.memberIndex.split} />
          <CountRow label="모임" legacy={verification.counts.sessions.legacy} split={verification.counts.sessions.split} />
          <CountRow label="경기" legacy={verification.counts.games.legacy} split={verification.counts.games.split} />
          <CountRow label="회계" legacy={verification.counts.ledger.legacy} split={verification.counts.ledger.split} />
          <CountRow label="설정" legacy={verification.counts.config.legacy} split={verification.counts.config.split} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>빠진 항목</span><span style={{ fontWeight: 600 }}>{verification.missing}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>맞지 않는 항목</span><span style={{ fontWeight: 600 }}>{verification.mismatched}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>최종 판정</span>
            <span style={{ fontWeight: 600, color: verification.ok ? 'var(--green-dark)' : '#c0392b' }}>
              {verification.ok ? '정상' : '문제 있음'}
            </span>
          </div>
          {verification.issues.map((issue) => (
            <div key={issue} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {issue}</div>
          ))}
        </div>
      )}

      {message && <span style={{ fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.5 }}>{message}</span>}
      {errorMessage && <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>{errorMessage}</span>}
    </div>
  )
}

/** "회원   24 → 24" 처럼 개수만 보여주는 한 줄. 실제 값(이름 등)은 표시하지 않는다. */
function CountRow({ label, legacy, split }: { label: string; legacy: number; split: number }) {
  const same = legacy === split
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600, color: same ? undefined : '#c0392b' }}>
        {legacy} → {split}
      </span>
    </div>
  )
}
