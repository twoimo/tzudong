export async function compressImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        img.onload = () => {
            const MAX_SIZE = 200;
            let { width, height } = img;

            // 비율 유지하며 최대 크기 제한
            if (width > height) {
                if (width > MAX_SIZE) {
                    height = (height * MAX_SIZE) / width;
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width = (width * MAX_SIZE) / height;
                    height = MAX_SIZE;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx?.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('이미지 압축 실패'));
                },
                'image/jpeg',
                0.8
            );
        };

        img.onerror = () => reject(new Error('이미지 로드 실패'));
        img.src = URL.createObjectURL(file);
    });
}
