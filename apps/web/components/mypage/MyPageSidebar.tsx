'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Bookmark, MessageSquare, PlusCircle, Edit, Tv, Camera, X, User, Loader2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

interface SidebarItemProps {
    href: string;
    icon: React.ReactNode;
    label: string;
    isActive?: boolean;
}

function SidebarItem({ href, icon, label, isActive }: SidebarItemProps) {
    return (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
        >
            {icon}
            <span>{label}</span>
        </Link>
    );
}

import { useAuth } from '@/contexts/AuthContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { compressImage } from '@/lib/image-utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export function MyPageSidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const { data: profile } = useUserProfile(user?.id ?? '');
    const [avatarUploading, setAvatarUploading] = useState(false);
    const queryClient = useQueryClient();

    const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;

        if (file.size > 2 * 1024 * 1024) {
            toast.error('이미지 크기는 2MB 이하여야 합니다');
            return;
        }

        if (!file.type.startsWith('image/')) {
            toast.error('이미지 파일만 업로드 가능합니다');
            return;
        }

        setAvatarUploading(true);
        try {
            const compressedBlob = await compressImage(file);
            const filePath = `${user.id}/avatar.jpg`;

            const oldAvatarUrl = profile?.avatarUrl;
            if (oldAvatarUrl?.includes('profile-avatars')) {
                const oldPath = oldAvatarUrl.split('profile-avatars/').pop();
                if (oldPath) {
                    await supabase.storage.from('profile-avatars').remove([oldPath]);
                }
            }

            const { error: uploadError } = await supabase.storage
                .from('profile-avatars')
                .upload(filePath, compressedBlob, { upsert: true, contentType: 'image/jpeg' });

            if (uploadError) throw uploadError;

            const baseUrl = supabase.storage.from('profile-avatars').getPublicUrl(filePath).data.publicUrl;
            const publicUrl = `${baseUrl}?t=${Date.now()}`;

            const { error: updateError } = await supabase.from('profiles')
                .update({ avatar_url: publicUrl } as never)
                .eq('user_id', user.id);

            if (updateError) throw updateError;

            queryClient.invalidateQueries({ queryKey: ['user-profile'] });
            router.refresh();
            toast.success('프로필 사진이 변경되었습니다');

        } catch (error) {
            toast.error('이미지 업로드에 실패했습니다');
            console.error(error);
        } finally {
            setAvatarUploading(false);
        }
    };

    const handleAvatarDelete = async () => {
        if (!user || !profile?.avatarUrl) return;
        if (!confirm('프로필 사진을 삭제하시겠습니까?')) return;

        setAvatarUploading(true);
        try {
            if (profile.avatarUrl.includes('profile-avatars')) {
                const oldPath = profile.avatarUrl.split('profile-avatars/').pop()?.split('?')[0];
                if (oldPath) {
                    await supabase.storage.from('profile-avatars').remove([oldPath]);
                }
            }

            const { error: updateError } = await supabase.from('profiles')
                .update({ avatar_url: null } as never)
                .eq('user_id', user.id);

            if (updateError) throw updateError;

            queryClient.invalidateQueries({ queryKey: ['user-profile'] });
            router.refresh();
            toast.success('프로필 사진이 삭제되었습니다');

        } catch (error) {
            toast.error('프로필 사진 삭제에 실패했습니다');
            console.error(error);
        } finally {
            setAvatarUploading(false);
        }
    };

    const menuItems = [
        {
            href: '/mypage/profile',
            icon: <div className="w-4 h-4 flex items-center justify-center rounded-full border border-current">
                <span className="w-2 h-2 rounded-full bg-current" />
            </div>,
            label: '내 프로필'
        },
        {
            divider: true
        },
        {
            href: '/mypage/bookmarks',
            icon: <Bookmark className="w-4 h-4" />,
            label: '나의 북마크 내역'
        },
        {
            href: '/mypage/reviews',
            icon: <MessageSquare className="w-4 h-4" />,
            label: '나의 리뷰 내역'
        },
        {
            divider: true
        },
        {
            href: '/mypage/submissions/new',
            icon: <PlusCircle className="w-4 h-4" />,
            label: '신규 맛집 제보'
        },
        {
            href: '/mypage/submissions/edit',
            icon: <Edit className="w-4 h-4" />,
            label: '맛집 수정 요청'
        },
        {
            href: '/mypage/submissions/recommend',
            icon: <Tv className="w-4 h-4" />,
            label: '쯔양 맛집 제보'
        }
    ];

    if (!user) return null;

    return (
        <aside className="hidden md:flex flex-col w-64 shrink-0 h-full border-r border-border bg-card">
            <div className="p-6 border-b border-border flex flex-col items-center text-center space-y-4">
                <div className="relative group">
                    <Avatar className="w-20 h-20 border-2 border-border shadow-sm group-hover:ring-2 ring-primary/30 transition-all">
                        <AvatarImage src={profile?.avatarUrl} alt={profile?.nickname} className="object-cover" />
                        <AvatarFallback className="text-xl bg-muted">
                            <User className="w-8 h-8 text-muted-foreground" />
                        </AvatarFallback>
                    </Avatar>

                    <label className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 active:opacity-100 transition-opacity cursor-pointer rounded-full z-10">
                        {avatarUploading ? (
                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                        ) : (
                            <Camera className="w-6 h-6 text-white" />
                        )}
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleAvatarUpload}
                            className="hidden"
                            disabled={avatarUploading}
                        />
                    </label>

                    {profile?.avatarUrl && (
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                handleAvatarDelete();
                            }}
                            className="absolute -top-1 -right-1 bg-destructive text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-destructive/90"
                            title="사진 삭제"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    )}
                </div>

                <div className="space-y-1 flex flex-col items-center">
                    <div className="flex items-center gap-2 max-w-full px-2">
                        <h3 className="font-bold text-lg truncate shrink">{profile?.nickname || '사용자'}</h3>
                        {profile?.tier && (
                            <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] h-5 whitespace-nowrap shrink-0", profile.tier.color, profile.tier.bgColor, "border-0")}>
                                {profile.tier.name}
                            </Badge>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-3 w-full gap-2 pt-2">
                    <div className="flex flex-col items-center p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                        <span className="text-xs text-muted-foreground mb-1">도장</span>
                        <span className="font-bold text-sm">{profile?.verifiedReviewCount ?? 0}</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                        <span className="text-xs text-muted-foreground mb-1">리뷰</span>
                        <span className="font-bold text-sm">{profile?.verifiedReviewCount ?? 0}</span>
                    </div>
                    <div className="flex flex-col items-center p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                        <span className="text-xs text-muted-foreground mb-1">좋아요</span>
                        <span className="font-bold text-sm">{profile?.totalLikes ?? 0}</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                {menuItems.map((item, index) => {
                    if (item.divider) {
                        return <div key={index} className="my-2 border-t border-border/50 mx-2" />;
                    }

                    const isActive = pathname === item.href;

                    return (
                        <SidebarItem
                            key={item.href || index}
                            href={item.href!}
                            icon={item.icon}
                            label={item.label!}
                            isActive={isActive}
                        />
                    );
                })}
            </div>
        </aside>
    );
}
