'use client';

import Link from 'next/link';
import { memo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import InsightChatSection from '@/components/insight/InsightChatSection';
import styles from './insight-overhaul.module.css';

const InsightClientComponent = () => {
    const { isAdmin, isLoading: isAuthLoading } = useAuth();

    if (isAuthLoading) {
        return null;
    }

    if (!isAdmin) {
        return (
            <section className={styles.centerShell}>
                <section className={styles.centerPanel}>
                    <div className={styles.deniedSign}>!</div>
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
