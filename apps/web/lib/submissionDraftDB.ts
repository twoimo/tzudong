import { openDB, DBSchema, IDBPDatabase } from 'idb';

// 제보 모달 임시 저장 데이터 타입
export interface SubmissionDraft {
    id: string; // userId_submissionMode
    userId: string;
    submissionMode: 'new' | 'request';
    restaurant_name: string;
    address: string;
    phone: string;
    categories: string[];
    youtube_link: string;
    description: string;
    savedAt: string;
}

// IndexedDB 스키마 정의
interface SubmissionDraftDB extends DBSchema {
    'submission-drafts': {
        key: string;
        value: SubmissionDraft;
        indexes: {
            'by-user': string;
            'by-mode': string;
        };
    };
}

const DB_NAME = 'tzudong-submission-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'submission-drafts';

// IndexedDB 초기화
async function initDB(): Promise<IDBPDatabase<SubmissionDraftDB>> {
    return openDB<SubmissionDraftDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                });
                store.createIndex('by-user', 'userId');
                store.createIndex('by-mode', 'submissionMode');
            }
        },
    });
}

// Draft 키 생성
function getDraftKey(userId: string, submissionMode: 'new' | 'request'): string {
    return `${userId}_${submissionMode}`;
}

// Draft 저장
export async function saveDraft(draft: Omit<SubmissionDraft, 'id' | 'savedAt'>): Promise<void> {
    try {
        const db = await initDB();
        const id = getDraftKey(draft.userId, draft.submissionMode);

        const submissionDraft: SubmissionDraft = {
            ...draft,
            id,
            savedAt: new Date().toISOString(),
        };

        await db.put(STORE_NAME, submissionDraft);
    } catch (error) {
        console.error('Draft 저장 실패:', error);
        throw new Error('임시 저장에 실패했습니다.');
    }
}

// Draft 불러오기
export async function getDraft(userId: string, submissionMode: 'new' | 'request'): Promise<SubmissionDraft | null> {
    try {
        const db = await initDB();
        const id = getDraftKey(userId, submissionMode);
        const draft = await db.get(STORE_NAME, id);
        return draft || null;
    } catch (error) {
        console.error('Draft 불러오기 실패:', error);
        return null;
    }
}

// Draft 존재 여부 확인
export async function hasDraft(userId: string, submissionMode: 'new' | 'request'): Promise<boolean> {
    try {
        const draft = await getDraft(userId, submissionMode);
        return draft !== null;
    } catch (error) {
        console.error('Draft 확인 실패:', error);
        return false;
    }
}

// Draft 삭제
export async function deleteDraft(userId: string, submissionMode: 'new' | 'request'): Promise<void> {
    try {
        const db = await initDB();
        const id = getDraftKey(userId, submissionMode);
        await db.delete(STORE_NAME, id);
    } catch (error) {
        console.error('Draft 삭제 실패:', error);
        throw new Error('임시 저장 데이터 삭제에 실패했습니다.');
    }
}

// 사용자의 모든 Draft 목록 가져오기
export async function getAllDraftsByUser(userId: string): Promise<SubmissionDraft[]> {
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
