'use client';

import { useParams } from "next/navigation";
import { UserProfilePanel } from "@/components/profile/UserProfilePanel";

export default function UserProfilePage() {
    const params = useParams();
    const userId = params.userId as string;

    return <UserProfilePanel userId={userId} showBackButton={true} />;
}
