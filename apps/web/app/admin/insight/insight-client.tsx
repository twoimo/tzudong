'use client';

import Link from 'next/link';
import { memo } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import InsightChatSection from '@/components/insight/InsightChatSection';
import styles from './insight-overhaul.module.css';

const InsightClientComponent = () => {
    const { isAdmin, isLoading: isAuthLoading } = useAuth();

    if (isAuthLoading) {
        return (
            <section className={styles.centerShell} aria-live="polite" aria-busy="true">
                <section className={styles.centerPanel}>
                    <div className={styles.statusBadge}>
                        <Loader2 className={styles.spin} aria-hidden="true" />
                        권한 확인 중
                    </div>
                    <h3 className={styles.centerPanelTitle}>관리자 권한을 확인하고 있어요</h3>
                    <p className={styles.panelHint}>잠시만 기다리면 인사이트 콘솔이 열립니다.</p>
                </section>
            </section>
        );
    }

    if (!isAdmin) {
        return (
            <section className={styles.centerShell}>
                <section className={styles.centerPanel}>
                    <div className={styles.deniedSign}>
                        <ShieldAlert size={16} aria-hidden="true" />
                    </div>
                    <h3 className={styles.centerPanelTitle}>관리자 전용 페이지입니다</h3>
                    <p className={styles.panelHint}>현재 계정은 관리자 권한이 없습니다.</p>
                    <Link href="/" className={styles.deniedAction}>
                        홈으로 이동
                    </Link>
                </section>
            </section>
        );
    }

    return (
        <section className={styles.pageShell}>
            <div className={styles.chatFrame}>
                <InsightChatSection />
            </div>
        </section>
    );
};

const InsightClient = memo(InsightClientComponent);

export default InsightClient;
