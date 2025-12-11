'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect, forwardRef } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createNewRestaurantNotification } from "@/contexts/NotificationContext";
import { checkRestaurantDuplicate, DuplicateCheckResult as DbDuplicateCheckResult } from "@/lib/db-conflict-checker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
    Loader2,
    CheckCircle2,
    XCircle,
    Clock,
    Trash2,
    Youtube,
    User,
    RefreshCw,
    X,
    ChevronRight,
    ChevronLeft,
    Edit,
    Plus,
    AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// 새 테이블 구조에 맞는 인터페이스
interface SubmissionItem {
    id: string;
    submission_id: string;
    youtube_link: string;
    tzuyang_review: string | null;
    target_unique_id: string | null;
    item_status: 'pending' | 'approved' | 'rejected';
    rejection_reason: string | null;
    approved_restaurant_id: string | null;
    created_at: string;
}

interface RestaurantSubmission {
    id: string;
    user_id: string;
    submission_type: 'new' | 'edit';
    status: 'pending' | 'approved' | 'partially_approved' | 'rejected';
    restaurant_name: string;
    restaurant_address: string | null;
    restaurant_phone: string | null;
    restaurant_categories: string[] | null;
    target_restaurant_id: string | null;
    admin_notes: string | null;
    rejection_reason: string | null;
    resolved_by_admin_id: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
    items: SubmissionItem[];
}

interface SubmissionWithUser extends RestaurantSubmission {
    profiles: {
        nickname: string;
    } | null;
}

interface AdminSubmissionPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onToggleCollapse?: () => void;
    isCollapsed?: boolean;
}

// 중복 검사 결과 인터페이스 (UI 표시용)
interface DuplicateDisplayResult {
    is_duplicate: boolean;
    existing_restaurant_id: string;
    existing_name: string;
    existing_address: string;
    similarity_score: number;
}

