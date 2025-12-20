#!/usr/bin/env python3
"""
영수증 이미지 전처리 스크립트

Usage:
    python preprocess_receipt.py <input_image_path> <output_dir>

Output:
    JSON with paths to intermediate images:
    {
        "original": "path/to/original.jpg",
        "contour": "path/to/contour.jpg",
        "warped": "path/to/warped.jpg",
        "binarized": "path/to/binarized.jpg"
    }
"""

import sys
import os
import json
import cv2
import numpy as np


def order_points(pts):
    """
    4개의 점을 [top-left, top-right, bottom-right, bottom-left] 순서로 정렬
    """
    rect = np.zeros((4, 2), dtype="float32")
    
    # top-left: x+y 합이 가장 작음
    # bottom-right: x+y 합이 가장 큼
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    
    # top-right: x-y 차이가 가장 큼
    # bottom-left: x-y 차이가 가장 작음
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    
    return rect


def four_point_transform(image, pts):
    """
    투시 변환(Perspective Transform) 수행
    """
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    
    # 새 이미지의 너비 계산
    widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    maxWidth = max(int(widthA), int(widthB))
    
    # 새 이미지의 높이 계산
    heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
    maxHeight = max(int(heightA), int(heightB))
    
    # 변환 후 좌표
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]
    ], dtype="float32")
    
    # 투시 변환 행렬 계산 및 적용
    M = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    
    return warped


def find_receipt_contour(image):
    """
    영수증 윤곽선 찾기
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 200)
    
    # 윤곽선 검출
    contours, _ = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return None
    
    # 면적 기준 정렬
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    
    receipt_contour = None
    for c in contours:
        # 윤곽선 근사화
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        
        # 4개의 꼭지점을 가진 윤곽선 = 영수증
        if len(approx) == 4:
            receipt_contour = approx
            break
    
    return receipt_contour


def binarize_image(image):
    """
    이미지 이진화 (Adaptive Thresholding)
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    
    # 노이즈 제거
    denoised = cv2.fastNlMeansDenoising(gray, None, 10, 7, 21)
    
    # Adaptive Thresholding
    binary = cv2.adaptiveThreshold(
        denoised, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        21, 10
    )
    
    return binary


def preprocess_receipt(input_path, output_dir):
    """
    영수증 이미지 전처리 메인 함수
    """
    # 출력 디렉토리 생성
    os.makedirs(output_dir, exist_ok=True)
    
    # 이미지 로드
    image = cv2.imread(input_path)
    if image is None:
        return {"error": f"Failed to load image: {input_path}"}
    
    # 원본 이미지 비율 유지하며 리사이즈 (처리 속도 향상)
    orig = image.copy()
    ratio = image.shape[0] / 500.0
    image = cv2.resize(image, (int(image.shape[1] / ratio), 500))
    
    # 결과 딕셔너리
    results = {}
    
    # Step 1: 원본 저장
    original_path = os.path.join(output_dir, "original.jpg")
    cv2.imwrite(original_path, orig)
    results["original"] = original_path
    
    # Step 2: 윤곽선 검출
    receipt_contour = find_receipt_contour(image)
    
    contour_path = os.path.join(output_dir, "contour.jpg")
    contour_image = image.copy()
    
    if receipt_contour is not None:
        cv2.drawContours(contour_image, [receipt_contour], -1, (0, 255, 0), 2)
        cv2.imwrite(contour_path, cv2.resize(contour_image, (orig.shape[1], orig.shape[0])))
        results["contour"] = contour_path
        
        # Step 3: 투시 변환
        # 원본 이미지 비율로 좌표 스케일링
        receipt_contour = receipt_contour.reshape(4, 2) * ratio
        warped = four_point_transform(orig, receipt_contour)
        
        warped_path = os.path.join(output_dir, "warped.jpg")
        cv2.imwrite(warped_path, warped)
        results["warped"] = warped_path
        
        # Step 4: 이진화
        binarized = binarize_image(warped)
        binarized_path = os.path.join(output_dir, "binarized.jpg")
        cv2.imwrite(binarized_path, binarized)
        results["binarized"] = binarized_path
        
    else:
        # 윤곽선 검출 실패 시: 원본 사용
        results["contour"] = None
        results["warped"] = original_path  # 원본 사용
        
        # 원본에 직접 이진화 적용
        binarized = binarize_image(orig)
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
