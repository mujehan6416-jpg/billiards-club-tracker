/**
 * 기기 연결 진단용 "기기 코드".
 *
 * 기기 연결 승인은 그 기기의 서버 인증 정보(Firebase 익명 UID)를 기준으로 이뤄진다. 그래서
 * 회원이 요청을 보낸 기기와 관리자가 승인한 요청이 정말 같은 기기인지 눈으로 맞춰볼 수단이
 * 필요하다 — 이 함수는 그 확인에만 쓰는 짧은 코드를 만든다.
 *
 * 전체 UID는 절대 화면에 내보내지 않고 앞 8자리만 쓴다. 대소문자를 바꾸지 않는 것이 중요하다 —
 * UID는 대소문자를 구분하므로 임의로 통일하면 서로 다른 기기가 같은 코드로 보일 수 있다.
 */
export const DEVICE_CODE_LENGTH = 8

export function deviceCode(uid: string | null | undefined): string {
  if (!uid) return '알 수 없음'
  return uid.slice(0, DEVICE_CODE_LENGTH)
}
