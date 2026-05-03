import { redirect } from "next/navigation";

export default function MyPage() {
  redirect("/mypage/submissions/new");
}
