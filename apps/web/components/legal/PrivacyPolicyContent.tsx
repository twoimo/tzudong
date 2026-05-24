import { memo } from "react";

import { siteConfig } from "@/lib/site-config";

export const PrivacyPolicyContent = memo(() => (
  <div className="space-y-4 text-sm">
    <section>
      <h3 className="font-semibold text-base mb-2">1. 개인정보의 수집 및 이용 목적</h3>
      <p className="text-muted-foreground">
        쯔동여지도(&apos;서비스&apos;)는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.
      </p>
      <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
        <li>회원 가입 및 관리: 회원 가입의사 확인, 회원제 서비스 제공에 따른 본인 식별·인증, 회원자격 유지·관리, 서비스 부정이용 방지</li>
        <li>서비스 제공: 맛집 정보 제공, 리뷰 작성 및 공유, 맛집 제보, 북마크 기능, 랭킹 서비스</li>
        <li>리뷰 인증: 영수증 사진을 통한 방문 인증 처리</li>
        <li>고충처리: 민원인의 신원 확인, 민원사항 확인, 사실조사를 위한 연락·통지, 처리결과 통보</li>
      </ul>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">2. 수집하는 개인정보 항목</h3>
      <h4 className="font-medium mt-3 mb-1">2-1. 회원가입 시 수집 항목</h4>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>필수: 이메일 주소, 비밀번호(단방향 암호화 저장), 닉네임</li>
        <li>Google 로그인 시: 이메일 주소, Google 계정 식별자</li>
      </ul>
      <h4 className="font-medium mt-3 mb-1">2-2. 서비스 이용 시 수집 항목</h4>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>리뷰 작성 시: 리뷰 제목, 리뷰 내용, 방문일, 음식 사진(선택), 영수증 사진(인증용)</li>
        <li>맛집 제보 시: 맛집 정보(상호명, 주소, 카테고리 등), YouTube 영상 URL</li>
        <li>영수증 인증 시: 영수증 이미지(OCR 처리 후 상호명, 날짜, 금액 추출)</li>
      </ul>
      <h4 className="font-medium mt-3 mb-1">2-3. 자동 수집 항목</h4>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>서비스 이용 기록, 접속 로그, 접속 IP 정보, 브라우저 종류</li>
        <li>쿠키(세션 유지 목적, 브라우저 설정에서 거부 가능)</li>
      </ul>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">3. 개인정보의 보유 및 이용기간</h3>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>회원 정보: 회원 탈퇴 시까지</li>
        <li>리뷰/제보 내역: 탈퇴 후 익명화하여 보관 (작성자 정보 분리)</li>
        <li>영수증 이미지: OCR 처리 완료 후 90일 이내 삭제</li>
        <li>접속 로그: 3개월 보관 후 파기 (통신비밀보호법 준수)</li>
      </ul>
      <p className="text-muted-foreground mt-2">
        단, 관계 법령 위반에 따른 수사·조사 등이 진행 중인 경우 해당 수사·조사 종료 시까지 보유합니다.
      </p>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">4. 회원 탈퇴 및 개인정보 파기</h3>
      <p className="text-muted-foreground mb-2">
        쯔동여지도는 두 가지 계정 관리 옵션을 제공합니다.
      </p>
      <h4 className="font-medium mt-3 mb-1">4-1. 계정 비활성화</h4>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>닉네임이 &apos;탈퇴한 사용자&apos;로 익명화됩니다</li>
        <li>작성한 리뷰, 제보 내역은 익명으로 유지됩니다</li>
        <li>랭킹에서 제외됩니다</li>
        <li>계정 정보(이메일, 비밀번호)는 유지됩니다</li>
        <li>언제든지 다시 로그인하여 복구할 수 있습니다</li>
      </ul>
      <h4 className="font-medium mt-3 mb-1">4-2. 계정 완전 삭제 (회원탈퇴)</h4>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>이메일, 비밀번호, 닉네임 등 모든 개인정보가 즉시 영구 삭제됩니다</li>
        <li>작성한 리뷰, 제보 내역은 &apos;탈퇴한 사용자&apos;로 익명화되어 유지됩니다</li>
        <li>북마크, 알림, 통계, 업로드한 이미지 등 부가 정보가 모두 삭제됩니다</li>
        <li>삭제된 계정은 복구가 불가능합니다</li>
        <li>동일한 이메일로 재가입은 가능하나, 이전 데이터와 연결되지 않습니다</li>
      </ul>
      <p className="text-muted-foreground mt-3">
        파기 방법: 전자적 파일 형태의 정보는 복구가 불가능한 기술적 방법으로 영구 삭제합니다.
      </p>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">5. 개인정보 처리의 위탁</h3>
      <p className="text-muted-foreground mb-2">
        쯔동여지도는 서비스 제공을 위해 다음과 같이 개인정보 처리업무를 위탁하고 있습니다.
      </p>
      <div className="border rounded-md overflow-hidden mt-2">
        <table className="w-full text-muted-foreground">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium">수탁자</th>
              <th className="px-3 py-2 text-left text-xs font-medium">위탁 업무</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-3 py-2 text-xs">Supabase Inc.</td>
              <td className="px-3 py-2 text-xs">회원 인증, 데이터베이스 호스팅, 파일 저장</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-xs">Google LLC</td>
              <td className="px-3 py-2 text-xs">소셜 로그인(Google OAuth)</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-xs">Vercel Inc.</td>
              <td className="px-3 py-2 text-xs">웹 애플리케이션 호스팅</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">6. 개인정보의 제3자 제공</h3>
      <p className="text-muted-foreground">
        쯔동여지도는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만, 다음의 경우에는 예외로 합니다.
      </p>
      <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
        <li>이용자가 사전에 동의한 경우</li>
        <li>법령의 규정에 의거하거나, 수사목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우</li>
      </ul>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">7. 이용자의 권리·의무 및 행사방법</h3>
      <p className="text-muted-foreground">
        이용자는 언제든지 다음의 권리를 행사할 수 있습니다.
      </p>
      <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
        <li>개인정보 열람 요구</li>
        <li>오류 등이 있을 경우 정정 요구</li>
        <li>삭제 요구</li>
        <li>처리정지 요구</li>
      </ul>
      <p className="text-muted-foreground mt-2">
        권리 행사는 마이페이지에서 직접 수행하거나, 개인정보 보호책임자에게 이메일로 요청할 수 있습니다. 요청 시 본인 확인 절차를 거친 후 지체 없이 처리됩니다.
      </p>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">8. 개인정보의 안전성 확보 조치</h3>
      <ul className="list-disc pl-5 text-muted-foreground space-y-1">
        <li>비밀번호의 단방향 암호화 저장</li>
        <li>SSL/TLS 암호화 통신</li>
        <li>접근 권한 관리 및 제한</li>
        <li>개인정보 접근 기록 보관</li>
      </ul>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">9. 쿠키의 사용</h3>
      <p className="text-muted-foreground">
        쯔동여지도는 로그인 세션 유지를 위해 쿠키를 사용합니다. 쿠키는 브라우저 설정에서 거부할 수 있으나, 이 경우 로그인이 필요한 서비스 이용이 제한될 수 있습니다.
      </p>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">10. 개인정보 보호책임자</h3>
      <p className="text-muted-foreground">
        개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리 관련 이용자의 불만처리 및 피해구제를 위해 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.
      </p>
      <div className="mt-2 text-muted-foreground">
        <p>성명: 최연우</p>
        <p>연락처: {siteConfig.contact.email}</p>
      </div>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">11. 권익침해 구제방법</h3>
      <p className="text-muted-foreground">
        개인정보침해로 인한 신고나 상담이 필요하신 경우에는 아래 기관에 문의하시기 바랍니다.
      </p>
      <ul className="list-disc pl-5 mt-2 text-muted-foreground space-y-1">
        <li>개인정보침해신고센터: (국번없이) 118</li>
        <li>개인정보분쟁조정위원회: kopico.go.kr</li>
        <li>대검찰청 사이버수사과: spo.go.kr</li>
        <li>경찰청 사이버안전국: cyberbureau.police.go.kr</li>
      </ul>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">12. 개인정보 처리방침 변경</h3>
      <p className="text-muted-foreground">
        이 개인정보 처리방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경내용의 추가, 삭제 및 정정이 있는 경우에는 변경사항의 시행 7일 전부터 공지사항을 통하여 고지할 것입니다.
      </p>
    </section>

    <section>
      <h3 className="font-semibold text-base mb-2">13. 시행일</h3>
      <p className="text-muted-foreground">
        본 개인정보 처리방침은 2026년 1월 1일부터 시행됩니다.
      </p>
    </section>
  </div>
));
PrivacyPolicyContent.displayName = "PrivacyPolicyContent";
