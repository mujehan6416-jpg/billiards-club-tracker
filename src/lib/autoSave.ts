import { useApp } from '../store/appStore'
import { uploadToCloud, UploadCancelledError } from './cloudSync'

/**
 * 변경 직후 현재 앱 상태 전체를 서버에 올린다(회원 추가·수정, CSV 불러오기 등 자동 저장용).
 *
 * zustand의 set()은 동기적으로 반영되므로, 상태를 바꾼 "직후"에 이 함수를 부르면 항상 최신
 * 상태가 올라간다 — 화면 컴포넌트가 들고 있는 (한 박자 늦은) props/구독 값이 아니라
 * useApp.getState()로 그때그때 최신 값을 읽는다. 앱의 다른 자동 저장 경로(경기 저장 등)와
 * 완전히 같은 방식이다.
 *
 * 다른 기기와의 충돌 방지(덮어쓰기 확인창)는 uploadToCloud 안에 있는 기존 장치를 그대로 쓴다 —
 * 여기서 Firestore에 직접 쓰지 않는다.
 *
 * 반환값: 성공하면 null, 실패하면 그대로 화면에 보여줄 수 있는 안내 문구.
 */
export async function saveToServer(): Promise<string | null> {
  try {
    const s = useApp.getState()
    await uploadToCloud({ members: s.members, sessions: s.sessions, settings: s.settings, ledger: s.ledger })
    return null
  } catch (e) {
    if (e instanceof UploadCancelledError) {
      return '서버 저장을 취소했습니다. 변경한 내용은 이 기기에만 저장되었습니다.'
    }
    return '변경한 내용은 이 기기에 저장됐지만 서버에 반영하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'
  }
}
