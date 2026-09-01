import { useEffect, useRef, useState } from 'react'
import { useApp } from '../../store/appStore'
import { useAdminAuthStore } from '../../store/adminAuthStore'
import { AdminAuthLogin } from './AdminAuthLogin'
import { fetchTournaments } from '../../lib/tournamentSync'
import { buildNov29ImportPlan, evaluateNov29ApplyEligibility } from '../../lib/tournamentNov29Import'
import type { Nov29ApplyResult, Nov29ImportPlan, Nov29ImportSpec } from '../../lib/tournamentNov29Import'
import { applyNov29ImportLive } from '../../lib/tournamentNov29ApplyFirestore'
import type { AppState } from '../../types'

const APPLY_CONFIRM_PHRASE = '2025-11-29 대회 적용'

/**
 * 관리자 전용 "2025-11-29 과거 대회 가져오기" 카드 (설정 탭, 관리자 로그인 시에만 보인다).
 *
 * 2026-04-18 카드(TournamentApr18ImportCard)와 완전히 같은 패턴이다 — 다만 대회가 1개뿐이다.
 * 실제 선수명·점수는 이 파일에 전혀 없다. 관리자가 로컬 JSON 파일을 직접 선택해서 불러온다.
 *
 * "실제 적용" 버튼은 evaluateNov29ApplyEligibility()가 요구하는 모든 조건(회원 매핑 15/15,
 * 대회·경기 중복 0, 실제 경기 15·부전진출 1, 관리자 인증)을 만족할 때만 활성화되고, 누르면
 * 즉시 쓰지 않고 확인 문구를 정확히 입력해야 실행된다.
 */
