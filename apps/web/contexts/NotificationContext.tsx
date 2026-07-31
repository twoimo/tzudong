'use client';

import React, { useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import type { Database, Json } from '@/integrations/supabase/types';
import { Notification, NotificationContextType, NotificationType } from '@/types/notification';
import { useAuth } from '@/contexts/AuthContext';
import { NotificationContext } from '@/contexts/NotificationContextBase';
import { assertPrivacySafe } from '@/lib/privacy/sanitize';

export { StaticNotificationProvider, useNotifications } from '@/contexts/NotificationContextBase';

type NotificationRecord = {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    created_at: string;
    is_read: boolean;
    data?: Record<string, unknown>;
};

type RpcErrorLike = {
    code?: string;
    message?: string;
} | null;

type RpcResult = {
    data: unknown;
    error: RpcErrorLike;
};

type NotificationRpcDefinitions = Database['public']['Functions'];
export type NotificationRpcRequest =
    | {
        fn: 'create_user_notification';
        params: NotificationRpcDefinitions['create_user_notification']['Args'];
    }
    | {
        fn: 'mark_notification_read';
        params: NotificationRpcDefinitions['mark_notification_read']['Args'];
    }
    | {
        fn: 'mark_all_notifications_read';
    }
    | {
        fn: 'delete_notification';
        params: NotificationRpcDefinitions['delete_notification']['Args'];
    };

export type NotificationRpcClient = {
    rpc: (request: NotificationRpcRequest) => Promise<RpcResult>;
};

type SupabaseClient = typeof import('@/integrations/supabase/client').supabase;

let supabaseClientPromise: Promise<SupabaseClient> | null = null;
const NOTIFICATION_SELECT = 'id, type, title, message, created_at, is_read, data';

function getSupabaseClient(): Promise<SupabaseClient> {
    supabaseClientPromise ??= import('@/integrations/supabase/client').then((mod) => mod.supabase);
    return supabaseClientPromise;
}

async function callRpc(request: NotificationRpcRequest): Promise<RpcResult> {
    const supabase = await getSupabaseClient();

    switch (request.fn) {
        case 'create_user_notification':
        case 'mark_notification_read':
        case 'delete_notification':
            return supabase.rpc(request.fn, request.params);
        case 'mark_all_notifications_read':
            return supabase.rpc(request.fn);
    }
}

const ADMIN_NOTIFICATION_ENDPOINT = '/api/admin/notifications';
export const MARKETING_CAMPAIGN_REQUIRED = 'marketing_campaign_required';
const OWNER_NOTIFICATION_RPC_NAMES = new Set<NotificationRpcRequest['fn']>([
    'create_user_notification',
    'mark_notification_read',
    'mark_all_notifications_read',
    'delete_notification',
]);
const ADMIN_TRANSACTIONAL_NOTIFICATION_TYPES = new Set([
    'submission_approved',
    'submission_rejected',
    'review_approved',
    'review_rejected',
    'user_ranking',
] as const);
const MARKETING_NOTIFICATION_TYPES = new Set([
    'admin_announcement',
    'new_restaurant',
    'new_restaurants_batch',
] as const);

type AdminTransactionalNotificationType =
    | 'submission_approved'
    | 'submission_rejected'
    | 'review_approved'
    | 'review_rejected'
    | 'user_ranking';
type MarketingNotificationType =
    | 'admin_announcement'
    | 'new_restaurant'
    | 'new_restaurants_batch';
type AdminNotificationPayload = {
    recipientUserId: string;
    type: AdminTransactionalNotificationType;
    title: string;
    message: string;
    data?: Record<string, unknown>;
};

function isAdminTransactionalNotificationType(type: NotificationType): type is AdminTransactionalNotificationType {
    return ADMIN_TRANSACTIONAL_NOTIFICATION_TYPES.has(type as AdminTransactionalNotificationType);
}

function isMarketingNotificationType(type: NotificationType): type is MarketingNotificationType {
    return MARKETING_NOTIFICATION_TYPES.has(type as MarketingNotificationType);
}

function requireConsentGatedMarketingCampaign(): never {
    throw new Error(MARKETING_CAMPAIGN_REQUIRED);
}

function assertOutgoingNotificationPrivacy(value: unknown): void {
    try {
        assertPrivacySafe(value);
    } catch {
        throw new Error('invalid_notification_payload');
    }
}
function isJson(value: unknown): value is Json {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) return value.every(isJson);
    if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;

    return Object.values(value).every((entry) => entry === undefined || isJson(entry));
}
function getAdminNotificationErrorCode(responseBody: unknown) {
    if (!responseBody || typeof responseBody !== 'object') return 'notification_send_failed';

    const code = 'code' in responseBody ? responseBody.code : null;
    return code === MARKETING_CAMPAIGN_REQUIRED ||
        code === 'invalid_notification_payload' ||
        code === 'notification_type_not_allowed' ||
        code === 'notification_readback_failed'
        ? code
        : 'notification_send_failed';
}

