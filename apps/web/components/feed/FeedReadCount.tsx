type FeedReadCountProps = {
  hasData: boolean;
  count: number;
  error: boolean;
};

export function FeedReadCount({ hasData, count, error }: FeedReadCountProps) {
  return <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground xs:text-sm">
    ({hasData ? `${count}개` : error ? '확인 필요' : '불러오는 중'})
  </span>;
}
