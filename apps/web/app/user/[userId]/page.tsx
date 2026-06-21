'use client';

import { useParams } from "next/navigation";
import { UserProfilePanel } from "@/components/profile/UserProfilePanel";

export default function UserProfilePage() {
    const params = useParams();
    const userId = typeof params?.userId === "string" ? params.userId : "";

    return <UserProfilePanel userId={userId} showBackButton={true} />;
}
