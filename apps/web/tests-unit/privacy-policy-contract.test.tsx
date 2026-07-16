import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import {
  OFFICIAL_PRIVACY_AUTHORITY_LINKS,
  PRIVACY_POLICY_CONTENT_SHA256,
  PRIVACY_POLICY_DATABASE_BINDING,
  PRIVACY_POLICY_PUBLICATION,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_VERSION,
  isApprovedPolicyPublication,
  privacyPolicyHashInput,
} from '../lib/privacy/policy';
import { PROCESSING_INVENTORY, PROCESSING_INVENTORY_BY_CLASS } from '../lib/privacy/processing-inventory';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const policySource = () => source('lib/privacy/policy.ts');
const inventorySource = () => source('lib/privacy/processing-inventory.ts');
const policyContentSource = () => source('components/legal/PrivacyPolicyContent.tsx');
const dataDeletionSource = () => source('app/data-deletion/page.tsx');

const prohibitedClaims = [
  '법적 준수',
  '준법 인증',
  '신고 완료',
  '기관 접수 완료',
  '규제기관 승인',
  '규제기관 수리',
  '모든 개인정보가 즉시 영구 삭제',
  '모든 데이터가 즉시 삭제',
  '완벽한 삭제 보장',
] as const;

describe('G010 privacy policy publication contract', () => {
  test('keeps the Korean source as a draft until a matching deployed record has a nonempty operator approval reference', () => {
    expect(PRIVACY_POLICY_PUBLICATION.locale).toBe('ko-KR');
    expect(PRIVACY_POLICY_PUBLICATION.status).toBe('draft');
    expect(PRIVACY_POLICY_PUBLICATION.effectiveAt).toBeNull();
    expect(PRIVACY_POLICY_PUBLICATION.publishedAt).toBeNull();
    expect(PRIVACY_POLICY_PUBLICATION.operatorApprovalRef).toBeNull();
    expect(PRIVACY_POLICY_DATABASE_BINDING.table).toBe('privacy_policy_versions');
    expect(PRIVACY_POLICY_DATABASE_BINDING.contentHashColumn).toBe('content_sha256');
    expect(PRIVACY_POLICY_DATABASE_BINDING.operatorApprovalRefColumn).toBe('operator_approval_ref');

    expect(isApprovedPolicyPublication(null)).toBe(false);
    expect(isApprovedPolicyPublication({
      id: 'policy-row',
      version: PRIVACY_POLICY_VERSION,
      locale: 'ko-KR',
      status: 'published',
      content_sha256: PRIVACY_POLICY_CONTENT_SHA256,
      effective_at: '2026-07-12T00:00:00.000Z',
      published_at: '2026-07-12T00:00:00.000Z',
      operator_approval_ref: '   ',
    })).toBe(false);
  });

  test('uses one Korean-first document hash for embedded and public policy content', () => {
    expect(createHash('sha256').update(privacyPolicyHashInput(), 'utf8').digest('hex')).toBe(PRIVACY_POLICY_CONTENT_SHA256);
    expect(privacyPolicyHashInput()).toContain(OFFICIAL_PRIVACY_AUTHORITY_LINKS[0].href);
    expect(PRIVACY_POLICY_SECTIONS[0]?.title).toMatch(/^1\. 이 문서의 상태/);
    expect(policyContentSource()).toContain('data-policy-version={PRIVACY_POLICY_PUBLICATION.version}');
    expect(policyContentSource()).toContain('data-policy-content-sha256={PRIVACY_POLICY_CONTENT_SHA256}');
    expect(source('components/auth/AuthModal.tsx')).toContain('<PrivacyPolicyContent />');
    expect(source('app/privacy/page.tsx')).toContain('<PrivacyPolicyContent />');
    expect(dataDeletionSource()).toContain('PRIVACY_POLICY_CONTENT_SHA256');
    expect(dataDeletionSource()).toContain('PRIVACY_POLICY_PUBLICATION.version');
  });

  test('keeps every processing class machine-readable and publication-blocking until operator facts and readback exist', () => {
    expect(PROCESSING_INVENTORY.length).toBeGreaterThan(0);

    for (const item of PROCESSING_INVENTORY) {
      expect(item.dataClass).not.toHaveLength(0);
      expect(item.purpose).not.toHaveLength(0);
      expect(item.source).not.toHaveLength(0);
      expect(item.sink.length).toBeGreaterThan(0);
      expect(item.retention).toMatch(/미확정|승인 전|읽기검증 전/);
      expect(item.deletion).not.toHaveLength(0);
      expect(['observed_candidate_boundary', 'pending_operator_approval', 'blocked_until_deployed_readback']).toContain(item.operatorState);
    }

    expect(inventorySource()).not.toMatch(/\d+\s*(?:일|개월|년)/);
    expect(policySource()).not.toMatch(/(?:보유|보존).{0,50}\d+\s*(?:일|개월|년)/);
    expect(PROCESSING_INVENTORY_BY_CLASS.auth_identity.operatorState).toBe('blocked_until_deployed_readback');
  });

  test('does not make compliance, filing, regulator-acceptance, or guaranteed-deletion claims', () => {
    const renderedSources = [policySource(), inventorySource(), policyContentSource(), dataDeletionSource()].join('\n');

    for (const claim of prohibitedClaims) {
      expect(renderedSources).not.toContain(claim);
    }

    expect(policySource()).toContain('기관의 판단이나 이 문서의 법적 충분성을 뜻하지 않습니다.');
    expect(policySource()).toContain('모든 데이터의 삭제나 즉시 삭제를 말하지 않습니다.');
  });

  test('does not collect DOB or RRN and keeps age, required acknowledgement, and marketing choices distinct', () => {
    const consent = PROCESSING_INVENTORY_BY_CLASS.consent_age_marketing;
    const inventoryFields = PROCESSING_INVENTORY.flatMap((item) => item.fields).join(' ');

    expect(policySource()).toContain('생년월일(DOB)이나 주민등록번호(RRN)를 수집 항목으로 두지 않습니다.');
    expect(inventoryFields).not.toMatch(/생년월일|DOB|주민등록번호|RRN/);
    expect(consent.fields).toEqual(expect.arrayContaining(['최소 연령대', '필수 확인', '일반·야간 마케팅 채널별 선택·철회']));
    expect(policySource()).toContain('필수 확인은 선택 동의로 대체할 수 없고');
    expect(policySource()).toContain('만 14세 미만 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지 이용할 수 없습니다.');
    expect(policySource()).toContain('현재 운영 중이거나 법적 충분하다고 주장하지 않습니다.');
  });

  test('separates in-memory device location from persisted business coordinates', () => {
    const device = PROCESSING_INVENTORY_BY_CLASS.device_location;
    const business = PROCESSING_INVENTORY_BY_CLASS.business_location;

    expect(device.sink).toEqual(['현재 지도 React 메모리 상태']);
    expect(device.providerBoundary).toContain('브라우저 메모리');
    expect(device.providerBoundary).toContain('지도 SDK');
    expect(device.providerBoundary).toContain('네트워크·URL·분석·로그·브라우저 저장소·Supabase');
    expect(device.externalPrerequisite).toContain('운영자 공식 증적');
    expect(device.externalPrerequisite).toContain('배포 읽기검증');
    expect(device.externalPrerequisite).toContain('활성화하지 않습니다');
    expect(business.sink).toContain('Supabase 데이터베이스');
    expect(business.providerBoundary).toContain('기기 위치와 다른 데이터 종류');
    expect(policySource()).toContain('지도 SDK 렌더링');
    expect(policySource()).toContain('기기 위치는 브라우저 권한 후 수집한 좌표·정확도·방향 정보로, 지도 화면 표시를 위해 브라우저 메모리에만 사용됩니다.');
    expect(policySource()).toContain('기기 위치는 위치 처리 증적');
    expect(policyContentSource()).toContain('item.externalPrerequisite');
  });

  test('states itemized deletion limits, provider and backup boundaries, and raw-data-free support requests', () => {
    const deletionCopy = dataDeletionSource();

    expect(policySource()).toContain('삭제·익명화·분리·보존');
    expect(policySource()).toContain('제공자 로그·백업');
    expect(deletionCopy).toContain('미리보기 → 확인 → 적용 → 독립 읽기검증 → 영수증');
    expect(deletionCopy).toContain('삭제·익명화·분리·보존');
    expect(deletionCopy).toContain('비밀번호, 인증 토큰, 주민등록번호, 이미지 원본, 원시 OCR 결과, 정확한 위치');
    expect(deletionCopy).toContain('partial·failed');
  });

  test('links to official Korean privacy authorities', () => {
    const hrefs = OFFICIAL_PRIVACY_AUTHORITY_LINKS.map((link) => link.href);

    expect(hrefs).toContain('https://www.law.go.kr/LSW/lsInfoP.do?lsId=011357');
    expect(hrefs).toContain('https://www.pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=&nttId=12018');
    expect(hrefs).toContain('https://privacy.kisa.or.kr/');
    expect(hrefs).toContain('https://www.kopico.go.kr/');
    expect(policyContentSource()).toContain('OFFICIAL_PRIVACY_AUTHORITY_LINKS');
  });
});
