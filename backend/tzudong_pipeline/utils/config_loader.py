"""
Config Loader - 설정 파일 로더

YAML 기반 설정 파일을 로드하고 환경변수와 병합합니다.
"""

import os
import yaml
from pathlib import Path
from typing import Any, Optional
from dataclasses import dataclass, field


# 기본 경로
CONFIG_DIR = Path(__file__).parent.parent / "config"
GEMINI_DIR = Path(__file__).parent.parent / ".gemini"


@dataclass
class GeminiConfig:
    """Gemini CLI 설정"""
    model: str = "gemini-2.0-flash-exp"
    requests_per_minute: int = 60
    requests_per_day: int = 1000
    delay_between_requests: float = 1.0
    max_retry_attempts: int = 5
    
    # OAuth 토큰
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_type: str = "Bearer"
    expiry_date: int = 0


@dataclass
class ChannelConfig:
    """유튜버 채널 설정"""
    channel_id: str
    name: str
    display_name: str = ""
    category: str = "먹방"
    enabled: bool = True
    priority: int = 1
    prompts: dict = field(default_factory=dict)
    collection: dict = field(default_factory=dict)
    existing_data: dict = field(default_factory=dict)


@dataclass
class ParallelConfig:
    """병렬 처리 설정"""
    branch1_workers: int = 3
    branch2_workers: int = 2
    branch3_workers: int = 5
    branch4_workers: int = 3
    ai_crawling_workers: int = 2
    ai_evaluation_workers: int = 2
    db_insert_batch_size: int = 50


@dataclass
class PipelineConfig:
    """전체 파이프라인 설정"""
    name: str = "tzudong-pipeline"
    version: str = "2.0.0"
    environment: str = "development"
    timezone: str = "Asia/Seoul"
    
    # 하위 설정
    gemini: GeminiConfig = field(default_factory=GeminiConfig)
    parallel: ParallelConfig = field(default_factory=ParallelConfig)
    channels: dict = field(default_factory=dict)
    
    # 데이터베이스
    primary_db: str = "oracle"
    
    # 로깅
    log_level: str = "INFO"


