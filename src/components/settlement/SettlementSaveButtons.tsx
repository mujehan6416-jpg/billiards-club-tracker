import { useSettlementSaveActions } from './useSettlementSaveActions'

// 지출·회식비 탭에서는 지금까지 "임시저장"/"최종 게시" 버튼이 전혀 없었다 — 참가자 탭(DuesTable)
// 이나 별도 "Firestore 동기화 테스트" 패널까지 가야만 실제로 저장됐다. 그래서 관리자가 지출·
// 회식비를 입력하고 "지출 추가"/"회식비 추가"만 누른 뒤(로컬 store에만 반영됨) 재로그인하면
// Firestore에는 그 내용이 전혀 저장돼 있지 않아 사라진 것처럼 보였다. 이 컴포넌트는 그 탭들에도
// 같은 저장 버튼을 붙여준다 — previewMode에서는 DuesTable과 동일하게 실제 저장을 차단한다.
export function SettlementSaveButtons({ settlementId, previewMode = false, locked }: {
  settlementId: string
  previewMode?: boolean
  locked: boolean
}) {
  const { doSaveDraft, doConfirm, syncStatus, saveMsg } = useSettlementSaveActions(settlementId, previewMode)

  return (
    <div className="card col-card">
      {previewMode && (
        <p className="info-msg" style={{ background: '#fff8e1', color: '#7a5c00' }}>
          ⚠ 개발 미리보기에서는 저장되지 않습니다. 아래 버튼은 실제 Firestore에 반영되지 않습니다.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={previewMode || syncStatus === 'saving'} onClick={doSaveDraft} style={{ whiteSpace: 'nowrap' }}>
          임시저장
        </button>
        <button type="button" className="primary" disabled={previewMode || syncStatus === 'saving' || locked} onClick={doConfirm} style={{ whiteSpace: 'nowrap' }}>
          최종 게시
        </button>
      </div>
      {!previewMode && saveMsg && <p className="muted" style={{ fontSize: 12 }}>{saveMsg}</p>}
    </div>
  )
}
