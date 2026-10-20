/** Visible before the location action; the button remains the only activation. */
export function DeviceLocationDisclosure({ id }: { id: string }) {
    return (
        <p
            id={id}
            className="pointer-events-none absolute bottom-0 right-full mr-2 w-max max-w-[min(12rem,calc(100vw-14rem))] rounded-md bg-background/95 px-2 py-1 text-xs leading-snug text-muted-foreground shadow-sm"
        >
            위치는 지도 제공자에 전달돼요.<br />
            앱에는 저장하지 않아요.
        </p>
    );
}