async function sendAdminTransactionalNotification(payload: AdminNotificationPayload): Promise<void> {
    const requestBody = {
        recipientUserId: payload.recipientUserId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        data: payload.data ?? {},
    };
    assertOutgoingNotificationPrivacy([requestBody.recipientUserId, requestBody.type, requestBody.title, requestBody.message, requestBody.data]);

    const response = await fetch(ADMIN_NOTIFICATION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(requestBody),
    });
    const responseBody: unknown = await response.json().catch(() => null);

    if (!response.ok || !responseBody || typeof responseBody !== 'object' || !('success' in responseBody) || responseBody.success !== true) {
        throw new Error(getAdminNotificationErrorCode(responseBody));
    }
}

async function callNotificationMutation(
    request: NotificationRpcRequest,
    retryMessage: string,
    assertValues: readonly unknown[],
    rpc: NotificationRpcClient['rpc'] = callRpc,
) {
    if (!OWNER_NOTIFICATION_RPC_NAMES.has(request.fn)) throw new Error('notification_mutation_not_allowed');
    assertOutgoingNotificationPrivacy(assertValues);

    const { error } = await rpc(request);
    if (error) throw new Error(retryMessage);
}

type OwnerNotificationMutation = 'mark-as-read' | 'remove';
export function applyOwnerNotificationMutation(
    mutation: OwnerNotificationMutation,
    id: string,
    notifications: readonly Notification[],
): Notification[] {
    return mutation === 'mark-as-read'
        ? notifications.map((notification) => (
            notification.id === id ? { ...notification, isRead: true } : notification
        ))
        : notifications.filter((notification) => notification.id !== id);
}


