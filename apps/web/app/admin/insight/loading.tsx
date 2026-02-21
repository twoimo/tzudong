import { GlobalLoader } from "@/components/ui/global-loader";

export default function AdminInsightLoading() {
    return (
        <GlobalLoader
            message="관리자 인사이트를 불러오는 중..."
            subMessage="데이터를 준비하고 있습니다"
        />
    );
}

