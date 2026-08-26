import { describe, it, expect } from 'vitest'
import { deviceCode, DEVICE_CODE_LENGTH } from '../src/lib/deviceCode'

// 아래 UID는 전부 테스트용 가상 값이며 실제 기기 인증 정보가 아니다.

describe('deviceCode — 기기 연결 진단용 짧은 코드', () => {
  it('앞 8자리만 보여준다', () => {
    expect(deviceCode('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefgh')
    expect(DEVICE_CODE_LENGTH).toBe(8)
  })

  it('전체 UID를 그대로 내보내지 않는다', () => {
    const uid = 'abcdefghijklmnopqrstuvwxyz'
    const code = deviceCode(uid)
    expect(code).not.toBe(uid)
    expect(code.length).toBe(8)
    expect(uid.startsWith(code)).toBe(true)
  })

  it('대소문자를 바꾸지 않는다 — 바꾸면 서로 다른 기기가 같은 코드로 보일 수 있다', () => {
    expect(deviceCode('AbCdEfGh1234')).toBe('AbCdEfGh')
    expect(deviceCode('abcdefgh1234')).not.toBe(deviceCode('ABCDEFGH1234'))
  })

  it('UID가 없으면 사람이 읽을 수 있는 안내 문구를 준다', () => {
    expect(deviceCode(null)).toBe('알 수 없음')
    expect(deviceCode(undefined)).toBe('알 수 없음')
    expect(deviceCode('')).toBe('알 수 없음')
  })

  it('8자리보다 짧은 값은 있는 만큼만 보여준다', () => {
    expect(deviceCode('abc')).toBe('abc')
  })

  it('서로 다른 기기는 서로 다른 코드로 보인다', () => {
    // 실제 Firebase 익명 UID는 28자 무작위 문자열이라 앞 8자리가 겹칠 일이 사실상 없다.
    expect(deviceCode('xK3mP9qR2sT5vW8yZ1aB4cD6eF7g')).not.toBe(deviceCode('bQ7nT4uW6xZ9aC2dE5fG8hJ1kL3m'))
  })

  it('앞 8자리가 같은 값끼리는 같은 코드가 된다 — 눈으로 맞춰보는 용도라는 한계', () => {
    // 이 함수는 "이 기기가 그 기기인지" 눈으로 확인하는 보조 수단일 뿐, 기기를 정확히
    // 식별하는 값이 아니다. 실제 권한 판정은 언제나 전체 UID로 서버(Rules)에서 한다.
    expect(deviceCode('samePREFIX-aaaa')).toBe(deviceCode('samePREFIX-bbbb'))
  })
})
