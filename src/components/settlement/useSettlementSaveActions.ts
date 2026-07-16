import { useState } from 'react'
import { useSettlementStore } from '../../store/settlementStore'
import { useAuth } from '../../store/authStore'

// 정산의 어느 탭(지출/회식비 등)에서 편집하든 "임시저장"/"최종 게시"를 누를 수 있게 하는 공용 훅.
// DuesTable.tsx(참가자 탭)에는 이미 같은 목적의 자체 구현이 있다 — 이번 버그 수정 범위가
// "회비·찬조 표 추가 수정 금지"라 그 파일은 건드리지 않고, 이 훅을 새로 만들어 지출·회식비
// 폼에서만 재사용한다. saveDraft/confirmSettlement 액션 자체(동작·상태값)는 그대로다.
export function useSettlementSaveActions(settlementId: string, previewMode: boolean) {
  const saveDraft = useSettlementStore((s) => s.saveDraft)
  const confirmSettlement = useSettlementStore((s) => s.confirmSettlement)
  const syncStatus = useSettlementStore((s) => s.syncStatus)
  const { memberName } = useAuth()
  const [saveMsg, setSaveMsg] = useState('')
  const actorDisplayName = memberName ?? '관리자'

  const doSaveDraft = async () => {
    if (previewMode) return // 이중 방어 — 버튼은 비활성화돼 있지만, 혹시라도 호출되면 여기서도 막는다.
    setSaveMsg('저장 중...')
    const res = await saveDraft(settlementId)
    setSaveMsg(res.ok ? '임시저장 완료' : res.error)
  }

  const doConfirm = async () => {
    if (previewMode) return
    if (!window.confirm('정산을 최종 게시할까요? 게시 후에는 표를 수정할 수 없습니다.')) return
    setSaveMsg('저장 중...')
    const res = await confirmSettlement(settlementId, actorDisplayName)
    setSaveMsg(res.ok ? '최종 게시 완료' : res.error)
  }

  return { doSaveDraft, doConfirm, syncStatus, saveMsg }
}
