export const MIN_NEW_PASSWORD_LENGTH = 8;
export const MAX_NEW_PASSWORD_LENGTH = 72;

export const NEW_PASSWORD_LENGTH_ERROR = '비밀번호는 8자 이상 72자 이하여야 합니다';
export const NEW_PASSWORD_LENGTH_HINT = '8자 이상 72자 이하로 입력해주세요.';

export function isAcceptableNewPasswordLength(password: string) {
  return password.length >= MIN_NEW_PASSWORD_LENGTH
    && password.length <= MAX_NEW_PASSWORD_LENGTH;
}
