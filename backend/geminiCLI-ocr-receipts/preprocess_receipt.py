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


def get_white_paper_mask(image):
    """
    진짜 흰색 종이 영역만 검출
    - 높은 밝기 (L > 150)
    - 낮은 채도 (S < 60) - 무채색
    - 회색 책상과 구분
    """
    # LAB 색공간 (밝기)
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel = lab[:, :, 0]
    
    # HSV 색공간 (채도)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    s_channel = hsv[:, :, 1]
    v_channel = hsv[:, :, 2]
    
    # 흰색 조건: 밝고 (V > 180) + 무채색 (S < 50)
    # 더 엄격한 조건으로 회색 책상 제외
    bright_mask = v_channel > 170  # 밝기
    low_saturation = s_channel < 50  # 무채색
    
    # LAB L 채널도 체크 (밝기 이중 확인)
    lab_bright = l_channel > 180
    
    # 세 조건 모두 만족
    white_mask = (bright_mask & low_saturation & lab_bright).astype(np.uint8) * 255
    
    # 모폴로지 연산
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    white_mask = cv2.morphologyEx(white_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    
    # 작은 노이즈 제거 (연결된 컴포넌트 분석)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(white_mask, connectivity=8)
    
    # 너무 작은 영역 제거 (이미지의 1% 미만)
    min_area = image.shape[0] * image.shape[1] * 0.01
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] < min_area:
            white_mask[labels == i] = 0
    
    return white_mask


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
    
    # Step 4: 투시 변환
    if corners is not None and score >= 0.3:
        # 원본 비율로 스케일업
        scaled_corners = corners / ratio
        
        try:
            warped = four_point_transform(orig, scaled_corners)
            warp_method = "perspective"
        except Exception as e:
            warped = orig.copy()
            warp_method = f"error: {str(e)}"
    else:
        # Fallback: 바운딩 박스 크롭
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
