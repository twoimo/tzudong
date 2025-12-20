#!/usr/bin/env python3
"""
영수증 이미지 전처리 스크립트 (v5 - 정밀 흰색 감지)

핵심 개선:
1. HSV + LAB 결합으로 "진짜 흰색" 종이만 검출
2. 세로로 긴 영수증 형태 우선 검출 (aspect ratio 필터)
3. 볼록 껍질(Convex Hull) 기반 4점 추정
4. 여러 후보 중 가장 "영수증 같은" 것 선택

Usage:
    python preprocess_receipt.py <input_image_path> <output_dir>
"""

import sys
import os
import json
import cv2
import numpy as np
from typing import List, Tuple, Optional


def order_points(pts):
    """4개의 점을 [top-left, top-right, bottom-right, bottom-left] 순서로 정렬"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def four_point_transform(image, pts):
    """투시 변환 수행"""
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    
    maxWidth = max(maxWidth, 100)
    maxHeight = max(maxHeight, 100)
    
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]
    ], dtype="float32")
    
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped


def auto_rotate_receipt(image):
    """
    영수증을 올바른 방향으로 회전
    
    핵심 신호: 노란 테이프 위치 (상단에 있어야 정방향)
    """
    
    def calculate_orientation_score(img):
        """점수 계산 - 높을수록 정방향"""
        h, w = img.shape[:2]
        
        # 세로가 가로보다 길어야 함
        if w > h:
            return -1000
        
        score = 0.0
        
        # === 방법 1: 노란색/색상 블록 위치 (가장 강력한 신호) ===
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        h_channel = hsv[:, :, 0]
        s_channel = hsv[:, :, 1]
        v_channel = hsv[:, :, 2]
        
        # 노란색 감지 (Hue: 20-40, 높은 채도, 높은 밝기)
        yellow_mask = ((h_channel >= 15) & (h_channel <= 45) & 
                       (s_channel > 80) & (v_channel > 150)).astype(np.uint8)
        
        # 일반 색상 영역
        colored = ((s_channel > 100) & (v_channel > 150)).astype(np.uint8)
        
        # 노란색 + 일반 색상
        color_mask = cv2.bitwise_or(yellow_mask, colored)
        
        # 상단 1/4 vs 하단 1/4
        top_quarter = color_mask[:h//4, :]
        bottom_quarter = color_mask[3*h//4:, :]
        
        top_sum = int(np.sum(top_quarter))  # int로 변환하여 오버플로우 방지
        bottom_sum = int(np.sum(bottom_quarter))
        total_color = top_sum + bottom_sum
        
        if total_color > 100:  # 색상이 충분히 있을 때만
            color_score = (top_sum - bottom_sum) / max(total_color, 1)
            score += color_score * 5.0  # 강한 가중치
        
        # === 방법 2: 텍스트 블록 크기 분석 ===
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        
        # 상단 1/4 vs 하단 1/4
        top_region = binary[:h//4, :]
        bottom_region = binary[3*h//4:, :]
        
        top_contours, _ = cv2.findContours(top_region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        bottom_contours, _ = cv2.findContours(bottom_region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # 가장 큰 3개 블록의 평균 면적
        top_areas = sorted([cv2.contourArea(c) for c in top_contours], reverse=True)[:3]
        bottom_areas = sorted([cv2.contourArea(c) for c in bottom_contours], reverse=True)[:3]
        
        top_avg = sum(top_areas) / len(top_areas) if top_areas else 0
        bottom_avg = sum(bottom_areas) / len(bottom_areas) if bottom_areas else 0
        
        if top_avg + bottom_avg > 0:
            block_score = (top_avg - bottom_avg) / max(top_avg + bottom_avg, 1)
            score += block_score * 1.0
        
        return score
    
    # 0°와 180° 비교 (90°/270°는 가로이므로 큰 패널티)
    rotations = [
        (image, 0),
        (cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE), 90),
        (cv2.rotate(image, cv2.ROTATE_180), 180),
        (cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE), 270),
    ]
    
    best_image = image
    best_score = float('-inf')
    
    for rotated_img, rotation in rotations:
        score = calculate_orientation_score(rotated_img)
        if score > best_score:
            best_score = score
            best_image = rotated_img
    
    return best_image


def get_white_paper_mask(image):
    """
    영수증 영역 마스크 생성 (브루트포스 다중 임계값)
    
    전략:
    1. 여러 밝기 임계값을 시도
    2. 각 임계값에서 찾은 윤곽선에 "영수증 점수" 계산
    3. 가장 높은 점수의 임계값 + 윤곽선 선택
    4. 질감 분석으로 배경 제외
    """
    h, w = image.shape[:2]
    image_area = h * w
    
    # 색공간 변환
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    
    v_channel = hsv[:, :, 2]
    s_channel = hsv[:, :, 1]
    l_channel = lab[:, :, 0]
    
    # 질감 분석: 로컬 표준편차 계산 (질감이 많으면 높음)
    # 영수증은 부드럽고 균일, 배경은 질감이 있음
    blur_for_std = cv2.GaussianBlur(gray, (15, 15), 0)
    local_std = np.abs(gray.astype(float) - blur_for_std.astype(float))
    texture_mask = (local_std < 20).astype(np.uint8) * 255  # 부드러운 영역만
    
    best_mask = None
    best_score = -1
    best_threshold = None
    
    # 브루트포스: 여러 임계값 시도
    thresholds = [
        (100, 90, 100),  # V, S, L (매우 낮음 - 그림자 포함)
        (120, 80, 120),
        (130, 70, 130),
        (140, 70, 140),
        (150, 60, 150),
        (160, 50, 160),
        (170, 40, 170),
        (180, 30, 180),
    ]
    
    for v_thresh, s_thresh, l_thresh in thresholds:
        # 밝기 마스크 생성
        bright = (v_channel > v_thresh).astype(np.uint8) * 255
        low_sat = (s_channel < s_thresh).astype(np.uint8) * 255
        lab_bright = (l_channel > l_thresh).astype(np.uint8) * 255
        
        # 흰색 조건
        white_mask = cv2.bitwise_and(bright, low_sat)
        white_mask = cv2.bitwise_and(white_mask, lab_bright)
        
        # 색상 스티커도 포함
        colored = ((v_channel > v_thresh + 20) & (s_channel > 80)).astype(np.uint8) * 255
        combined = cv2.bitwise_or(white_mask, colored)
        
        # 질감 마스크와 AND (부드러운 영역만)
        if v_thresh < 140:  # 낮은 임계값에서만 질감 필터 적용
            combined = cv2.bitwise_and(combined, texture_mask)
        
        # 모폴로지 처리
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        combined = cv2.morphologyEx(combined, cv2.MORPH_OPEN, kernel, iterations=1)
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=3)
        
        # 윤곽선 찾기
        contours, _ = cv2.findContours(combined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            continue
        
        # 각 윤곽선에 점수 부여
        for contour in contours:
            area = cv2.contourArea(contour)
            area_ratio = area / image_area
            
            # 면적 필터: 5% ~ 80%
            if area_ratio < 0.05 or area_ratio > 0.8:
                continue
            
            # 볼록 껍질
            hull = cv2.convexHull(contour)
            hull_area = cv2.contourArea(hull)
            convexity = area / hull_area if hull_area > 0 else 0
            
            # 직사각형성 (minAreaRect와 비교)
            rect = cv2.minAreaRect(contour)
            rect_area = rect[1][0] * rect[1][1]
            rectangularity = area / rect_area if rect_area > 0 else 0
            
            # 가로세로 비율 (영수증은 세로가 김)
            x, y, cw, ch = cv2.boundingRect(contour)
            aspect = max(cw, ch) / min(cw, ch) if min(cw, ch) > 0 else 0
            vertical_bonus = 1.0
            if ch > cw * 1.3:  # 세로로 긴 형태
                vertical_bonus = 1.3
            elif cw > ch * 1.3:  # 가로로 긴 형태
                vertical_bonus = 1.1
            
            # 종합 점수 계산
            score = (
                area_ratio * 2.0 +          # 면적 점수 (최대 ~1.6)
                convexity * 0.5 +           # 볼록성 (0~0.5)
                rectangularity * 0.5 +      # 직사각형성 (0~0.5)
                vertical_bonus * 0.3        # 세로 보너스
            )
            
            if score > best_score:
                best_score = score
                best_threshold = (v_thresh, s_thresh, l_thresh)
                
                # 최적 마스크 생성
                best_mask = np.zeros((h, w), dtype=np.uint8)
                cv2.drawContours(best_mask, [contour], -1, 255, -1)
    
    if best_mask is None:
        # fallback: 가장 밝은 영역
        _, best_mask = cv2.threshold(v_channel, 150, 255, cv2.THRESH_BINARY)
    
    # 최종 갭 채우기
    kernel_large = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    best_mask = cv2.morphologyEx(best_mask, cv2.MORPH_CLOSE, kernel_large, iterations=2)
    
    # 구멍 채우기
    flood_filled = best_mask.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood_filled, mask, (0, 0), 255)
    flood_filled_inv = cv2.bitwise_not(flood_filled)
    best_mask = cv2.bitwise_or(best_mask, flood_filled_inv)
    
    return best_mask


def score_receipt_contour(contour, image_shape):
    """
    윤곽선이 얼마나 영수증 같은지 점수 계산
    
    고려 요소:
    1. 면적 비율 (이미지의 5~60%)
    2. 가로세로 비율 (영수증은 세로로 긴 형태, 0.2~0.6)
    3. 볼록성 (70% 이상)
    4. 꼭짓점 수 (4개에 가까울수록 좋음)
    """
    area = cv2.contourArea(contour)
    image_area = image_shape[0] * image_shape[1]
    area_ratio = area / image_area
    
    # 면적 필터
    if area_ratio < 0.05 or area_ratio > 0.7:
        return 0, "area_invalid"
    
    # 바운딩 박스
    x, y, w, h = cv2.boundingRect(contour)
    
    # 영수증은 보통 세로가 가로보다 1.5배 이상 긴 형태
    # 또는 가로가 세로보다 긴 경우 (가로로 찍은 경우)
    aspect = min(w, h) / max(w, h)
    
    # 너무 정사각형이거나 너무 길쭉한 것 제외
    if aspect > 0.8:  # 거의 정사각형 - 영수증 아닐 가능성
        return 0, "too_square"
    
    # 볼록성
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area > 0:
        solidity = area / hull_area
    else:
        solidity = 0
    
    if solidity < 0.7:
        return 0, "not_convex"
    
    # 다각형 근사
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    num_vertices = len(approx)
    
    # 점수 계산
    area_score = min(area_ratio * 3, 1.0)  # 큰 면적 선호 (최대 1.0)
    
    # 세로로 긴 형태 보너스 (영수증 특성)
    vertical_bonus = 0
    if h > w * 1.5:  # 세로가 가로보다 1.5배 이상
        vertical_bonus = 0.2
    elif w > h * 1.5:  # 가로로 찍은 경우
        vertical_bonus = 0.15
    
    # 4개 꼭짓점 보너스
    vertex_score = 0.3 if num_vertices == 4 else max(0, 0.2 - abs(num_vertices - 4) * 0.05)
    
    # 볼록성 점수
    solidity_score = solidity * 0.3
    
    total_score = area_score * 0.4 + vertex_score + vertical_bonus + solidity_score
    
    return min(total_score, 1.0), "scored"


def find_best_receipt_contour(image, white_mask):
    """최적의 영수증 윤곽선 찾기"""
    contours, _ = cv2.findContours(white_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None, 0, "no_contours"
    
    # 모든 윤곽선 점수 계산
    scored_contours = []
    for contour in contours:
        score, reason = score_receipt_contour(contour, image.shape)
        if score > 0:
            scored_contours.append((contour, score, reason))
    
    if not scored_contours:
        # fallback: 가장 큰 윤곽선 사용
        largest = max(contours, key=cv2.contourArea)
        return largest, 0.3, "largest_fallback"
    
    # 점수 기준 정렬
    scored_contours.sort(key=lambda x: x[1], reverse=True)
    best_contour, best_score, _ = scored_contours[0]
    
    return best_contour, best_score, "best_scored"


def contour_to_4points(contour):
    """윤곽선을 4개의 꼭짓점으로 변환"""
    # 다각형 근사
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    
    if len(approx) == 4:
        return approx.reshape(4, 2).astype(np.float32), "approx_4points"
    
    # 4개가 아니면 convex hull에서 4개 꼭짓점 추출
    hull = cv2.convexHull(contour)
    
    if len(hull) >= 4:
        # hull에서 가장 극단적인 4개 점 선택
        hull_points = hull.reshape(-1, 2)
        
        # 각 방향의 극단점 찾기
        top_left_idx = np.argmin(hull_points[:, 0] + hull_points[:, 1])
        top_right_idx = np.argmin(-hull_points[:, 0] + hull_points[:, 1])
        bottom_right_idx = np.argmax(hull_points[:, 0] + hull_points[:, 1])
        bottom_left_idx = np.argmax(-hull_points[:, 0] + hull_points[:, 1])
        
        corners = np.array([
            hull_points[top_left_idx],
            hull_points[top_right_idx],
            hull_points[bottom_right_idx],
            hull_points[bottom_left_idx]
        ], dtype=np.float32)
        
        return corners, "hull_4points"
    
    # 최후의 수단: minAreaRect
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    return box.astype(np.float32), "min_area_rect"


def clip_corners_to_bounds(corners, image_shape):
    """
    코너 좌표를 이미지 경계 내로 클리핑
    
    Returns:
        clipped_corners: 경계 내로 클리핑된 코너
        is_clipped: 클리핑이 발생했는지 여부
        clip_ratio: 얼마나 많이 클리핑되었는지 (0=없음, 1=많이)
    """
    h, w = image_shape[:2]
    clipped = corners.copy()
    
    original_area = cv2.contourArea(corners)
    
    # 각 코너를 이미지 경계 내로 클리핑
    clipped[:, 0] = np.clip(clipped[:, 0], 0, w - 1)  # x
    clipped[:, 1] = np.clip(clipped[:, 1], 0, h - 1)  # y
    
    clipped_area = cv2.contourArea(clipped)
    
    # 클리핑으로 얼마나 면적이 줄었는지 계산
    if original_area > 0:
        clip_ratio = 1 - (clipped_area / original_area)
    else:
        clip_ratio = 0
    
    is_clipped = clip_ratio > 0.01  # 1% 이상 변화
    
    return clipped.astype(np.float32), is_clipped, clip_ratio


def is_valid_perspective_corners(corners, image_shape):
    """
    투시 변환에 적합한 코너인지 검증
    
    Returns:
        is_valid: 유효 여부
        reason: 이유
    """
    h, w = image_shape[:2]
    margin = 5  # 경계 여유
    
    # 1. 모든 코너가 이미지 내에 있는지 (여유 포함)
    boundary_corners = 0
    for i, corner in enumerate(corners):
        # 완전히 밖에 있는 경우
        if corner[0] < 0 or corner[0] >= w or corner[1] < 0 or corner[1] >= h:
            return False, f"corner_{i}_outside"
        
        # 경계에 너무 가까운 경우 (5픽셀 이내)
        if corner[0] < margin or corner[0] >= w - margin:
            boundary_corners += 1
        if corner[1] < margin or corner[1] >= h - margin:
            boundary_corners += 1
    
    # 2개 이상의 코너가 경계에 있으면 영수증이 잘린 것
    if boundary_corners >= 2:
        return False, f"corners_at_boundary_{boundary_corners}"
    
    # 2. 면적이 충분한지
    area = cv2.contourArea(corners)
    image_area = h * w
    if area < image_area * 0.05:  # 5% 미만
        return False, "area_too_small"
    
    # 3. 사각형이 너무 왜곡되지 않았는지
    ordered = order_points(corners)
    
    # 4개 코너가 모두 다른 위치인지 확인 (중복 방지)
    for i in range(4):
        for j in range(i + 1, 4):
            dist = np.linalg.norm(ordered[i] - ordered[j])
            if dist < 10:  # 10픽셀 미만 거리면 거의 같은 점
                return False, "duplicate_corners"
    
    # 상단/하단 폭
    top_width = np.linalg.norm(ordered[1] - ordered[0])
    bottom_width = np.linalg.norm(ordered[2] - ordered[3])
    
    # 좌/우 높이
    left_height = np.linalg.norm(ordered[3] - ordered[0])
    right_height = np.linalg.norm(ordered[2] - ordered[1])
    
    # 너비/높이 비율 차이 확인 (너무 심하면 왜곡됨)
    if top_width > 0 and bottom_width > 0:
        width_ratio = min(top_width, bottom_width) / max(top_width, bottom_width)
        if width_ratio < 0.3:  # 30% 미만
            return False, "width_distorted"
    
    if left_height > 0 and right_height > 0:
        height_ratio = min(left_height, right_height) / max(left_height, right_height)
        if height_ratio < 0.3:
            return False, "height_distorted"
    
    return True, "valid"


def binarize_image(image):
    """이미지 이진화"""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    binary = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 21, 10
    )
    return binary


def preprocess_receipt(input_path, output_dir):
    """영수증 이미지 전처리 메인 함수"""
    os.makedirs(output_dir, exist_ok=True)
    
    image = cv2.imread(input_path)
    if image is None:
        return {"error": f"Failed to load image: {input_path}"}
    
    orig = image.copy()
    results = {"method": "v5_white_paper_detection"}
    
    # Step 1: 원본 저장
    original_path = os.path.join(output_dir, "original.jpg")
    cv2.imwrite(original_path, orig)
    results["original"] = original_path
    
    # 리사이즈
    max_dim = 800
    h, w = image.shape[:2]
    if max(h, w) > max_dim:
        ratio = max_dim / max(h, w)
        resized = cv2.resize(image, (int(w * ratio), int(h * ratio)))
    else:
        ratio = 1.0
        resized = image.copy()
    
    # Step 2: 흰색 종이 마스크 생성 (더 정밀)
    white_mask = get_white_paper_mask(resized)
    
    # Step 3: 최적의 영수증 윤곽선 찾기
    best_contour, score, detection_method = find_best_receipt_contour(resized, white_mask)
    
    results["detection_score"] = float(score)
    results["detection_method"] = detection_method
    
    # 윤곽선 시각화
    contour_image = resized.copy()
    corners = None
    
    if best_contour is not None and score >= 0.3:
        # 윤곽선을 4개 꼭짓점으로 변환
        corners, corner_method = contour_to_4points(best_contour)
        results["corner_method"] = corner_method
        
        # 시각화
        cv2.drawContours(contour_image, [best_contour], -1, (0, 255, 0), 2)
        
        ordered = order_points(corners)
        labels = ["TL", "TR", "BR", "BL"]
        for corner, label in zip(ordered, labels):
            cv2.circle(contour_image, tuple(corner.astype(int)), 8, (0, 0, 255), -1)
            cv2.putText(contour_image, label, 
                       tuple((corner + [5, -5]).astype(int)),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 2)
    
    cv2.putText(contour_image, f"Score: {score:.2f} ({detection_method})", 
               (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    
    contour_path = os.path.join(output_dir, "contour.jpg")
    cv2.imwrite(contour_path, contour_image)
    results["contour"] = contour_path
    
    # Step 4: 투시 변환 (코너 검증 포함)
    warped = None
    warp_method = "none"
    
    if corners is not None and score >= 0.3:
        # 원본 비율로 스케일업
        scaled_corners = corners / ratio
        
        # 코너 유효성 검사
        is_valid, validity_reason = is_valid_perspective_corners(scaled_corners, orig.shape)
        
        if not is_valid:
            # 클리핑 시도
            clipped_corners, was_clipped, clip_ratio = clip_corners_to_bounds(scaled_corners, orig.shape)
            
            if clip_ratio < 0.3:  # 30% 미만 클리핑이면 사용
                is_valid, validity_reason = is_valid_perspective_corners(clipped_corners, orig.shape)
                if is_valid:
                    scaled_corners = clipped_corners
                    results["corners_clipped"] = True
                    results["clip_ratio"] = float(clip_ratio)
        
        if is_valid:
            try:
                warped = four_point_transform(orig, scaled_corners)
                warp_method = "perspective"
                
                # 결과 검증: 너무 작거나 검은 이미지인지 확인
                if warped is not None:
                    h_w, w_w = warped.shape[:2]
                    if h_w < 50 or w_w < 50:
                        warped = None
                        warp_method = "perspective_too_small"
                    else:
                        # 이미지가 대부분 검은색/흰색인지 확인
                        gray_w = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
                        mean_val = np.mean(gray_w)
                        if mean_val < 10 or mean_val > 245:  # 거의 검/흰
                            warped = None
                            warp_method = f"perspective_invalid_mean_{mean_val:.0f}"
            except Exception as e:
                warped = None
                warp_method = f"perspective_error: {str(e)}"
        else:
            results["corner_invalid_reason"] = validity_reason
    
    # Fallback: 바운딩 박스 크롭
    if warped is None:
        if best_contour is not None:
            x, y, cw, ch = cv2.boundingRect(best_contour)
            x, y = int(x / ratio), int(y / ratio)
            cw, ch = int(cw / ratio), int(ch / ratio)
            
            margin = int(min(cw, ch) * 0.05)
            x1 = max(0, x - margin)
            y1 = max(0, y - margin)
            x2 = min(orig.shape[1], x + cw + margin)
            y2 = min(orig.shape[0], y + ch + margin)
            
            warped = orig[y1:y2, x1:x2]
            warp_method = "bounding_box"
        else:
            warped = orig.copy()
            warp_method = "original"
    
    results["warp_method"] = warp_method
    
    # Step 4.5: 자동 회전 (텍스트가 똑바로 보이도록)
    warped = auto_rotate_receipt(warped)
    
    warped_path = os.path.join(output_dir, "warped.jpg")
    cv2.imwrite(warped_path, warped)
    results["warped"] = warped_path
    
    # Step 5: 이진화
    binarized = binarize_image(warped)
    binarized_path = os.path.join(output_dir, "binarized.jpg")
    cv2.imwrite(binarized_path, binarized)
    results["binarized"] = binarized_path
    
    return results


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: python preprocess_receipt.py <input_image> <output_dir>"}))
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    
    result = preprocess_receipt(input_path, output_dir)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
