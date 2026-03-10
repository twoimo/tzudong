-- 인덱스: restaurants 테이블의 categories 배열 검색 최적화 (approved 데이터 기준)
create index if not exists idx_restaurants_categories_gin
  on restaurants using gin(categories)
  where status = 'approved';
