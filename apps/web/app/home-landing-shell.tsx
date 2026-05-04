import styles from './home-landing-shell.module.css';

export function HomeLandingShell() {
    return (
        <section
            aria-labelledby="home-landing-title"
            className={styles.shell}
            data-testid="home-landing-shell"
        >
            <div className={styles.decorLayer} aria-hidden="true">
                <div className={styles.primaryGlow} />
                <div className={styles.amberGlow} />
                <div className={styles.bottomFade} />
            </div>

            <div className={styles.content}>
                <div className={styles.copy}>
                    <p className={styles.badge}>쯔양 맛집 지도</p>
                    <div className={styles.headingGroup}>
                        <h1 id="home-landing-title" className={styles.title}>
                            쯔동여지도
                        </h1>
                        <p className={styles.description}>
                            쯔양이 다녀간 맛집을 지역과 카테고리별로 빠르게 찾아보세요. 지도는 첫 화면을 안정적으로 그린 뒤 자동으로 준비됩니다.
                        </p>
                    </div>
                    <div className={styles.features} aria-label="주요 기능">
                        <span>전국 맛집</span>
                        <span>지역 필터</span>
                        <span>리뷰와 제보</span>
                    </div>
                    <button
                        className={styles.launchButton}
                        data-testid="home-launch-map"
                        type="button"
                    >
                        지도 준비하기
                    </button>
                </div>

                <div className={styles.preview}>
                    <div className={styles.mapBase} aria-hidden="true" />
                    <div className={styles.mapCirclePrimary} aria-hidden="true" />
                    <div className={styles.mapCircleAmber} aria-hidden="true" />
                    <div className={styles.mapCircleLower} aria-hidden="true" />
                    <div className={styles.horizontalLine} aria-hidden="true" />
                    <div className={styles.verticalLine} aria-hidden="true" />

                    <div className={styles.pinPrimary} aria-hidden="true" />
                    <div className={styles.pinSecondary} aria-hidden="true" />
                    <div className={styles.pinAmber} aria-hidden="true" />

                    <div className={styles.infoCard}>
                        <p className={styles.infoTitle}>가벼운 첫 화면을 먼저 표시 중</p>
                        <p className={styles.infoText}>
                            네이버 지도 SDK와 맛집 지도 런타임은 사용자 상호작용 또는 브라우저 유휴 시간 이후 활성화됩니다.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
}
