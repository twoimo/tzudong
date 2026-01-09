#!/usr/bin/env python3
"""
채널 설정 로드 모듈
config/channels.yaml에서 채널 정보를 로드합니다.
"""

import os
import yaml
from pathlib import Path
from typing import Dict, Any, Optional


def get_config_path() -> Path:
    """config 폴더 경로 반환"""
    return Path(__file__).parent.parent / "config"


def load_channels_config() -> Dict[str, Any]:
    """channels.yaml 로드"""
    config_file = get_config_path() / "channels.yaml"

    if not config_file.exists():
        raise FileNotFoundError(f"설정 파일을 찾을 수 없습니다: {config_file}")

    with open(config_file, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_channel_info(channel_name: str) -> Dict[str, Any]:
    """
    특정 채널 정보 반환

    Args:
        channel_name: 'tzuyang' 또는 'meatcreator'

    Returns:
        채널 정보 딕셔너리
    """
    config = load_channels_config()
    channels = config.get("channels", {})

    if channel_name not in channels:
        available = list(channels.keys())
        raise ValueError(f"알 수 없는 채널: {channel_name}. 사용 가능: {available}")

    return channels[channel_name]


def get_all_channels() -> Dict[str, Dict[str, Any]]:
    """모든 채널 정보 반환"""
    config = load_channels_config()
    return config.get("channels", {})


def get_channel_data_path(channel_name: str) -> Path:
    """
    채널의 데이터 폴더 경로 반환

    Args:
        channel_name: 'tzuyang' 또는 'meatcreator'

    Returns:
        데이터 폴더 Path 객체
    """
    channel_info = get_channel_info(channel_name)
    backend_dir = Path(__file__).parent.parent
    return backend_dir / channel_info["data_path"]


def get_api_config() -> Dict[str, Any]:
    """API 설정 반환"""
    config = load_channels_config()
    return config.get("api", {})


def get_collection_config() -> Dict[str, Any]:
    """수집 설정 반환"""
    config = load_channels_config()
    return config.get("collection", {})


def get_api_key(service: str) -> Optional[str]:
    """
    API 키 반환 (환경 변수에서 로드)

    Args:
        service: 'youtube', 'openai', 'gemini'

    Returns:
        API 키 문자열 또는 None
    """
    api_config = get_api_config()

    if service not in api_config:
        return None

    key_env = api_config[service].get("key_env")
    if key_env:
        return os.environ.get(key_env)

    return None


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python config_loader.py <command> [args...]")
        print("Commands:")
        print("  channels             - 모든 채널 목록")
        print("  channel <name>       - 특정 채널 정보")
        print("  data_path <name>     - 채널 데이터 경로")
        sys.exit(1)

    command = sys.argv[1]

    if command == "channels":
        channels = get_all_channels()
        for name, info in channels.items():
            print(f"{name}: {info.get('name', 'N/A')}")

    elif command == "channel":
        if len(sys.argv) < 3:
            print("채널 이름을 지정하세요")
            sys.exit(1)
        channel_name = sys.argv[2]
        info = get_channel_info(channel_name)
        print(f"채널: {info.get('name')}")
        print(f"  ID: {info.get('channel_id')}")
        print(f"  핸들: {info.get('handle')}")
        print(f"  데이터 경로: {info.get('data_path')}")

    elif command == "data_path":
        if len(sys.argv) < 3:
            print("채널 이름을 지정하세요")
            sys.exit(1)
        channel_name = sys.argv[2]
        print(get_channel_data_path(channel_name))

    else:
        print(f"알 수 없는 명령: {command}")
        sys.exit(1)
