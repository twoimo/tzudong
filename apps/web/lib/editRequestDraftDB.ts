import { openDB, DBSchema, IDBPDatabase } from 'idb';

// 수정 요청 모달 임시 저장 데이터 타입
export interface EditRequestDraft {
    id: string; // userId_restaurantId
    userId: string;
    restaurantId: string;
    name: string;
    address: string;
    phone: string;
    category: string[];
    youtube_reviews: {
        youtube_link: string;
        tzuyang_review: string;
        restaurant_id: string;
    }[];
    savedAt: string;
}

// IndexedDB 스키마 정의
interface EditRequestDraftDB extends DBSchema {
    'edit-request-drafts': {
        key: string;
        value: EditRequestDraft;
        indexes: {
            'by-user': string;
            'by-restaurant': string;
        };
    };
}

const DB_NAME = 'tzudong-edit-request-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'edit-request-drafts';

// IndexedDB 초기화
async function initDB(): Promise<IDBPDatabase<EditRequestDraftDB>> {
    return openDB<EditRequestDraftDB>(DB_NAME, DB_VERSION, {
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
export async function saveDraft(draft: Omit<EditRequestDraft, 'id' | 'savedAt'>): Promise<void> {
    try {
        const db = await initDB();
        const id = getDraftKey(draft.userId, draft.restaurantId);

        const editRequestDraft: EditRequestDraft = {
            ...draft,
            id,
            savedAt: new Date().toISOString(),
        };

        await db.put(STORE_NAME, editRequestDraft);
    } catch (error) {
        console.error('Draft 저장 실패:', error);
        throw new Error('임시 저장에 실패했습니다.');
    }
}

// Draft 불러오기
export async function getDraft(userId: string, restaurantId: string): Promise<EditRequestDraft | null> {
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

// 사용자의 모든 Draft 목록 가져오기
export async function getAllDraftsByUser(userId: string): Promise<EditRequestDraft[]> {
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

// 오래된 Draft 정리 (30일 이상)
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