export function TournamentNov29ImportCard() {
  const status = useAdminAuthStore((s) => s.status)
  const adminUid = useAdminAuthStore((s) => s.uid)

  const [spec, setSpec] = useState<Nov29ImportSpec | null>(null)
  const [fileError, setFileError] = useState('')
  const [plan, setPlan] = useState<Nov29ImportPlan | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [applyResult, setApplyResult] = useState<Nov29ApplyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const unsubscribe = useAdminAuthStore.getState().init()
    return unsubscribe
  }, [])

  if (status !== 'authorizedAdmin') {
    return (
      <div className="card col-card">
        <span style={{ fontWeight: 600, fontSize: 14 }}>🗄 2025-11-29 과거 대회 가져오기</span>
        <span className="muted" style={{ lineHeight: 1.5 }}>
          이 기능을 쓰려면 관리자 로그인이 필요합니다.
        </span>
        <AdminAuthLogin />
      </div>
    )
  }

  const onSelectFile = async (file: File | undefined) => {
    setFileError(''); setPlan(null); setMessage(''); setApplyResult(null); setConfirmText('')
    if (!file) { setSpec(null); return }
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as Nov29ImportSpec
      if (!parsed.participants || !parsed.tournament) {
        throw new Error('shape')
      }
      setSpec(parsed)
    } catch {
      setSpec(null)
      setFileError('파일을 읽지 못했습니다. 대진 데이터가 담긴 JSON 파일인지 확인해 주세요.')
    }
  }

  const onPreview = async () => {
    if (!spec) return
    setBusy(true); setMessage(''); setPlan(null); setApplyResult(null); setConfirmText('')
    try {
      const state = useApp.getState() as unknown as AppState
      const existingTournaments = await fetchTournaments()
      const result = buildNov29ImportPlan(spec, {
        members: state.members,
        existingSessions: state.sessions,
        existingTournaments,
      })
      setPlan(result)
      setMessage(
        result.ok
          ? '검증을 통과했습니다. 아래 결과를 확인해 주세요. (서버에는 아직 아무것도 저장하지 않았습니다.)'
          : '검증에서 문제를 발견했습니다. 아래 목록을 확인해 주세요. (서버에는 아무것도 저장하지 않았습니다.)',
      )
    } catch {
      setFileError('중복 검사를 위한 대회 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
    } finally { setBusy(false) }
  }

  const eligibility = plan ? evaluateNov29ApplyEligibility(plan, status === 'authorizedAdmin') : null
  const canApply = !!eligibility?.eligible && confirmText === APPLY_CONFIRM_PHRASE && !busy && !applyResult?.ok

  const onApply = async () => {
    if (!plan || !eligibility?.eligible || !adminUid) return
    if (!window.confirm(
      `실제 운영 데이터에\n대회 1개와 실제 경기 ${plan.actualGameCount}건을 추가합니다.\n`
      + `부전진출 ${plan.byeCount}건은 대진표에만 표시되고\n회원 경기 실적에는 포함되지 않습니다.\n\n계속할까요?`,
    )) return

    setBusy(true); setMessage(''); setApplyResult(null)
    try {
      const result = await applyNov29ImportLive(spec!, adminUid)
      setApplyResult(result)
      if (result.ok) {
        setConfirmText('')
        setMessage(`적용을 완료했습니다. (실제 경기 ${result.summary?.actualGames}건, 부전진출 ${result.summary?.byeAdvances}건)`)
      } else {
        setFileError(result.message)
      }
    } catch {
      setFileError('적용 중 오류가 발생했습니다. 운영 데이터가 바뀌지 않았을 수 있으니, 검증 미리보기부터 다시 확인해 주세요.')
    } finally { setBusy(false) }
  }

  return (
    <div className="card col-card">
      <span style={{ fontWeight: 600, fontSize: 14 }}>🗄 2025-11-29 과거 대회 가져오기</span>
      <span className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        제1회 성균관대학교 부산동문 회장배 당구대회(개인전)의 과거 대진 데이터를 정식 대회·경기
        기록으로 등록합니다. 선수명·점수 원본은 이 화면에서 직접 선택하는 로컬 JSON 파일에만
        있고, 앱에는 저장되어 배포되지 않습니다.
      </span>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>① 대진 데이터 파일 선택</div>
        <input
          ref={fileInputRef}
          type="file" accept="application/json"
          style={{ marginTop: 8 }}
          onChange={(e) => void onSelectFile(e.target.files?.[0])}
        />
        {spec && <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 6 }}>파일을 불러왔습니다.</span>}
      </div>

      {spec && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>② 검증 미리보기 (dry-run — 저장하지 않음)</div>
          <button className="primary block" style={{ marginTop: 8 }} disabled={busy} onClick={() => void onPreview()}>
            {busy ? '확인 중...' : '검증 미리보기 실행'}
          </button>
        </div>
      )}

      {plan && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>미리보기 결과</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>회원 이름 매핑</span>
            <span style={{ fontWeight: 600 }}>{plan.mapping.mappedCount} / {plan.mapping.totalCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>실제 경기</span>
            <span style={{ fontWeight: 600 }}>{plan.actualGameCount}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span>부전승/부전진출(경기 실적 미포함)</span>
            <span style={{ fontWeight: 600 }}>{plan.byeCount}건</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
            <span>검사 결과</span>
            <span style={{ fontWeight: 600, color: plan.ok ? 'var(--green-dark)' : '#c0392b' }}>
              {plan.ok ? '통과 — 적용 가능한 상태' : '문제 있음 — 적용 불가'}
            </span>
          </div>

          {plan.issues.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {plan.issues.map((issue, i) => (
                <div key={i} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {issue}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {plan && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>③ 실제 적용</div>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 4 }}>
            실제 운영 데이터에 대회 1개와 실제 경기 {plan.actualGameCount}건을 추가합니다.
            부전진출 {plan.byeCount}건은 대진표에만 표시되고 회원 경기 실적에는 포함되지 않습니다.
          </span>

          {eligibility && !eligibility.eligible && (
            <div style={{ marginTop: 8 }}>
              {eligibility.reasons.map((reason, i) => (
                <div key={i} style={{ fontSize: 13, color: '#c0392b', marginTop: 4 }}>· {reason}</div>
              ))}
            </div>
          )}

          {eligibility?.eligible && !applyResult?.ok && (
            <>
              <span className="muted" style={{ fontSize: 13, lineHeight: 1.5, display: 'block', marginTop: 8 }}>
                실행하려면 아래 칸에 <b>{APPLY_CONFIRM_PHRASE}</b> 라고 정확히 입력해 주세요.
              </span>
              <input
                type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
                placeholder={APPLY_CONFIRM_PHRASE} aria-label="적용 확인 문구"
                style={{ width: '100%', marginTop: 6, fontSize: 15, padding: '10px 12px' }}
              />
            </>
          )}

          <button className="block" style={{ marginTop: 8 }} disabled={!canApply} onClick={() => void onApply()}>
            {busy ? '처리 중...' : applyResult?.ok ? '적용 완료됨' : '실제 적용'}
          </button>
        </div>
      )}

      {message && <span style={{ fontSize: 13, color: 'var(--green-dark)', lineHeight: 1.5 }}>{message}</span>}
      {fileError && <span style={{ fontSize: 13, color: '#c0392b', lineHeight: 1.5 }}>{fileError}</span>}
    </div>
  )
}
