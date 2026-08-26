import { useApp } from '../store/appStore'
import { uploadToCloud, UploadCancelledError } from './cloudSync'
import { USE_SPLIT_FIRESTORE, syncSplitChanges } from './splitFirestore'
import type { AppState } from '../types'

/**
 * 변경 직후 현재 앱 상태를 서버에 올린다(회원 추가·수정, CSV 불러오기 등 자동 저장용).
 *
 * zustand의 set()은 동기적으로 반영되므로, 상태를 바꾼 "직후"에 이 함수를 부르면 항상 최신
 * 상태가 올라간다 — 화면 컴포넌트가 들고 있는 (한 박자 늦은) props/구독 값이 아니라
 * useApp.getState()로 그때그때 최신 값을 읽는다. 앱의 다른 자동 저장 경로(경기 저장 등)와
 * 완전히 같은 방식이다.
 *
 * previous(상태를 바꾸기 직전의 useApp.getState() 스냅샷)를 넘기면, USE_SPLIT_FIRESTORE일 때
 * 그 직전 상태와 지금 상태를 비교해 바뀐 split 문서만 반영한다(syncSplitChanges). previous를
 * 넘기지 않거나 split이 꺼져 있으면 기존과 똑같이 legacy 전체 스냅샷(uploadToCloud)을 쓴다.
 *
 * ⚠ 이 함수는 관리자 화면 전용이다 — 일반회원 행동에는 쓰지 않는다(splitFirestore.ts의
 * syncSplitChanges 주석 참고).
 *
 * 다른 기기와의 충돌 방지(덮어쓰기 확인창)는 uploadToCloud 안에 있는 기존 장치를 그대로 쓴다 —
 * 여기서 Firestore에 직접 쓰지 않는다.
 *
 * 반환값: 성공하면 null, 실패하면 그대로 화면에 보여줄 수 있는 안내 문구.
 */
export async function saveToServer(previous?: AppState): Promise<string | null> {
  try {
    const s = useApp.getState()
    if (USE_SPLIT_FIRESTORE && previous) {
      await syncSplitChanges(previous, s)
    } else {
      await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
    }
    return null
  } catch (e) {
    if (e instanceof UploadCancelledError) {
      return '서버 저장을 취소했습니다. 변경한 내용은 이 기기에만 저장되었습니다.'
    }
    return '변경한 내용은 이 기기에 저장됐지만 서버에 반영하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  }
}