export default function AdminSubmissionPanel({ isOpen, onClose, onToggleCollapse, isCollapsed }: AdminSubmissionPanelProps) {
    const { user, isAdmin } = useAuth();
    const queryClient = useQueryClient();
    const [selectedSubmission, setSelectedSubmission] = useState<SubmissionWithUser | null>(null);
    const [selectedItem, setSelectedItem] = useState<SubmissionItem | null>(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
    const [rejectionReason, setRejectionReason] = useState("");
    const [approvalData, setApprovalData] = useState({
        lat: "",
        lng: "",
        road_address: "",
        jibun_address: "",
        english_address: "",
        address_elements: null as any,
    });

    const [geocoding, setGeocoding] = useState(false);
    const [geocodingResults, setGeocodingResults] = useState<Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>>([]);
    const [selectedGeocodingIndex, setSelectedGeocodingIndex] = useState<number | null>(null);

    // 중복 검사 상태
    const [duplicateCheckResults, setDuplicateCheckResults] = useState<DuplicateDisplayResult[]>([]);
    const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
    const [forceApprove, setForceApprove] = useState(false);

    const [showRestoreDialog, setShowRestoreDialog] = useState(false);
    const [deletedRecordInfo, setDeletedRecordInfo] = useState<{
        id: string;
        name: string;
        road_address: string;
    } | null>(null);
    const [pendingSubmissionData, setPendingSubmissionData] = useState<{
        submissionId: string;
        submission: SubmissionWithUser;
        item: SubmissionItem;
    } | null>(null);

    const {
        data: submissionsPages,
        fetchNextPage,
        hasNextPage,
        isLoading,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: ['admin-submissions', isAdmin],
        queryFn: async ({ pageParam = 0 }) => {
            if (!user || !isAdmin) return { submissions: [], nextCursor: null };

            // 1. submissions 조회
            const { data: submissionsData, error: submissionsError } = await supabase
                .from('restaurant_submissions')
                .select('*')
                .order('created_at', { ascending: false })
                .range(pageParam, pageParam + 19);

            if (submissionsError) throw submissionsError;

            if (!submissionsData || submissionsData.length === 0) {
                return { submissions: [], nextCursor: null };
            }

            const typedSubmissionsData = submissionsData as any[];
            const submissionIds = typedSubmissionsData.map(s => s.id);

            // 2. items 조회 (각 submission의 items 가져오기)
            const { data: itemsData, error: itemsError } = await supabase
                .from('restaurant_submission_items')
                .select('*')
                .in('submission_id', submissionIds);

            if (itemsError) throw itemsError;

            const typedItemsData = (itemsData || []) as any[];

            // 3. 사용자 정보 조회
            const userIds = [...new Set(typedSubmissionsData.map(s => s.user_id))];

            const { data: profilesData } = await supabase
                .from('profiles')
                .select('user_id, nickname')
                .in('user_id', userIds);

            const typedProfilesData = (profilesData || []) as any[];
            const profilesMap = new Map(
                typedProfilesData.map(p => [p.user_id, p.nickname])
            );

            // 4. submissions와 items 매핑
            const submissions = typedSubmissionsData.map(submission => {
                const items = typedItemsData.filter(item => item.submission_id === submission.id);
                return {
                    ...submission,
                    items,
                    profiles: {
                        nickname: profilesMap.get(submission.user_id) || '탈퇴한 사용자'
                    }
                };
            }) as SubmissionWithUser[];

            const nextCursor = submissionsData.length === 20 ? pageParam + 20 : null;

            return { submissions, nextCursor };
        },
        getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
        initialPageParam: 0,
        enabled: !!user && isOpen,
    });

    const submissions = submissionsPages?.pages.flatMap(page => page.submissions) || [];

    const loadMoreRef = useRef<HTMLDivElement>(null);

    const loadMoreSubmissions = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreSubmissions();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observer.observe(loadMoreRef.current);
        }

        return () => observer.disconnect();
    }, [loadMoreSubmissions]);

    const approveMutation = useMutation({
        mutationFn: async ({ 
            submissionId, 
            submission, 
            item,
            forceApprove: shouldForceApprove 
        }: { 
            submissionId: string; 
            submission: SubmissionWithUser;
            item: SubmissionItem;
            forceApprove?: boolean;
        }) => {
            if (!user) throw new Error('로그인이 필요합니다');

            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                throw new Error('올바른 좌표를 입력해주세요');
            }

            const isEditRequest = submission.submission_type === 'edit' && submission.target_restaurant_id;

            if (isEditRequest && item.target_unique_id) {
                // EDIT 요청: 기존 레코드 수정
                const { data: existingRecord, error: fetchError } = await supabase
                    .from('restaurants')
                    .select('id, jibun_address')
                    .eq('unique_id', item.target_unique_id)
                    .single();

                if (fetchError || !existingRecord) {
                    throw new Error('수정 대상 레코드를 찾을 수 없습니다');
                }

                const recordId = (existingRecord as { id: string; jibun_address: string | null }).id;
                const existingJibunAddress = (existingRecord as { id: string; jibun_address: string | null }).jibun_address;

                // EDIT 시 주소가 변경되었다면 중복 검사 필요 (자기 자신 제외)
                const addressChanged = existingJibunAddress !== approvalData.jibun_address;
                if (addressChanged && !shouldForceApprove) {
                    const duplicateResult = await checkRestaurantDuplicate(
                        submission.restaurant_name,
                        approvalData.jibun_address,
                        recordId // 자기 자신 제외
                    );
                    
                    if (duplicateResult.isDuplicate && duplicateResult.matchedRestaurant) {
                        throw new Error(`DUPLICATE_FOUND:${duplicateResult.matchedRestaurant.name}:${duplicateResult.matchedRestaurant.jibun_address}:${Math.round(duplicateResult.similarityScore * 100)}`);
                    }
                }

                // 기존 레코드 업데이트
                const { error: updateError } = await (supabase
                    .from('restaurants') as any)
                    .update({
                        youtube_link: item.youtube_link,
                        tzuyang_review: item.tzuyang_review,
                        lat,
                        lng,
                        road_address: approvalData.road_address,
                        jibun_address: approvalData.jibun_address,
                        english_address: approvalData.english_address,
                        address_elements: approvalData.address_elements,
                        source_type: 'user_submission_edit',
                        updated_at: new Date().toISOString(),
                        updated_by_admin_id: user.id,
                    })
                    .eq('id', recordId);

                if (updateError) throw updateError;

                // item 상태 업데이트
                const { error: itemError } = await (supabase
                    .from('restaurant_submission_items') as any)
                    .update({
                        item_status: 'approved',
                        approved_restaurant_id: recordId,
                    })
                    .eq('id', item.id);

                if (itemError) throw itemError;

                return { restaurantId: recordId };
            } else {
                // NEW 요청: 새 레코드 생성
                
                // 중복 검사 (forceApprove가 아닐 때)
                if (!shouldForceApprove) {
                    const { data: existingRestaurants, error: checkError } = await supabase
                        .from('restaurants')
                        .select('id, name, jibun_address, status')
                        .eq('name', submission.restaurant_name)
                        .eq('jibun_address', approvalData.jibun_address);

                    if (checkError) throw checkError;

                    const typedExistingRestaurants = (existingRestaurants || []) as any[];

                    if (typedExistingRestaurants.length > 0) {
                        const deletedRecord = typedExistingRestaurants.find(r => r.status === 'deleted');
                        const activeRecord = typedExistingRestaurants.find(r => r.status !== 'deleted');

                        if (activeRecord) {
                            throw new Error(`이미 등록된 맛집입니다: "${submission.restaurant_name}" (${approvalData.jibun_address})`);
                        }

                        if (deletedRecord) {
                            throw new Error(`DELETED_RECORD_FOUND:${deletedRecord.id}`);
                        }
                    }
                }

                // unique_id 생성 (name + jibun_address + tzuyang_review)
                const uniqueIdString = `${submission.restaurant_name}|${approvalData.jibun_address}|${item.tzuyang_review || ''}`;
                const encoder = new TextEncoder();
                const data = encoder.encode(uniqueIdString);
                const hashBuffer = await crypto.subtle.digest('MD5', data).catch(() => null);
                let generatedUniqueId: string;
                
                if (hashBuffer) {
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    generatedUniqueId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                } else {
                    // MD5 fallback - simple hash
                    let hash = 0;
                    for (let i = 0; i < uniqueIdString.length; i++) {
                        const char = uniqueIdString.charCodeAt(i);
                        hash = ((hash << 5) - hash) + char;
                        hash = hash & hash;
                    }
                    generatedUniqueId = Math.abs(hash).toString(16).padStart(32, '0');
                }

                // 새 레스토랑 생성
                const { data: restaurant, error: restaurantError } = await (supabase
                    .from('restaurants') as any)
                    .insert({
                        unique_id: generatedUniqueId,
                        name: submission.restaurant_name,
                        road_address: approvalData.road_address,
                        jibun_address: approvalData.jibun_address,
                        english_address: approvalData.english_address,
                        address_elements: approvalData.address_elements,
                        phone: submission.restaurant_phone,
                        categories: submission.restaurant_categories || [],
                        youtube_link: item.youtube_link,
                        tzuyang_review: item.tzuyang_review,
                        lat,
                        lng,
                        geocoding_success: true,
                        status: 'approved',
                        source_type: 'user_submission_new',
                    })
                    .select()
                    .single();

                if (restaurantError) throw restaurantError;

                // item 상태 업데이트
                const { error: itemError } = await (supabase
                    .from('restaurant_submission_items') as any)
                    .update({
                        item_status: 'approved',
                        approved_restaurant_id: restaurant.id,
                    })
                    .eq('id', item.id);

                if (itemError) throw itemError;

                return { restaurantId: restaurant.id };
            }
        },
        onSuccess: (result, { submission }) => {
            toast.success('항목이 승인되었습니다!');
            createNewRestaurantNotification(submission.restaurant_name, submission.restaurant_address || '', {
                category: submission.restaurant_categories || [],
                submissionId: submission.id
            });
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });
            setIsReviewModalOpen(false);
            resetApprovalData();
            setForceApprove(false);
        },
        onError: (error: any, variables) => {
            if (error.message && error.message.startsWith('DELETED_RECORD_FOUND:')) {
                const deletedId = error.message.split(':')[1];
                setDeletedRecordInfo({
                    id: deletedId,
                    name: variables.submission.restaurant_name,
                    road_address: variables.submission.restaurant_address || '',
                });
                setPendingSubmissionData({
                    submissionId: variables.submissionId,
                    submission: variables.submission,
                    item: variables.item,
                });
                setShowRestoreDialog(true);
                setIsReviewModalOpen(false);
            } else if (error.message && error.message.startsWith('DUPLICATE_FOUND:')) {
                // EDIT 시 중복 발견: 이름:주소:유사도
                const [, dupName, dupAddress, similarity] = error.message.split(':');
                const displayResult: DuplicateDisplayResult = {
                    is_duplicate: true,
                    existing_restaurant_id: '', // EDIT 중복에서는 사용 안함
                    existing_name: dupName,
                    existing_address: dupAddress,
                    similarity_score: parseInt(similarity, 10),
                };
                setDuplicateCheckResults([displayResult]);
                toast.error('새 주소에 유사한 맛집이 이미 존재합니다. 강제 승인을 체크하고 다시 시도하세요.');
            } else {
                toast.error(error.message || '승인에 실패했습니다');
            }
        },
    });

    const rejectMutation = useMutation({
        mutationFn: async ({ itemId, reason }: { itemId: string; reason: string }) => {
            if (!user) throw new Error('로그인이 필요합니다');
            if (!reason.trim()) throw new Error('거부 사유를 입력해주세요');

            // item 상태 업데이트
            const { error } = await (supabase
                .from('restaurant_submission_items') as any)
                .update({
                    item_status: 'rejected',
                    rejection_reason: reason.trim(),
                })
                .eq('id', itemId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('항목이 거부되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            setIsReviewModalOpen(false);
            setRejectionReason("");
        },
        onError: (error: any) => {
            toast.error(error.message || '거부에 실패했습니다');
        },
    });

    // 전체 submission 거부 (모든 pending items 일괄 거부)
    const rejectAllMutation = useMutation({
        mutationFn: async ({ submissionId, reason }: { submissionId: string; reason: string }) => {
            if (!user) throw new Error('로그인이 필요합니다');
            if (!reason.trim()) throw new Error('거부 사유를 입력해주세요');

            // 모든 pending items 거부
            const { error: itemsError } = await (supabase
                .from('restaurant_submission_items') as any)
                .update({
                    item_status: 'rejected',
                    rejection_reason: reason.trim(),
                })
                .eq('submission_id', submissionId)
                .eq('item_status', 'pending');

            if (itemsError) throw itemsError;

            // submission 전체 거부 사유 기록
            const { error: submissionError } = await (supabase
                .from('restaurant_submissions') as any)
                .update({
                    rejection_reason: reason.trim(),
                    resolved_by_admin_id: user.id,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', submissionId);

            if (submissionError) throw submissionError;
        },
        onSuccess: () => {
            toast.success('제보가 전체 거부되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            setIsReviewModalOpen(false);
            setRejectionReason("");
        },
        onError: (error: any) => {
            toast.error(error.message || '거부에 실패했습니다');
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (submissionId: string) => {
            const { error } = await supabase
                .from('restaurant_submissions')
                .delete()
                .eq('id', submissionId);

            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('제보가 삭제되었습니다');
            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
        },
        onError: (error: any) => {
            toast.error(error.message || '삭제에 실패했습니다');
        },
    });

    const resetApprovalData = () => {
        setApprovalData({
            lat: "",
            lng: "",
            road_address: "",
            jibun_address: "",
            english_address: "",
            address_elements: null,
        });
        setGeocodingResults([]);
        setSelectedGeocodingIndex(null);
        setDuplicateCheckResults([]);
        setForceApprove(false);
    };

    const extractCityDistrictGu = (address: string): string | null => {
        const regex = /(.*?[시도]\s+.*?[시군구])/;
        const match = address.match(regex);
        return match ? match[1] : null;
    };

    const removeDuplicateAddresses = (addresses: Array<{
        road_address: string;
        jibun_address: string;
        english_address: string;
        address_elements: any;
        x: string;
        y: string;
    }>) => {
        const seen = new Set<string>();
        return addresses.filter(addr => {
            if (seen.has(addr.jibun_address)) {
                return false;
            }
            seen.add(addr.jibun_address);
            return true;
        });
    };

    const geocodeAddressMultiple = async (name: string, address: string, limit: number = 3) => {
        try {
            const combinedQuery = `${name} ${address}`;
            const { data, error } = await supabase.functions.invoke('naver-geocode', {
                body: { query: combinedQuery, count: limit }
            });

            if (error) throw new Error(error.message);
            if (!data || !data.addresses || data.addresses.length === 0) return [];

            return data.addresses.slice(0, limit).map((addr: any) => ({
                road_address: addr.roadAddress,
                jibun_address: addr.jibunAddress,
                english_address: addr.englishAddress,
                address_elements: addr.addressElements,
                x: addr.x,
                y: addr.y,
            }));
        } catch (error: any) {
            console.error('지오코딩 에러:', error);
            return [];
        }
    };

    const handleReGeocode = async () => {
        if (!selectedSubmission) return;

        const trimmedName = selectedSubmission.restaurant_name.trim();
        const trimmedAddress = (selectedSubmission.restaurant_address || '').trim();

        if (!trimmedName || !trimmedAddress) {
            toast.error('맛집명과 주소가 필요합니다');
            return;
        }

        try {
            setGeocoding(true);
            setGeocodingResults([]);
            setSelectedGeocodingIndex(null);

            const fullAddressResults = await geocodeAddressMultiple(trimmedName, trimmedAddress, 3);
            const shortAddress = extractCityDistrictGu(trimmedAddress);
            const shortAddressResults = shortAddress
                ? await geocodeAddressMultiple(trimmedName, shortAddress, 3)
                : [];

            const allResults = [...fullAddressResults, ...shortAddressResults];
            const uniqueResults = removeDuplicateAddresses(allResults);

            if (uniqueResults.length > 0) {
                setGeocodingResults(uniqueResults);
                toast.success(`${uniqueResults.length}개의 주소 후보를 찾았습니다.`);
            } else {
                toast.error('주소를 찾을 수 없습니다.');
            }
        } catch (error: any) {
            toast.error(error.message || '지오코딩에 실패했습니다');
        } finally {
            setGeocoding(false);
        }
    };

    const handleSelectGeocodingResult = (index: number) => {
        setSelectedGeocodingIndex(index);
        const selected = geocodingResults[index];
        setApprovalData({
            lat: selected.y,
            lng: selected.x,
            road_address: selected.road_address,
            jibun_address: selected.jibun_address,
            english_address: selected.english_address,
            address_elements: selected.address_elements,
        });
        setDuplicateCheckResults([]);
        setForceApprove(false);
        
        // 주소 선택 시 자동으로 중복 검사 실행
        if (selectedSubmission) {
            checkDuplicate(selectedSubmission.restaurant_name, selected.jibun_address);
        }
    };

    // 중복 검사 함수 (Levenshtein Distance 기반)
    const checkDuplicate = async (name: string, jibunAddress: string) => {
        setIsCheckingDuplicate(true);
        try {
            const result = await checkRestaurantDuplicate(name, jibunAddress);
            
            if (result.isDuplicate && result.matchedRestaurant) {
                const displayResult: DuplicateDisplayResult = {
                    is_duplicate: true,
                    existing_restaurant_id: result.matchedRestaurant.id,
                    existing_name: result.matchedRestaurant.name,
                    existing_address: result.matchedRestaurant.jibun_address,
                    similarity_score: result.similarityScore * 100, // 0-1 → 0-100 변환
                };
                setDuplicateCheckResults([displayResult]);
            } else {
                setDuplicateCheckResults([]);
            }
        } catch (error) {
            console.error('중복 검사 실패:', error);
            setDuplicateCheckResults([]);
        } finally {
            setIsCheckingDuplicate(false);
        }
    };

    const handleRestoreAndUpdate = async () => {
        if (!deletedRecordInfo || !pendingSubmissionData || !user) return;

        try {
            const { submission, item } = pendingSubmissionData;
            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                toast.error('올바른 좌표를 입력해주세요');
                return;
            }

            const { error: updateError } = await (supabase
                .from('restaurants') as any)
                .update({
                    name: submission.restaurant_name,
                    road_address: approvalData.road_address,
                    jibun_address: approvalData.jibun_address,
                    english_address: approvalData.english_address,
                    address_elements: approvalData.address_elements,
                    phone: submission.restaurant_phone,
                    categories: submission.restaurant_categories || [],
                    youtube_link: item.youtube_link,
                    tzuyang_review: item.tzuyang_review,
                    lat,
                    lng,
                    geocoding_success: true,
                    status: 'approved',
                    source_type: 'user_submission_new',
                    updated_at: new Date().toISOString(),
                    updated_by_admin_id: user.id,
                })
                .eq('id', deletedRecordInfo.id);

            if (updateError) throw updateError;

            // item 상태 업데이트
            const { error: itemError } = await (supabase
                .from('restaurant_submission_items') as any)
                .update({
                    item_status: 'approved',
                    approved_restaurant_id: deletedRecordInfo.id,
                })
                .eq('id', item.id);

            if (itemError) throw itemError;

            toast.success('삭제된 레코드가 복원되었습니다!');
            createNewRestaurantNotification(submission.restaurant_name, submission.restaurant_address || '', {
                category: submission.restaurant_categories || [],
                submissionId: submission.id
            });

            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });

            setShowRestoreDialog(false);
            setDeletedRecordInfo(null);
            setPendingSubmissionData(null);
            resetApprovalData();
        } catch (error: any) {
            toast.error(error.message || '복원에 실패했습니다');
        }
    };

    const handleCreateNew = async () => {
        if (!pendingSubmissionData || !user) return;

        try {
            const { submission, item } = pendingSubmissionData;
            const lat = parseFloat(approvalData.lat);
            const lng = parseFloat(approvalData.lng);

            if (isNaN(lat) || isNaN(lng)) {
                toast.error('올바른 좌표를 입력해주세요');
                return;
            }

            // unique_id 생성
            const uniqueIdString = `${submission.restaurant_name}|${approvalData.jibun_address}|${item.tzuyang_review || ''}`;
            let generatedUniqueId = '';
            let hash = 0;
            for (let i = 0; i < uniqueIdString.length; i++) {
                const char = uniqueIdString.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            generatedUniqueId = Math.abs(hash).toString(16).padStart(32, '0');

            const { data: restaurant, error: restaurantError } = await (supabase
                .from('restaurants') as any)
                .insert({
                    unique_id: generatedUniqueId,
                    name: submission.restaurant_name,
                    road_address: approvalData.road_address,
                    jibun_address: approvalData.jibun_address,
                    english_address: approvalData.english_address,
                    address_elements: approvalData.address_elements,
                    phone: submission.restaurant_phone,
                    categories: submission.restaurant_categories || [],
                    youtube_link: item.youtube_link,
                    tzuyang_review: item.tzuyang_review,
                    lat,
                    lng,
                    geocoding_success: true,
                    status: 'approved',
                    source_type: 'user_submission_new',
                })
                .select()
                .single();

            if (restaurantError) throw restaurantError;

            // item 상태 업데이트
            const { error: itemError } = await (supabase
                .from('restaurant_submission_items') as any)
                .update({
                    item_status: 'approved',
                    approved_restaurant_id: restaurant.id,
                })
                .eq('id', item.id);

            if (itemError) throw itemError;

            toast.success('새로운 맛집이 생성되었습니다!');
            createNewRestaurantNotification(submission.restaurant_name, submission.restaurant_address || '', {
                category: submission.restaurant_categories || [],
                submissionId: submission.id
            });

            queryClient.invalidateQueries({ queryKey: ['admin-submissions'] });
            queryClient.invalidateQueries({ queryKey: ['restaurants'] });

            setShowRestoreDialog(false);
            setDeletedRecordInfo(null);
            setPendingSubmissionData(null);
            resetApprovalData();
        } catch (error: any) {
            toast.error(error.message || '맛집 생성에 실패했습니다');
        }
    };

    // 상세 모달 열기 (목록 클릭 시)
    const openDetailModal = (submission: SubmissionWithUser) => {
        setSelectedSubmission(submission);
        setSelectedItem(null);
        setIsDetailModalOpen(true);
    };

    // 항목 승인/거부 모달 열기
    const openReviewModal = (submission: SubmissionWithUser, item: SubmissionItem, action: 'approve' | 'reject') => {
        setSelectedSubmission(submission);
        setSelectedItem(item);
        setReviewAction(action);
        setIsDetailModalOpen(false);
        setIsReviewModalOpen(true);
    };

    const handleReview = () => {
        if (!selectedSubmission || !selectedItem) return;

        if (reviewAction === 'approve') {
            approveMutation.mutate({ 
                submissionId: selectedSubmission.id, 
                submission: selectedSubmission,
                item: selectedItem,
                forceApprove
            });
        } else if (reviewAction === 'reject') {
            rejectMutation.mutate({ itemId: selectedItem.id, reason: rejectionReason });
        }
    };

    const handleRejectAll = () => {
        if (!selectedSubmission) return;
        rejectAllMutation.mutate({ submissionId: selectedSubmission.id, reason: rejectionReason });
    };

    const handleDelete = (submissionId: string) => {
        if (confirm('정말 이 제보를 삭제하시겠습니까?')) {
            deleteMutation.mutate(submissionId);
        }
    };

    const pendingSubmissions = submissions.filter(s => s.status === 'pending');
    const approvedSubmissions = submissions.filter(s => s.status === 'approved' || s.status === 'partially_approved');
    const rejectedSubmissions = submissions.filter(s => s.status === 'rejected');

    if (!user || !isAdmin) {
        return (
            <div className="h-full flex flex-col bg-background">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-lg font-bold">제보관리</h2>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>
                <div className="flex-1 flex items-center justify-center p-8">
                    <Card className="p-8 text-center">
                        <div className="text-4xl mb-3">🔒</div>
                        <h3 className="text-lg font-semibold mb-2">접근 권한 없음</h3>
                        <p className="text-sm text-muted-foreground">관리자만 접근할 수 있습니다.</p>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-background border-l border-border relative">
            {/* 플로팅 접기/펼치기 버튼 - 패널 좌측 가장자리 */}
            {onToggleCollapse && (
                <button
                    onClick={onToggleCollapse}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-full z-50 flex items-center justify-center w-6 h-12 bg-background border border-r-0 border-border rounded-l-md shadow-md hover:bg-muted transition-colors cursor-pointer group"
                    title={isCollapsed ? "패널 펼치기" : "패널 접기"}
                    aria-label={isCollapsed ? "패널 펼치기" : "패널 접기"}
                >
                    {!isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    ) : (
                        <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                    )}
                </button>
            )}

            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                <div>
                    <h2 className="text-lg font-bold">제보관리</h2>
                    <p className="text-sm text-muted-foreground">맛집 제보 승인/거부</p>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>

            {/* 통계 */}
            <div className="grid grid-cols-3 gap-2 p-3 border-b border-border">
                <div className="text-center p-2 bg-yellow-50 dark:bg-yellow-950/20 rounded">
                    <p className="text-xs text-muted-foreground">대기</p>
                    <p className="text-lg font-bold">{pendingSubmissions.length}</p>
                </div>
                <div className="text-center p-2 bg-green-50 dark:bg-green-950/20 rounded">
                    <p className="text-xs text-muted-foreground">승인</p>
                    <p className="text-lg font-bold">{approvedSubmissions.length}</p>
                </div>
                <div className="text-center p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    <p className="text-xs text-muted-foreground">거부</p>
                    <p className="text-lg font-bold">{rejectedSubmissions.length}</p>
                </div>
            </div>

            {/* 탭 및 목록 */}
            <div className="flex-1 overflow-auto p-3">
                <Tabs defaultValue="pending" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 mb-3">
                        <TabsTrigger value="pending" className="text-xs">
                            대기 ({pendingSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="approved" className="text-xs">
                            승인 ({approvedSubmissions.length})
                        </TabsTrigger>
                        <TabsTrigger value="rejected" className="text-xs">
                            거부 ({rejectedSubmissions.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pending" className="space-y-2">
                        {isLoading ? (
                            <div className="space-y-2">
                                {[1, 2, 3].map(i => (
                                    <Card key={i} className="p-3">
                                        <div className="h-4 bg-muted rounded animate-pulse w-32 mb-2" />
                                        <div className="h-3 bg-muted rounded animate-pulse w-48" />
                                    </Card>
                                ))}
                            </div>
                        ) : pendingSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">✅</div>
                                <p className="text-sm text-muted-foreground">대기 중인 제보가 없습니다</p>
                            </Card>
                        ) : (
                            <>
                                {pendingSubmissions.map((submission, index) => (
                                    <SubmissionCard
                                        key={`${submission.id}-${index}`}
                                        ref={index === pendingSubmissions.length - 1 ? loadMoreRef : null}
                                        submission={submission}
                                        onSelect={() => openDetailModal(submission)}
                                        onDelete={() => handleDelete(submission.id)}
                                    />
                                ))}
                                {isFetchingNextPage && (
                                    <div className="text-center py-4">
                                        <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="approved" className="space-y-2">
                        {approvedSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">승인된 제보가 없습니다</p>
                            </Card>
                        ) : (
                            approvedSubmissions.map((submission) => (
                                <SubmissionCard
                                    key={submission.id}
                                    submission={submission}
                                    onSelect={() => openDetailModal(submission)}
                                    onDelete={() => handleDelete(submission.id)}
                                />
                            ))
                        )}
                    </TabsContent>

                    <TabsContent value="rejected" className="space-y-2">
                        {rejectedSubmissions.length === 0 ? (
                            <Card className="p-6 text-center">
                                <div className="text-3xl mb-2">📋</div>
                                <p className="text-sm text-muted-foreground">거부된 제보가 없습니다</p>
                            </Card>
                        ) : (
                            rejectedSubmissions.map((submission) => (
                                <SubmissionCard
                                    key={submission.id}
                                    submission={submission}
                                    onSelect={() => openDetailModal(submission)}
                                    onDelete={() => handleDelete(submission.id)}
                                />
                            ))
                        )}
                    </TabsContent>
                </Tabs>
            </div>

            {/* 상세 모달 - 제보 항목 목록 */}
            <Dialog open={isDetailModalOpen} onOpenChange={setIsDetailModalOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>📋 제보 상세</DialogTitle>
                        <DialogDescription>
                            제보 항목을 확인하고 개별 승인/거부 처리하세요
                        </DialogDescription>
                    </DialogHeader>

                    {selectedSubmission && (
                        <div className="space-y-4 mt-4">
                            {/* 제보 기본 정보 */}
                            <Card className="p-3 bg-muted/50">
                                <div className="space-y-1 text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">맛집:</span>
                                        <span>{selectedSubmission.restaurant_name}</span>
                                        <Badge variant="outline" className="text-xs">
                                            {selectedSubmission.submission_type === 'new' ? '신규' : '수정'}
                                        </Badge>
                                    </div>
                                    <p><strong>주소:</strong> {selectedSubmission.restaurant_address || '-'}</p>
                                    <p><strong>제보자:</strong> {selectedSubmission.profiles?.nickname || '알 수 없음'}</p>
                                    <p><strong>제보일:</strong> {new Date(selectedSubmission.created_at).toLocaleDateString('ko-KR')}</p>
                                </div>
                            </Card>

                            {/* 항목 목록 */}
                            <div className="space-y-2">
                                <p className="text-sm font-medium">항목 ({selectedSubmission.items?.length || 0}개)</p>
                                {selectedSubmission.items?.map((item, idx) => (
                                    <Card key={item.id} className="p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-muted-foreground">{idx + 1}.</span>
                                                    <a
                                                        href={item.youtube_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-primary hover:underline flex items-center gap-1 text-sm truncate"
                                                    >
                                                        <Youtube className="h-3 w-3 flex-shrink-0" />
                                                        <span className="truncate">{item.youtube_link}</span>
                                                    </a>
                                                </div>
                                                {item.tzuyang_review && (
                                                    <p className="text-xs text-muted-foreground pl-4">
                                                        리뷰: {item.tzuyang_review}
                                                    </p>
                                                )}
                                                {item.item_status === 'rejected' && item.rejection_reason && (
                                                    <p className="text-xs text-destructive pl-4">
                                                        거부 사유: {item.rejection_reason}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                {item.item_status === 'pending' ? (
                                                    <>
                                                        <Button 
                                                            onClick={() => openReviewModal(selectedSubmission, item, 'approve')} 
                                                            size="sm" 
                                                            className="h-7 px-2 text-xs bg-green-500 hover:bg-green-600"
                                                        >
                                                            <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            승인
                                                        </Button>
                                                        <Button 
                                                            onClick={() => openReviewModal(selectedSubmission, item, 'reject')} 
                                                            size="sm" 
                                                            variant="destructive"
                                                            className="h-7 px-2 text-xs"
                                                        >
                                                            <XCircle className="h-3 w-3 mr-1" />
                                                            거부
                                                        </Button>
                                                    </>
                                                ) : item.item_status === 'approved' ? (
                                                    <Badge className="bg-green-500 text-xs">
                                                        <CheckCircle2 className="h-3 w-3 mr-1" />
                                                        승인됨
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="destructive" className="text-xs">
                                                        <XCircle className="h-3 w-3 mr-1" />
                                                        거부됨
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>

                            {/* 전체 거부 버튼 */}
                            {selectedSubmission.status === 'pending' && (
                                <div className="pt-2 border-t">
                                    <Button
                                        variant="outline"
                                        className="w-full text-destructive hover:text-destructive"
                                        onClick={() => {
                                            setReviewAction('reject');
                                            setSelectedItem(null);
                                            setIsDetailModalOpen(false);
                                            setIsReviewModalOpen(true);
                                        }}
                                    >
                                        <XCircle className="h-4 w-4 mr-2" />
                                        전체 거부
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 검토 모달 */}
            <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {reviewAction === 'approve' ? '✅ 항목 승인' : selectedItem ? '❌ 항목 거부' : '❌ 전체 거부'}
                        </DialogTitle>
                        <DialogDescription>
                            {reviewAction === 'approve'
                                ? '지오코딩 → 중복 검사 → 승인 순서로 진행합니다'
                                : selectedItem ? '해당 항목의 거부 사유를 입력해주세요' : '모든 대기 항목을 거부합니다'}
                        </DialogDescription>
                    </DialogHeader>

                    {/* 전체 거부 (selectedItem이 없을 때) */}
                    {selectedSubmission && !selectedItem && reviewAction === 'reject' && (
                        <div className="space-y-4 mt-4">
                            <Card className="p-3 bg-muted/50">
                                <div className="space-y-1 text-sm">
                                    <p><strong>맛집:</strong> {selectedSubmission.restaurant_name}</p>
                                    <p><strong>대기 항목:</strong> {selectedSubmission.items?.filter(i => i.item_status === 'pending').length || 0}개</p>
                                </div>
                            </Card>
                            <div className="space-y-2">
                                <Label>거부 사유 *</Label>
                                <Textarea
                                    value={rejectionReason}
                                    onChange={(e) => setRejectionReason(e.target.value)}
                                    placeholder="전체 거부 사유를 입력해주세요..."
                                    rows={3}
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsReviewModalOpen(false);
                                        setRejectionReason("");
                                    }}
                                    disabled={rejectAllMutation.isPending}
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleRejectAll}
                                    disabled={rejectAllMutation.isPending || !rejectionReason.trim()}
                                    className="bg-red-500 hover:bg-red-600"
                                >
                                    {rejectAllMutation.isPending ? (
                                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" />처리 중</>
                                    ) : '전체 거부'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* 개별 항목 승인/거부 */}
                    {selectedSubmission && selectedItem && (
                        <div className="space-y-4 mt-4">
                            {/* 제보 기본 정보 */}
                            <Card className="p-3 bg-muted/50">
                                <div className="space-y-1 text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold">맛집:</span>
                                        <span>{selectedSubmission.restaurant_name}</span>
                                        <Badge variant="outline" className="text-xs">
                                            {selectedSubmission.submission_type === 'new' ? (
                                                <><Plus className="h-3 w-3 mr-1" />신규</>
                                            ) : (
                                                <><Edit className="h-3 w-3 mr-1" />수정</>
                                            )}
                                        </Badge>
                                    </div>
                                    <p><strong>주소:</strong> {selectedSubmission.restaurant_address}</p>
                                    <a
                                        href={selectedItem.youtube_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:underline flex items-center gap-1"
                                    >
                                        <Youtube className="h-4 w-4" />
                                        유튜브 영상
                                    </a>
                                    {selectedItem.tzuyang_review && (
                                        <p className="text-muted-foreground"><strong>쯔양 리뷰:</strong> {selectedItem.tzuyang_review}</p>
                                    )}
                                </div>
                            </Card>

                            {reviewAction === 'approve' ? (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <Label>주소 지오코딩</Label>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleReGeocode}
                                            disabled={geocoding}
                                        >
                                            {geocoding && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                            {!geocoding && <RefreshCw className="mr-1 h-3 w-3" />}
                                            검색
                                        </Button>
                                    </div>

                                    {geocodingResults.length > 0 && (
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {geocodingResults.map((result, index) => (
                                                <div
                                                    key={index}
                                                    onClick={() => handleSelectGeocodingResult(index)}
                                                    className={`p-2 rounded border cursor-pointer text-xs ${selectedGeocodingIndex === index
                                                        ? 'border-primary bg-primary/5'
                                                        : 'border-gray-200 hover:border-gray-300'
                                                        }`}
                                                >
                                                    <p><strong>도로명:</strong> {result.road_address}</p>
                                                    <p><strong>지번:</strong> {result.jibun_address}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {approvalData.jibun_address && (
                                        <div className="p-2 bg-green-50 dark:bg-green-950 border border-green-200 rounded text-xs">
                                            <p className="font-semibold text-green-800 dark:text-green-200">✅ 선택됨</p>
                                            <p>{approvalData.road_address}</p>
                                        </div>
                                    )}

                                    {/* 중복 검사 결과 */}
                                    {isCheckingDuplicate && (
                                        <div className="p-2 bg-gray-50 dark:bg-gray-900 rounded text-xs flex items-center gap-2">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            중복 검사 중...
                                        </div>
                                    )}

                                    {duplicateCheckResults.length > 0 && (
                                        <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-300 rounded text-xs space-y-2">
                                            <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 font-semibold">
                                                <AlertTriangle className="h-4 w-4" />
                                                유사한 맛집 발견!
                                            </div>
                                            {duplicateCheckResults.map((dup, index) => (
                                                <div key={index} className="p-2 bg-white dark:bg-gray-800 rounded border">
                                                    <p><strong>{dup.existing_name}</strong></p>
                                                    <p className="text-muted-foreground">{dup.existing_address}</p>
                                                    <p className="text-yellow-600">유사도: {dup.similarity_score.toFixed(1)}%</p>
                                                </div>
                                            ))}
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={forceApprove}
                                                    onChange={(e) => setForceApprove(e.target.checked)}
                                                    className="rounded"
                                                />
                                                <span className="text-yellow-800 dark:text-yellow-200">그래도 승인 (강제 승인)</span>
                                            </label>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-xs">위도</Label>
                                            <Input
                                                type="number"
                                                step="0.00000001"
                                                value={approvalData.lat}
                                                disabled
                                                className="text-xs"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">경도</Label>
                                            <Input
                                                type="number"
                                                step="0.00000001"
                                                value={approvalData.lng}
                                                disabled
                                                className="text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <Label>거부 사유 *</Label>
                                    <Textarea
                                        value={rejectionReason}
                                        onChange={(e) => setRejectionReason(e.target.value)}
                                        placeholder="거부 사유를 입력해주세요..."
                                        rows={3}
                                    />
                                </div>
                            )}

                            <div className="flex justify-end gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setIsReviewModalOpen(false);
                                        setRejectionReason("");
                                        resetApprovalData();
                                        setSelectedItem(null);
                                    }}
                                    disabled={approveMutation.isPending || rejectMutation.isPending}
                                >
                                    취소
                                </Button>
                                <Button
                                    onClick={handleReview}
                                    disabled={
                                        approveMutation.isPending ||
                                        rejectMutation.isPending ||
                                        (reviewAction === 'approve' && selectedGeocodingIndex === null) ||
                                        (reviewAction === 'approve' && duplicateCheckResults.length > 0 && !forceApprove)
                                    }
                                    className={reviewAction === 'approve' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}
                                >
                                    {approveMutation.isPending || rejectMutation.isPending ? (
                                        <><Loader2 className="mr-1 h-4 w-4 animate-spin" />처리 중</>
                                    ) : reviewAction === 'approve' ? '승인' : '거부'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* 복원 다이얼로그 */}
            <AlertDialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>🔄 삭제된 레코드 발견</AlertDialogTitle>
                        <AlertDialogDescription>
                            같은 이름과 주소의 삭제된 맛집이 있습니다. 복원하시겠습니까?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => {
                            setShowRestoreDialog(false);
                            setDeletedRecordInfo(null);
                            setPendingSubmissionData(null);
                        }}>
                            취소
                        </AlertDialogCancel>
                        <Button variant="outline" onClick={handleCreateNew}>
                            새로 생성
                        </Button>
                        <AlertDialogAction
                            onClick={handleRestoreAndUpdate}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            복원 (권장)
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// 제보 카드 컴포넌트 - 깔끔한 목록 형태
const SubmissionCard = forwardRef<HTMLDivElement, {
    submission: SubmissionWithUser;
    onSelect: () => void;
    onDelete: () => void;
}>(({ submission, onSelect, onDelete }, ref) => {
    
    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'pending':
                return <Badge variant="secondary" className="text-[10px]"><Clock className="h-2.5 w-2.5 mr-0.5" />대기</Badge>;
            case 'approved':
                return <Badge className="bg-green-500 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />승인</Badge>;
            case 'partially_approved':
                return <Badge className="bg-blue-500 text-[10px]"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />부분</Badge>;
            case 'rejected':
                return <Badge variant="destructive" className="text-[10px]"><XCircle className="h-2.5 w-2.5 mr-0.5" />거부</Badge>;
            default:
                return null;
        }
    };

    const pendingCount = submission.items?.filter(item => item.item_status === 'pending').length || 0;

    return (
        <Card 
            ref={ref} 
            className="p-3 cursor-pointer hover:bg-muted/50 transition-colors"
            onClick={onSelect}
        >
            <div className="flex items-center justify-between gap-2">
                {/* 왼쪽: 맛집명, 타입, 상태 */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-sm font-medium truncate">{submission.restaurant_name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                            {submission.submission_type === 'new' ? '신규' : '수정'}
                        </Badge>
                        {getStatusBadge(submission.status)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                            <User className="h-3 w-3" />
                            {submission.profiles?.nickname || '알 수 없음'}
                        </span>
                        <span>•</span>
                        <span>항목 {submission.items?.length || 0}개</span>
                        {pendingCount > 0 && (
                            <span className="text-yellow-600">({pendingCount}개 대기)</span>
                        )}
                    </div>
                </div>
                
                {/* 오른쪽: 삭제 버튼 */}
                <Button 
                    onClick={(e) => { e.stopPropagation(); onDelete(); }} 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                >
                    <Trash2 className="h-3 w-3" />
                </Button>
            </div>
        </Card>
    );
});

SubmissionCard.displayName = 'SubmissionCard';