class ConfigLoader:
    """설정 파일 로더"""
    
    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or CONFIG_DIR
        self._config: Optional[dict] = None
        self._channels: Optional[dict] = None
        self._secrets: Optional[dict] = None
    
    def load(self) -> PipelineConfig:
        """전체 설정 로드"""
        # YAML 파일 로드
        self._config = self._load_yaml("config.yaml")
        self._channels = self._load_yaml("channels.yaml")
        self._secrets = self._load_yaml("secrets.yaml")
        
        # Gemini OAuth 토큰 로드
        gemini_oauth = self._load_gemini_oauth()
        
        # 환경변수로 덮어쓰기
        self._apply_env_overrides()
        
        # PipelineConfig 생성
        return self._build_config(gemini_oauth)
    
    def _load_yaml(self, filename: str) -> dict:
        """YAML 파일 로드"""
        filepath = self.config_dir / filename
        if not filepath.exists():
            print(f"⚠️ Config file not found: {filepath}")
            return {}
        
        with open(filepath, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    
    def _load_gemini_oauth(self) -> dict:
        """Gemini OAuth 토큰 로드"""
        oauth_path = GEMINI_DIR / "oauth_creds.json"
        
        if not oauth_path.exists():
            return {}
        
        import json
        with open(oauth_path, "r", encoding="utf-8") as f:
            return json.load(f)
    
    def _apply_env_overrides(self) -> None:
        """환경변수로 설정 덮어쓰기"""
        # Gemini 토큰
        if os.getenv("GEMINI_ACCESS_TOKEN"):
            if "gemini" not in self._secrets:
                self._secrets["gemini"] = {}
            self._secrets["gemini"]["access_token"] = os.getenv("GEMINI_ACCESS_TOKEN")
        
        if os.getenv("GEMINI_REFRESH_TOKEN"):
            if "gemini" not in self._secrets:
                self._secrets["gemini"] = {}
            self._secrets["gemini"]["refresh_token"] = os.getenv("GEMINI_REFRESH_TOKEN")
        
        # 기타 API 키
        env_mappings = {
            "YOUTUBE_API_KEY": ("youtube", "api_key"),
            "OPENAI_API_KEY": ("openai", "api_key"),
            "KAKAO_REST_API_KEY": ("kakao", "rest_api_key"),
            "NAVER_CLIENT_ID": ("naver", "client_id"),
            "NAVER_CLIENT_SECRET": ("naver", "client_secret"),
            "ORACLE_USER": ("oracle", "user"),
            "ORACLE_PASSWORD": ("oracle", "password"),
            "ORACLE_DSN": ("oracle", "dsn"),
            "SUPABASE_URL": ("supabase", "url"),
            "SUPABASE_KEY": ("supabase", "key"),
        }
        
        for env_var, (section, key) in env_mappings.items():
            value = os.getenv(env_var)
            if value:
                if section not in self._secrets:
                    self._secrets[section] = {}
                self._secrets[section][key] = value
    
    def _build_config(self, gemini_oauth: dict) -> PipelineConfig:
        """PipelineConfig 객체 생성"""
        pipeline = self._config.get("pipeline", {})
        gemini_cfg = self._config.get("gemini", {})
        parallel_cfg = self._config.get("parallel", {})
        
        # Gemini 설정
        gemini_secrets = self._secrets.get("gemini", {})
        gemini = GeminiConfig(
            model=gemini_cfg.get("model", "gemini-2.0-flash-exp"),
            requests_per_minute=gemini_cfg.get("rate_limit", {}).get("requests_per_minute", 60),
            requests_per_day=gemini_cfg.get("rate_limit", {}).get("requests_per_day", 1000),
            delay_between_requests=gemini_cfg.get("rate_limit", {}).get("delay_between_requests", 1.0),
            max_retry_attempts=gemini_cfg.get("retry", {}).get("max_attempts", 5),
            access_token=gemini_secrets.get("access_token") or gemini_oauth.get("access_token"),
            refresh_token=gemini_secrets.get("refresh_token") or gemini_oauth.get("refresh_token"),
            token_type=gemini_oauth.get("token_type", "Bearer"),
            expiry_date=gemini_oauth.get("expiry_date", 0),
        )
        
        # 병렬 처리 설정
        parallel = ParallelConfig(
            branch1_workers=parallel_cfg.get("branch1_workers", 3),
            branch2_workers=parallel_cfg.get("branch2_workers", 2),
            branch3_workers=parallel_cfg.get("branch3_workers", 5),
            branch4_workers=parallel_cfg.get("branch4_workers", 3),
            ai_crawling_workers=parallel_cfg.get("ai_crawling_workers", 2),
            ai_evaluation_workers=parallel_cfg.get("ai_evaluation_workers", 2),
            db_insert_batch_size=parallel_cfg.get("db_insert_batch_size", 50),
        )
        
        # 채널 설정
        channels = {}
        for channel_id, channel_data in self._channels.items():
            if isinstance(channel_data, dict):
                channels[channel_id] = ChannelConfig(
                    channel_id=channel_data.get("channel_id", ""),
                    name=channel_data.get("name", channel_id),
                    display_name=channel_data.get("display_name", ""),
                    category=channel_data.get("category", "먹방"),
                    enabled=channel_data.get("enabled", True),
                    priority=channel_data.get("priority", 99),
                    prompts=channel_data.get("prompts", {}),
                    collection=channel_data.get("collection", {}),
                    existing_data=channel_data.get("existing_data", {}),
                )
        
        return PipelineConfig(
            name=pipeline.get("name", "tzudong-pipeline"),
            version=pipeline.get("version", "2.0.0"),
            environment=pipeline.get("environment", "development"),
            timezone=pipeline.get("timezone", "Asia/Seoul"),
            gemini=gemini,
            parallel=parallel,
            channels=channels,
            primary_db=self._config.get("database", {}).get("primary", "oracle"),
            log_level=self._config.get("logging", {}).get("level", "INFO"),
        )
    
    def get_secrets(self) -> dict:
        """시크릿 값 반환"""
        return self._secrets or {}
    
    def get_channel(self, channel_key: str) -> Optional[ChannelConfig]:
        """특정 채널 설정 반환"""
        config = self.load()
        return config.channels.get(channel_key)
    
    def get_enabled_channels(self) -> list:
        """활성화된 채널 목록 반환 (우선순위 순)"""
        config = self.load()
        enabled = [
            (key, ch) for key, ch in config.channels.items() 
            if ch.enabled
        ]
        return sorted(enabled, key=lambda x: x[1].priority)


# 싱글톤 인스턴스
_config_loader: Optional[ConfigLoader] = None


def get_config() -> PipelineConfig:
    """전역 설정 로드"""
    global _config_loader
    if _config_loader is None:
        _config_loader = ConfigLoader()
    return _config_loader.load()


def get_secrets() -> dict:
    """전역 시크릿 로드"""
    global _config_loader
    if _config_loader is None:
        _config_loader = ConfigLoader()
        _config_loader.load()
    return _config_loader.get_secrets()


if __name__ == "__main__":
    # 테스트
    config = get_config()
    print(f"Pipeline: {config.name} v{config.version}")
    print(f"Environment: {config.environment}")
    print(f"Gemini Model: {config.gemini.model}")
    print(f"Parallel Workers (Branch 1): {config.parallel.branch1_workers}")
    print(f"Enabled Channels: {[ch.name for ch in config.channels.values() if ch.enabled]}")
