import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Compatibility fallback: actual empty controls, disabled until recovery validation. */
export function ResetPasswordProgressiveSkeleton() {
    return (
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-muted/30 px-4 py-10">
            <section className="w-full max-w-md space-y-4 rounded-2xl border bg-background p-6 shadow-sm">
                <h1 className="text-xl font-bold">쯔동여지도</h1>
                <p className="text-sm">새로운 비밀번호를 입력해주세요</p>
                <p role="status" className="text-sm text-muted-foreground">재설정 링크를 확인하는 중입니다.</p>
                <form aria-busy="true">
                <fieldset disabled className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="pending-new-password">새 비밀번호</Label>
                        <Input id="pending-new-password" type="password" autoComplete="new-password" />
                        <p className="text-xs text-muted-foreground">8자 이상 12자 이하로 입력해주세요</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="pending-confirm-password">새 비밀번호 확인</Label>
                        <Input id="pending-confirm-password" type="password" autoComplete="new-password" />
                    </div>
                    <Button type="button" disabled className="w-full">비밀번호 변경</Button>
                </fieldset>
                </form>
                <p className="text-xs text-center text-muted-foreground">비밀번호 변경 후 자동으로 메인 페이지로 이동합니다</p>
            </section>
        </div>
    );
}
