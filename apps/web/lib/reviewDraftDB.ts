import { openDB, DBSchema, IDBPDatabase } from 'idb';

// 리뷰 임시 저장 데이터 타입
export interface ReviewDraft {
    id: string; // userId_restaurantId
    userId: string;
    restaurantId: string;
    visitedDate: string;
    visitedTime: string;
    categories: string[];
    content: string;
    verificationPhoto: File | null;
    foodPhotos: File[];
    savedAt: string;
}

// IndexedDB 스키마 정의
interface ReviewDraftDB extends DBSchema {
    'review-drafts': {
        key: string;
        value: ReviewDraft;
        indexes: {
            'by-user': string;
            'by-restaurant': string;
        };
    };
}

const DB_NAME = 'tzudong-review-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'review-drafts';

// IndexedDB 초기화
async function initDB(): Promise<IDBPDatabase<ReviewDraftDB>> {
    return openDB<ReviewDraftDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                });
                store.createIndex('by-user', 'userId');
                store.createIndex('by-restaurant', 'restaurantId');
            }
        },
    });
}

// Draft 키 생성
function getDraftKey(userId: string, restaurantId: string): string {
    return `${userId}_${restaurantId}`;
}

// Draft 저장
export async function saveDraft(draft: Omit<ReviewDraft, 'id' | 'savedAt'>): Promise<void> {
    try {
        const db = await initDB();
        const id = getDraftKey(draft.userId, draft.restaurantId);

        const reviewDraft: ReviewDraft = {
            ...draft,
            id,
            savedAt: new Date().toISOString(),
        };

        await db.put(STORE_NAME, reviewDraft);
    } catch (error) {
        console.error('Draft 저장 실패:', error);
        throw new Error('임시 저장에 실패했습니다.');
    }
}

// Draft 불러오기
export async function getDraft(userId: string, restaurantId: string): Promise<ReviewDraft | null> {
    try {
        const db = await initDB();
        const id = getDraftKey(userId, restaurantId);
        const draft = await db.get(STORE_NAME, id);
        return draft || null;
    } catch (error) {
        console.error('Draft 불러오기 실패:', error);
        return null;
    }
}

// Draft 존재 여부 확인
export async function hasDraft(userId: string, restaurantId: string): Promise<boolean> {
    try {
        const draft = await getDraft(userId, restaurantId);
        return draft !== null;
    } catch (error) {
        console.error('Draft 확인 실패:', error);
        return false;
    }
}

// Draft 삭제
export async function deleteDraft(userId: string, restaurantId: string): Promise<void> {
    try {
        const db = await initDB();
        const id = getDraftKey(userId, restaurantId);
        await db.delete(STORE_NAME, id);
    } catch (error) {
        console.error('Draft 삭제 실패:', error);
        throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
    }
}

// 사용자의 모든 Draft 목록 가져오기 (선택적 기능)
export async function getAllDraftsByUser(userId: string): Promise<ReviewDraft[]> {
    try {
        const db = await initDB();
        const index = db.transaction(STORE_NAME).store.index('by-user');
        const drafts = await index.getAll(userId);
        return drafts;
    } catch (error) {
        console.error('Draft 목록 불러오기 실패:', error);
        return [];
    }
}

// 오래된 Draft 정리 (30일 이상 된 것 삭제)
export async function cleanupOldDrafts(): Promise<void> {
    try {
        const db = await initDB();
        const allDrafts = await db.getAll(STORE_NAME);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        for (const draft of allDrafts) {
            const savedDate = new Date(draft.savedAt);
            if (savedDate < thirtyDaysAgo) {
                await db.delete(STORE_NAME, draft.id);
            }
        }
    } catch (error) {
        console.error('오래된 Draft 정리 실패:', error);
    }
}