const OWNER_NOTIFICATION_MUTATION_CONFIG = {
    'mark-as-read': {
        fn: 'mark_notification_read',
        retryMessage: '알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
    remove: {
        fn: 'delete_notification',
        retryMessage: '알림을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    },
} as const;

export async function runOwnerNotificationMutation(
    mutation: OwnerNotificationMutation,
    id: string,
    onSuccess: () => void,
    rpc: NotificationRpcClient['rpc'] = callRpc,
): Promise<void> {
    const { retryMessage } = OWNER_NOTIFICATION_MUTATION_CONFIG[mutation];
    const request: NotificationRpcRequest = mutation === 'mark-as-read'
        ? { fn: 'mark_notification_read', params: { notification_uuid: id } }
        : { fn: 'delete_notification', params: { notification_uuid: id } };

    try {
        await callNotificationMutation(
            request,
            retryMessage,
            [id],
            rpc,
        );
    } catch {
        throw new Error(retryMessage);
    }

    onSuccess();
}

function normalizeNotification(input: Partial<NotificationRecord>): Notification {
    return {
        id: String(input.id ?? ''),
        type: (input.type ?? 'admin_announcement') as NotificationType,
        title: String(input.title ?? ''),
        message: String(input.message ?? ''),
        createdAt: new Date(input.created_at ?? new Date().toISOString()),
        isRead: Boolean(input.is_read),
        data: (input.data && typeof input.data === 'object' ? input.data : {}) as Record<string, unknown>,
    };
}
const MAX_NOTIFICATIONS = 50;

export function prependRealtimeNotification(
    notifications: readonly Notification[],
    notification: Notification,
): Notification[] {
    return [notification, ...notifications.filter((current) => current.id !== notification.id)].slice(0, MAX_NOTIFICATIONS);
}

export function reconcileNotificationReadback(
    authoritativeNotifications: readonly Notification[],
    realtimeNotificationsAfterQueryStart: readonly Notification[],
): Notification[] {
    const authoritativeIds = new Set<string>();
    const authoritative = authoritativeNotifications.filter((notification) => {
        if (authoritativeIds.has(notification.id)) return false;
        authoritativeIds.add(notification.id);
        return true;
    });
    const realtimeById = new Map<string, Notification>();

    for (const notification of realtimeNotificationsAfterQueryStart) {
        if (!authoritativeIds.has(notification.id)) {
            realtimeById.set(notification.id, notification);
        }
    }

    const realtime = [...realtimeById.values()].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
    return [...realtime, ...authoritative].slice(0, MAX_NOTIFICATIONS);
}

type NotificationRealtimePayload = {
    new: Partial<NotificationRecord>;
};

type NotificationRealtimeChannel = {
    on: (
        event: 'postgres_changes',
        filter: {
            event: 'INSERT';
            schema: 'public';
            table: 'notifications';
            filter: string;
        },
        callback: (payload: NotificationRealtimePayload) => void,
    ) => NotificationRealtimeChannel;
    subscribe: (callback: (status: string) => void) => NotificationRealtimeChannel;
};

type NotificationRealtimeClient = {
    channel: (name: string) => NotificationRealtimeChannel;
    removeChannel: (channel: NotificationRealtimeChannel) => Promise<unknown>;
};

type NotificationRealtimeSubscriptionOptions = {
    userId: string;
    getClient: () => Promise<NotificationRealtimeClient>;
    reloadFromServer: (
        isReadbackActive: () => boolean,
        registerInvalidate: (invalidate: () => void) => void,
    ) => Promise<boolean>;
    onInsert: (payload: NotificationRealtimePayload) => void;
    onTransportDegraded: () => void;
    onRecovered: () => void;
    scheduleRetry?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancelRetry?: (timer: ReturnType<typeof setTimeout>) => void;
    scheduleDeadline?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    cancelDeadline?: (timer: ReturnType<typeof setTimeout>) => void;
};

export const REALTIME_RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const NOTIFICATION_CLIENT_ACQUISITION_TIMEOUT_MS = 5_000;
export const NOTIFICATION_FIRST_STATUS_TIMEOUT_MS = 5_000;
export const NOTIFICATION_READBACK_TIMEOUT_MS = 5_000;
const REALTIME_KNOWN_STATUSES = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

function isRealtimeFailureStatus(status: string) {
    return status === 'CHANNEL_ERROR'
        || status === 'TIMED_OUT'
        || status === 'CLOSED'
        || !REALTIME_KNOWN_STATUSES.has(status);
}

export function createNotificationRealtimeSubscription({
    userId,
    getClient,
    reloadFromServer,
    onInsert,
    onTransportDegraded,
    onRecovered,
    scheduleRetry = setTimeout,
    cancelRetry = clearTimeout,
    scheduleDeadline = scheduleRetry,
    cancelDeadline = cancelRetry,
}: NotificationRealtimeSubscriptionOptions) {
    let isStopped = false;
    let retryAttempts = 0;
    let nextAttemptId = 0;
    let activeAttemptId: number | undefined;
    let nextReadbackId = 0;
    let activeReadbackId: number | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let clientDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let statusDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let readbackDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let channel: NotificationRealtimeChannel | undefined;
    let channelClient: NotificationRealtimeClient | undefined;
    let activeReadbackInvalidate: (() => void) | undefined;

    const clearClientDeadline = () => {
        if (clientDeadlineTimer !== undefined) {
            cancelDeadline(clientDeadlineTimer);
            clientDeadlineTimer = undefined;
        }
    };

    const clearStatusDeadline = () => {
        if (statusDeadlineTimer !== undefined) {
            cancelDeadline(statusDeadlineTimer);
            statusDeadlineTimer = undefined;
        }
    };

    const invalidateReadbackAttempt = () => {
        activeReadbackInvalidate?.();
        activeReadbackInvalidate = undefined;
        activeReadbackId = undefined;
        nextReadbackId += 1;
        if (readbackDeadlineTimer !== undefined) {
            cancelDeadline(readbackDeadlineTimer);
            readbackDeadlineTimer = undefined;
        }
    };

    const removeCurrentChannel = () => {
        const channelToRemove = channel;
        const clientToRemoveChannel = channelClient;
        channel = undefined;
        channelClient = undefined;

        if (channelToRemove && clientToRemoveChannel) {
            void clientToRemoveChannel.removeChannel(channelToRemove).catch(() => undefined);
        }
    };

    const isAttemptActive = (attemptId: number) => !isStopped && activeAttemptId === attemptId;

    const scheduleRecovery = () => {
        if (isStopped || retryTimer !== undefined || retryAttempts >= REALTIME_RECOVERY_DELAYS_MS.length) return;

        const delayMs = REALTIME_RECOVERY_DELAYS_MS[retryAttempts];
        retryAttempts += 1;
        retryTimer = scheduleRetry(() => {
            retryTimer = undefined;
            connect();
        }, delayMs);
    };

    const handleTransportFailure = (attemptId: number) => {
        if (!isAttemptActive(attemptId)) return;

        activeAttemptId = undefined;
        clearClientDeadline();
        clearStatusDeadline();
        invalidateReadbackAttempt();
        onTransportDegraded();
        removeCurrentChannel();
        scheduleRecovery();
    };

    const startReadback = (attemptId: number, nextChannel: NotificationRealtimeChannel) => {
        if (!isAttemptActive(attemptId) || channel !== nextChannel || activeReadbackId !== undefined) return;

        const readbackId = ++nextReadbackId;
        activeReadbackId = readbackId;
        readbackDeadlineTimer = scheduleDeadline(() => {
            if (activeReadbackId === readbackId && isAttemptActive(attemptId) && channel === nextChannel) {
                handleTransportFailure(attemptId);
            }
        }, NOTIFICATION_READBACK_TIMEOUT_MS);
        if (activeReadbackId !== readbackId || !isAttemptActive(attemptId) || channel !== nextChannel) return;

        const isThisReadbackActive = () => (
            activeReadbackId === readbackId
            && isAttemptActive(attemptId)
            && channel === nextChannel
        );
        void Promise.resolve()
            .then(() => reloadFromServer(
                isThisReadbackActive,
                (invalidate) => {
                    if (isThisReadbackActive()) {
                        activeReadbackInvalidate = invalidate;
                    } else {
                        invalidate();
                    }
                },
            ))
            .then((didReadBack) => {
                if (!isThisReadbackActive()) return;

                if (!didReadBack) {
                    handleTransportFailure(attemptId);
                    return;
                }

                if (readbackDeadlineTimer !== undefined) {
                    cancelDeadline(readbackDeadlineTimer);
                    readbackDeadlineTimer = undefined;
                }
                activeReadbackInvalidate = undefined;
                activeReadbackId = undefined;
                retryAttempts = 0;
                onRecovered();
            })
            .catch(() => {
                if (isThisReadbackActive()) {
                    handleTransportFailure(attemptId);
                }
            })
            .finally(() => {
                if (activeReadbackId === readbackId) {
                    activeReadbackInvalidate = undefined;
                    activeReadbackId = undefined;
                    if (readbackDeadlineTimer !== undefined) {
                        cancelDeadline(readbackDeadlineTimer);
                        readbackDeadlineTimer = undefined;
                    }
                }
            });
    };

    const handleStatus = (attemptId: number, nextChannel: NotificationRealtimeChannel, status: string) => {
        if (!isAttemptActive(attemptId) || channel !== nextChannel) return;

        clearStatusDeadline();
        if (isRealtimeFailureStatus(status)) {
            handleTransportFailure(attemptId);
            return;
        }

        startReadback(attemptId, nextChannel);
    };

    const connect = () => {
        if (isStopped || activeAttemptId !== undefined || channel) return;

        const attemptId = ++nextAttemptId;
        activeAttemptId = attemptId;
        clientDeadlineTimer = scheduleDeadline(() => {
            handleTransportFailure(attemptId);
        }, NOTIFICATION_CLIENT_ACQUISITION_TIMEOUT_MS);

        let clientPromise: Promise<NotificationRealtimeClient>;
        try {
            clientPromise = getClient();
        } catch {
            handleTransportFailure(attemptId);
            return;
        }

        void clientPromise
            .then((nextClient) => {
                if (!isAttemptActive(attemptId)) return;

                clearClientDeadline();
                const nextChannel = nextClient.channel('notifications');
                if (!isAttemptActive(attemptId)) {
                    void nextClient.removeChannel(nextChannel).catch(() => undefined);
                    return;
                }

                channel = nextChannel;
                channelClient = nextClient;
                statusDeadlineTimer = scheduleDeadline(() => {
                    if (isAttemptActive(attemptId) && channel === nextChannel) {
                        handleTransportFailure(attemptId);
                    }
                }, NOTIFICATION_FIRST_STATUS_TIMEOUT_MS);
                if (!isAttemptActive(attemptId) || channel !== nextChannel) return;
                nextChannel.on(
                    'postgres_changes',
                    {
                        event: 'INSERT',
                        schema: 'public',
                        table: 'notifications',
                        filter: `user_id=eq.${userId}`,
                    },
                    (payload) => {
                        if (isAttemptActive(attemptId) && channel === nextChannel) {
                            onInsert(payload);
                        }
                    },
                );
                nextChannel.subscribe((status) => handleStatus(attemptId, nextChannel, status));
            })
            .catch(() => {
                handleTransportFailure(attemptId);
            });
    };

    connect();

    return {
        stop: () => {
            if (isStopped) return;
            isStopped = true;
            activeAttemptId = undefined;
            invalidateReadbackAttempt();
            clearClientDeadline();
            clearStatusDeadline();

            if (retryTimer !== undefined) {
                cancelRetry(retryTimer);
                retryTimer = undefined;
            }

            removeCurrentChannel();
        },
    };
}

type NotificationOwnerScope = {
    userId: string | undefined;
    generation: number;
};

type NotificationSnapshot = {
    ownerId: string | undefined;
    notifications: Notification[];
    isLoading: boolean;
    isError: boolean;
};

type RealtimeInsertJournalEntry = {
    scope: NotificationOwnerScope;
    sequence: number;
    notification: Notification;
};
type NotificationMutation =
    | { kind: 'mark-as-read'; id: string }
    | { kind: 'mark-all-as-read' }
    | { kind: 'remove'; id: string };

type NotificationMutationJournalEntry = {
    scope: NotificationOwnerScope;
    sequence: number;
    mutation: NotificationMutation;
};

export function replayNotificationMutations(
    notifications: readonly Notification[],
    mutations: readonly NotificationMutationJournalEntry[],
): Notification[] {
    let reconciled = [...notifications];

    for (const { mutation } of [...mutations].sort((left, right) => left.sequence - right.sequence)) {
        if (mutation.kind === 'mark-as-read') {
            reconciled = reconciled.map((notification) => (
                notification.id === mutation.id ? { ...notification, isRead: true } : notification
            ));
        } else if (mutation.kind === 'mark-all-as-read') {
            reconciled = reconciled.map((notification) => ({ ...notification, isRead: true }));
        } else {
            reconciled = reconciled.filter((notification) => notification.id !== mutation.id);
        }
    }

    return reconciled.slice(0, MAX_NOTIFICATIONS);
}

type NotificationLoadRequest = {
    scope: NotificationOwnerScope;
    generation: number;
};

function hasNotificationOwnerScope(
    left: NotificationOwnerScope,
    right: NotificationOwnerScope,
) {
    return left.userId === right.userId && left.generation === right.generation;
}

export function createNotificationLoadRequestTracker() {
    let nextGeneration = 0;
    let activeRequest: NotificationLoadRequest | undefined;

    return {
        begin: (scope: NotificationOwnerScope): NotificationLoadRequest => {
            const request = {
                scope: { ...scope },
                generation: ++nextGeneration,
            };
            activeRequest = request;
            return request;
        },
        invalidate: (scope: NotificationOwnerScope) => {
            if (activeRequest && hasNotificationOwnerScope(activeRequest.scope, scope)) {
                activeRequest = undefined;
            }
        },
        invalidateRequest: (request: NotificationLoadRequest) => {
            if (
                !activeRequest
                || activeRequest.generation !== request.generation
                || !hasNotificationOwnerScope(activeRequest.scope, request.scope)
            ) return false;

            activeRequest = undefined;
            return true;
        },
        isIdleAfterInvalidating: (request: NotificationLoadRequest) => (
            activeRequest === undefined && nextGeneration === request.generation
        ),
        isActive: (request: NotificationLoadRequest) => (
            activeRequest !== undefined
            && activeRequest.generation === request.generation
            && hasNotificationOwnerScope(activeRequest.scope, request.scope)
        ),
    };
}

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const userId = user?.id;
    const [notificationSnapshot, setNotificationSnapshot] = useState<NotificationSnapshot>(() => ({
        ownerId: userId,
        notifications: [],
        isLoading: Boolean(userId),
        isError: false,
    }));
    const isMountedRef = useRef(true);
    const ownerScopeRef = useRef<NotificationOwnerScope>({ userId, generation: 0 });
    const realtimeFailureUserIdRef = useRef<string | undefined>(undefined);
    const realtimeInsertSequenceRef = useRef(0);
    const realtimeInsertJournalRef = useRef<RealtimeInsertJournalEntry[]>([]);
    const loadRequestTrackerRef = useRef(createNotificationLoadRequestTracker());
    const notificationMutationSequenceRef = useRef(0);
    const notificationMutationJournalRef = useRef<NotificationMutationJournalEntry[]>([]);


    const isCurrentOwnerScope = useCallback((scope: NotificationOwnerScope) => (
        isMountedRef.current
        && ownerScopeRef.current.userId === scope.userId
        && ownerScopeRef.current.generation === scope.generation
    ), []);
    const invalidateLoadRequest = useCallback((scope: NotificationOwnerScope) => {
        loadRequestTrackerRef.current.invalidate(scope);
    }, []);

    const isCurrentLoadRequest = useCallback((
        scope: NotificationOwnerScope,
        request: NotificationLoadRequest,
    ) => (
        isCurrentOwnerScope(scope) && loadRequestTrackerRef.current.isActive(request)
    ), [isCurrentOwnerScope]);

    const commitOwnerSnapshot = useCallback((
        scope: NotificationOwnerScope,
        update: (snapshot: NotificationSnapshot) => NotificationSnapshot,
        canCommit: () => boolean = () => true,
    ) => {
        if (!isCurrentOwnerScope(scope) || !canCommit()) return;

        setNotificationSnapshot((current) => {
            if (!isCurrentOwnerScope(scope) || !canCommit()) return current;

            const ownerSnapshot = current.ownerId === scope.userId
                ? current
                : {
                    ownerId: scope.userId,
                    notifications: [],
                    isLoading: false,
                    isError: false,
                };
            return update(ownerSnapshot);
        });
    }, [isCurrentOwnerScope]);
    const recordNotificationMutation = useCallback((
        scope: NotificationOwnerScope,
        mutation: NotificationMutation,
    ) => {
        if (!isCurrentOwnerScope(scope)) return;

        const sequence = ++notificationMutationSequenceRef.current;
        notificationMutationJournalRef.current = [
            ...notificationMutationJournalRef.current,
            { scope: { ...scope }, sequence, mutation },
        ];
    }, [isCurrentOwnerScope]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const loadNotifications = useCallback(async (
        scope: NotificationOwnerScope,
        {
            retainNotificationsOnFailure = false,
            shouldStart = () => true,
            onRequestStarted,
        }: {
            retainNotificationsOnFailure?: boolean;
            shouldStart?: () => boolean;
            onRequestStarted?: (invalidate: () => void) => void;
        } = {},
    ): Promise<boolean> => {
        if (!scope.userId) {
            invalidateLoadRequest(scope);
            if (isCurrentOwnerScope(scope)) {
                realtimeFailureUserIdRef.current = undefined;
                commitOwnerSnapshot(scope, () => ({
                    ownerId: undefined,
                    notifications: [],
                    isLoading: false,
                    isError: false,
                }));
            }
            return true;
        }

        if (!shouldStart()) return false;

        const request = loadRequestTrackerRef.current.begin(scope);
        const canCommitRequest = () => isCurrentLoadRequest(scope, request);
        const invalidateOwnedRequest = () => {
            if (
                !isCurrentOwnerScope(scope)
                || !loadRequestTrackerRef.current.invalidateRequest(request)
            ) return;

            setNotificationSnapshot((current) => {
                if (
                    !isCurrentOwnerScope(scope)
                    || !loadRequestTrackerRef.current.isIdleAfterInvalidating(request)
                    || current.ownerId !== scope.userId
                ) return current;

                return {
                    ...current,
                    isLoading: false,
                };
            });
        };
        const queryStartInsertSequence = realtimeInsertSequenceRef.current;
        const queryStartMutationSequence = notificationMutationSequenceRef.current;
        commitOwnerSnapshot(scope, (current) => ({
            ...current,
            isLoading: true,
        }), canCommitRequest);
        onRequestStarted?.(invalidateOwnedRequest);
        if (!canCommitRequest()) return false;

        try {
            const supabase = await getSupabaseClient();
            const { data, error } = await supabase
                .from('notifications')
                .select(NOTIFICATION_SELECT)
                .eq('user_id', scope.userId)
                .order('created_at', { ascending: false })
                .limit(MAX_NOTIFICATIONS);

            if (!canCommitRequest()) return false;

            if (error) {
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    notifications: retainNotificationsOnFailure ? current.notifications : [],
                    isError: true,
                }), canCommitRequest);
                return false;
            }

            const rows = (Array.isArray(data) ? data : []) as Partial<NotificationRecord>[];
            const authoritativeNotifications = rows.map(normalizeNotification);
            const realtimeNotificationsAfterQueryStart = realtimeInsertJournalRef.current
                .filter((entry) => (
                    entry.scope.userId === scope.userId
                    && entry.scope.generation === scope.generation
                    && entry.sequence > queryStartInsertSequence
                ))
                .map((entry) => entry.notification);
            const mutationsAfterQueryStart = notificationMutationJournalRef.current
                .filter((entry) => (
                    entry.scope.userId === scope.userId
                    && entry.scope.generation === scope.generation
                    && entry.sequence > queryStartMutationSequence
                ));

            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                notifications: replayNotificationMutations(
                    reconcileNotificationReadback(
                        authoritativeNotifications,
                        realtimeNotificationsAfterQueryStart,
                    ),
                    mutationsAfterQueryStart,
                ),
                isError: realtimeFailureUserIdRef.current === scope.userId ? current.isError : false,
            }), canCommitRequest);
            return canCommitRequest();
        } catch {
            if (canCommitRequest()) {
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    notifications: retainNotificationsOnFailure ? current.notifications : [],
                    isError: true,
                }), canCommitRequest);
            }
            return false;
        } finally {
            if (canCommitRequest()) {
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    isLoading: false,
                }), canCommitRequest);
            }
        }
    }, [commitOwnerSnapshot, invalidateLoadRequest, isCurrentLoadRequest, isCurrentOwnerScope]);

    useEffect(() => {
        const previousScope = ownerScopeRef.current;
        if (previousScope.userId !== userId) {
            loadRequestTrackerRef.current.invalidate(previousScope);
            ownerScopeRef.current = {
                userId,
                generation: previousScope.generation + 1,
            };
        }
        const scope = ownerScopeRef.current;
        realtimeInsertJournalRef.current = realtimeInsertJournalRef.current.filter((entry) => (
            entry.scope.userId === scope.userId && entry.scope.generation === scope.generation
        ));
        notificationMutationJournalRef.current = notificationMutationJournalRef.current.filter((entry) => (
            entry.scope.userId === scope.userId && entry.scope.generation === scope.generation
        ));

        commitOwnerSnapshot(scope, () => ({
            ownerId: scope.userId,
            notifications: [],
            isLoading: Boolean(scope.userId),
            isError: false,
        }));
        if (!scope.userId) {
            realtimeFailureUserIdRef.current = undefined;
            return;
        }

        void loadNotifications(scope);
    }, [userId, commitOwnerSnapshot, loadNotifications]);

    useEffect(() => {
        const scope = ownerScopeRef.current;
        if (!scope.userId) return;

        const subscription = createNotificationRealtimeSubscription({
            userId: scope.userId,
            getClient: async () => (await getSupabaseClient()) as unknown as NotificationRealtimeClient,
            reloadFromServer: (isReadbackActive, registerInvalidate) => loadNotifications(scope, {
                retainNotificationsOnFailure: true,
                shouldStart: isReadbackActive,
                onRequestStarted: registerInvalidate,
            }),
            onInsert: (payload) => {
                if (!isCurrentOwnerScope(scope)) return;

                const next = normalizeNotification(payload.new);
                const sequence = ++realtimeInsertSequenceRef.current;
                realtimeInsertJournalRef.current = [
                    ...realtimeInsertJournalRef.current.filter((entry) => (
                        entry.scope.userId !== scope.userId
                        || entry.scope.generation !== scope.generation
                        || entry.notification.id !== next.id
                    )),
                    { scope, sequence, notification: next },
                ].slice(-MAX_NOTIFICATIONS);

                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    notifications: prependRealtimeNotification(current.notifications, next),
                }));
            },
            onTransportDegraded: () => {
                if (!isCurrentOwnerScope(scope)) return;

                realtimeFailureUserIdRef.current = scope.userId;
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    isLoading: false,
                    isError: true,
                }));
            },
            onRecovered: () => {
                if (!isCurrentOwnerScope(scope)) return;

                realtimeFailureUserIdRef.current = undefined;
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    isError: false,
                }));
            },
        });

        return () => {
            subscription.stop();
        };
    }, [userId, commitOwnerSnapshot, isCurrentOwnerScope, loadNotifications]);

    const currentOwnerSnapshot = notificationSnapshot.ownerId === userId
        ? notificationSnapshot
        : {
            ownerId: userId,
            notifications: [],
            isLoading: Boolean(userId),
            isError: false,
        };
    const notifications = currentOwnerSnapshot.notifications;
    const unreadCount = notifications.filter((notification) => !notification.isRead).length;
    const isLoading = currentOwnerSnapshot.isLoading;
    const isError = currentOwnerSnapshot.isError;

    const markAsRead = async (id: string) => {
        const scope = ownerScopeRef.current;
        try {
            await runOwnerNotificationMutation('mark-as-read', id, () => {
                recordNotificationMutation(scope, { kind: 'mark-as-read', id });
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    notifications: applyOwnerNotificationMutation('mark-as-read', id, current.notifications),
                }));
            });
        } catch {
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                isError: true,
            }));
            throw new Error('알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };

    const markAllAsRead = async () => {
        const scope = ownerScopeRef.current;
        try {
            await callNotificationMutation({ fn: 'mark_all_notifications_read' }, '모든 알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', []);
            recordNotificationMutation(scope, { kind: 'mark-all-as-read' });
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                notifications: current.notifications.map((notification) => ({ ...notification, isRead: true })),
            }));
        } catch {
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                isError: true,
            }));
            throw new Error('모든 알림을 읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };

    const addNotification = async (notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
        const scope = ownerScopeRef.current;
        if (!scope.userId) {
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                isError: true,
            }));
            throw new Error('로그인 후 알림을 만들 수 있습니다.');
        }
        if (isMarketingNotificationType(notification.type)) {
            return requireConsentGatedMarketingCampaign();
        }

        const notificationData = notification.data ?? {};
        try {
            if (!isJson(notificationData)) throw new Error('invalid_notification_payload');
            await callNotificationMutation(
                {
                    fn: 'create_user_notification',
                    params: {
                        p_user_id: scope.userId,
                        p_type: notification.type,
                        p_title: notification.title,
                        p_message: notification.message,
                        p_data: notificationData,
                    },
                },
                '알림을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.',
                [scope.userId, notification.type, notification.title, notification.message, notificationData],
            );
        } catch {
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                isError: true,
            }));
            throw new Error('알림을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };

    const removeNotification = async (id: string) => {
        const scope = ownerScopeRef.current;
        try {
            await runOwnerNotificationMutation('remove', id, () => {
                recordNotificationMutation(scope, { kind: 'remove', id });
                commitOwnerSnapshot(scope, (current) => ({
                    ...current,
                    notifications: applyOwnerNotificationMutation('remove', id, current.notifications),
                }));
            });
        } catch {
            commitOwnerSnapshot(scope, (current) => ({
                ...current,
                isError: true,
            }));
            throw new Error('알림을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
    };

    const value: NotificationContextType = {
        notifications,
        unreadCount,
        isLoading,
        isError,
        markAsRead,
        markAllAsRead,
        addNotification,
        removeNotification,
    };

    return (
        <NotificationContext.Provider value={value}>
            {children}
        </NotificationContext.Provider>
    );
};

// 공지·신규 맛집 알림은 수신 동의 기반 마케팅 캠페인으로만 전송한다.
export const createAdminAnnouncement = async (
    _title: string,
    _message: string,
    _customData?: Record<string, unknown>,
): Promise<never> => {
    return requireConsentGatedMarketingCampaign();
};

// 신규 맛집 등록 알림은 수신 동의 기반 마케팅 캠페인으로만 전송한다.
export const createNewRestaurantNotification = async (
    _restaurantName: string,
    _address: string,
    _customData?: Record<string, unknown>,
): Promise<never> => {
    return requireConsentGatedMarketingCampaign();
};

// 사용자 랭킹 업데이트 알림 생성 함수
export const createUserRankingNotification = async (
    userId: string,
    ranking: number,
    period: string = 'monthly',
) => {
    if (!Number.isInteger(ranking) || ranking < 1 || ranking > 1_000_000) {
        throw new Error('invalid_notification_payload');
    }

    return await sendAdminTransactionalNotification({
        recipientUserId: userId,
        type: 'user_ranking',
        title: '랭킹이 업데이트되었습니다',
        message: `이번 ${period} 랭킹은 ${ranking}위입니다.`,
        data: { ranking, period },
    });
};

// 특정 사용자에게 거래성 알림 생성 함수
export const createUserNotification = async (
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    customData?: Record<string, unknown>,
) => {
    if (isMarketingNotificationType(type)) {
        return requireConsentGatedMarketingCampaign();
    }
    if (!isAdminTransactionalNotificationType(type)) {
        throw new Error('notification_type_not_allowed');
    }
    const safeCustomData = customData ?? {};
    assertOutgoingNotificationPrivacy([userId, type, title, message, safeCustomData]);

    return await sendAdminTransactionalNotification({
        recipientUserId: userId,
        type,
        title,
        message,
        data: safeCustomData,
    });
};

// 제보 승인 알림 생성 함수
export const createSubmissionApprovedNotification = async (
    userId: string,
    restaurantName: string,
    submissionType: 'new' | 'edit',
    customData?: Record<string, unknown>,
) => {
    const typeLabel = submissionType === 'new' ? '신규 맛집 제보' : '정보 수정 제보';
    return await createUserNotification(
        userId,
        'submission_approved',
        '제보가 승인되었습니다',
        `"${restaurantName}" ${typeLabel}가 관리자에 의해 승인되어 지도에 반영되었습니다.`,
        customData,
    );
};

// 제보 거부 알림 생성 함수
export const createSubmissionRejectedNotification = async (
    userId: string,
    restaurantName: string,
    _rejectionReason: string,
    submissionType: 'new' | 'edit',
    customData?: Record<string, unknown>,
) => {
    const typeLabel = submissionType === 'new' ? '신규 맛집 제보' : '정보 수정 제보';
    return await createUserNotification(
        userId,
        'submission_rejected',
        '제보가 반려되었습니다',
        `"${restaurantName}" ${typeLabel}가 반려되었습니다. 자세한 내용은 제보 내역에서 확인해 주세요.`,
        customData,
    );
};

// 리뷰 승인 알림 생성 함수
export const createReviewApprovedNotification = async (
    userId: string,
    restaurantName: string,
    customData?: Record<string, unknown>,
) => {
    return await createUserNotification(
        userId,
        'review_approved',
        '리뷰 승인 완료',
        `"${restaurantName}" 리뷰가 승인되었습니다.`,
        customData,
    );
};

// 리뷰 거부 알림 생성 함수
export const createReviewRejectedNotification = async (
    userId: string,
    restaurantName: string,
    _rejectionReason: string,
    customData?: Record<string, unknown>,
) => {
    return await createUserNotification(
        userId,
        'review_rejected',
        '리뷰가 반려되었습니다',
        `"${restaurantName}" 리뷰가 반려되었습니다. 자세한 내용은 리뷰 내역에서 확인해 주세요.`,
        customData,
    );
};

// 여러 맛집 일괄 등록 알림은 수신 동의 기반 마케팅 캠페인으로만 전송한다.
export const createBatchNewRestaurantsNotification = async (
    _restaurantNames: string[],
    _customData?: Record<string, unknown>,
): Promise<never> => {
    return requireConsentGatedMarketingCampaign();
};
