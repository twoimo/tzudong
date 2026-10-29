import { createHash } from 'node:crypto';

// Offline grammar mirrored in backend/utils/sponsorship_disclosure.py.
// Match normalized text, but return only original source slices as company names.
export const DISCLOSURE_VERSION = 'first-party-disclosure-v1';
const subject = String.raw`(?:(?:본|이|이번)\s*(?:영상|콘텐츠)(?:은|는|이|가)\s*)`;
const name = String.raw`(?<sponsor>[\s\S]+?)`;
const positive = [
    subject + name + String.raw`\s*(?:의|와의|과의)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:포함(?:하고\s*있(?:습니다|어요)|합니다)|진행(?:하고\s*있(?:습니다|어요)|합니다)|입니다)`,
    String.raw`(?:` + subject + String.raw`|(?:저희|우리|저)(?:는|가)?\s+)?` + name + String.raw`\s*(?:으?로부터|에게서)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:받았습니다|받았어요|받아\s*(?:제작|진행)(?:했습니다|하였습니다|되었습니다|됐습니다))`,
    String.raw`(?:저희|우리|저)(?:는|가)?\s+` + name + String.raw`\s*(?:의|와의|과의)\s*(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:받았습니다|받았어요|받아\s*(?:제작|진행)(?:했습니다|되었습니다))`,
    String.raw`this\s+(?:video|content)\s+(?:is|was)\s+sponsored\s+by\s+` + name,
    String.raw`this\s+(?:video|content)\s+(?:is|was)\s+(?:an?\s+)?(?:paid\s+promotion|sponsorship|advertisement|advertising)\s+(?:from|by|with|for)\s+` + name,
    String.raw`this\s+(?:video|content)\s+(?:contains|includes)\s+(?:a\s+)?(?:paid\s+promotion|sponsorship)\s+(?:from|by|with)\s+` + name,
    String.raw`(?:i|we)\s+(?:received|accepted)\s+(?:a\s+)?(?:sponsorship|paid\s+promotion)\s+(?:from|with)\s+` + name,
].map((pattern) => new RegExp(`^(?:${pattern})$`, 'iu'));
const negative = [
    subject + String.raw`(?:유료\s*광고|광고|협찬)(?:가|이)\s*아닙니다`,
    subject + String.raw`(?:광고\s*(?:및|와|나|또는)\s*)?협찬\s*없이\s*(?:제작|진행)(?:했습니다|되었습니다|됐습니다)`,
    String.raw`this\s+(?:video|content)\s+(?:is|was)\s+not\s+sponsored`,
    String.raw`this\s+(?:video|content)\s+(?:contains|includes)\s+no\s+(?:paid\s+promotion|sponsorship|advertising)`,
].map((pattern) => new RegExp(`^(?:${pattern})$`, 'iu'));

const unnamed = new RegExp(String.raw`^(?:${subject}(?:유료\s*광고|광고|협찬)(?:을|를)?\s*(?:포함(?:합니다|하고\s*있습니다)|입니다)|this\s+(?:video|content)\s+(?:(?:is|was)\s+(?:sponsored|(?:an?\s+)?(?:paid\s+promotion|sponsorship|advertisement|advertising))|(?:contains|includes)\s+(?:a\s+)?(?:paid\s+promotion|sponsorship)))$`, 'iu');

export type Disclosure = {
    is_ads: boolean | null;
    what_ads: string[] | null;
    sponsor_analysis: {
        status: 'completed' | 'unknown';
        outcome: 'detected' | 'confirmed_none' | 'unknown';
        reason: string;
        source: 'description_rules';
        version: typeof DISCLOSURE_VERSION;
        source_sha256: string | null;
    };
};

function normalizedSource(source: string) {
    const groups: { start: number; end: number }[] = [];
    let index = 0;
    let previous = 0;
    for (const char of source) {
        const code = char.codePointAt(0)!;
        if (groups.length && (/\p{M}/u.test(char) ||
            ((code >= 0x1161 && code <= 0x1175 && previous >= 0x1100 && previous <= 0x1112) ||
             (code >= 0x11a8 && code <= 0x11c2 && previous >= 0x1161 && previous <= 0x1175)))) {
            groups[groups.length - 1].end = index + char.length;
        } else {
            groups.push({ start: index, end: index + char.length });
        }
        previous = code;
        index += char.length;
    }
    let text = '';
    const spans: { start: number; end: number }[] = [];
    for (const group of groups) {
        if (source.slice(group.start, group.end) === '\n' && group.start > 0 && source[group.start - 1] === '\r') continue;
        for (const char of source.slice(group.start, group.end).normalize('NFKC')) {
            if (/[\u200b\ufeff]/u.test(char)) continue;
            const value = /[\r\n\u2028\u2029]/u.test(char) ? '\n' : /\s/u.test(char) ? ' ' : char;
            text += value;
            for (let i = 0; i < value.length; i++) spans.push(group);
        }
    }
    return { text, spans };
}

function withoutFencedCode(text: string): string {
    // Carry fence state across blank paragraphs, including an unclosed fence.
    // Mask UTF-16 units in place so emitted names retain their source offsets.
    let fence: { marker: string; length: number } | null = null;
    return text.split('\n').map((line) => {
        const inside = fence !== null;
        if (fence) {
            const close = line.match(/^ *(`{3,}|~{3,}) *$/u);
            if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
        } else {
            const open = line.match(/^ *(`{3,}|~{3,})(.*)$/u);
            if (open && (open[1][0] !== '`' || !open[2].includes('`'))) {
                fence = { marker: open[1][0], length: open[1].length };
            }
        }
        return inside || fence !== null ? ' '.repeat(line.length) : line;
    }).join('\n');
}

function validName(value: string) {
    return Array.from(value).length >= 1 && Array.from(value).length <= 80
        && !/[.!?]\s/u.test(value) && /\p{L}/u.test(value) && /^[\p{L}\p{N} &.'’()-]+$/u.test(value)
        // Require letters and exclude contact-shaped candidates; mixed number brands remain valid.
        && !/[@:/\\]|(?:^|\s)[^\s.]+\.[^\s.]+(?:\s|$)|(?<![A-Za-z0-9])[0-9](?:[ ()+.-]*[0-9]){6,}(?![A-Za-z0-9])/u.test(value)
        && !/(?:광고|협찬|영상|콘텐츠|저희|저는|우리는|소문|예시|문구|따르면|오늘|어제|내일|이번에|아닙|없이|없음|없습니다|받지|예정|sponsor|advertis|example|prompt|instruction|rumor|reported|alleged|\b(?:if|unless|but|because|according|for|no|one)\b|not\b|none\b|unknown\b|https?|www\.|(?:와|과|은|는|이|가)\s|\band\b)/iu.test(value);
}

function uncertainPeriod(left: string, right: string): boolean {
    left = left.trimEnd();
    if (!left.endsWith('.')) return false;
    const word = left.match(/(?:^|[\s(])([A-Za-z]+)\.$/u)?.[1];
    return !!((word && (word.length === 1 || ['dr', 'mr', 'mrs', 'ms', 'st', 'jr', 'sr', 'co', 'inc', 'ltd', 'corp', 'vs', 'etc'].includes(word.toLowerCase())))
        || /^\s*(?:inc|ltd|llc|corp|co)\b/iu.test(right));
}

function independentDisclosure(content: string, chunks: { index: number; end: number }[], index: number): boolean {
    const start = chunks[index].index;
    if (!/^(?:(?:본|이|이번)\s*(?:영상|콘텐츠)(?:은|는|이|가)|(?:저희|우리|저)(?:는|가)?\s+|this\s+(?:video|content)\s+|(?:i|we)\s+)/iu.test(content.slice(start, start + 1024).trimStart())) return false;
    for (let count = 1; count <= Math.min(3, chunks.length - index); count++) {
        const last = chunks[index + count - 1];
        if (count > 1 && /[.!?。！？]/u.test(content.slice(chunks[index + count - 2].end, last.index))) break;
        const raw = content.slice(start, last.end);
        const delimiter = content.slice(last.end).match(/^[.!?。！？]+/u)?.[0] ?? '';
        if (Array.from(raw.trim()).length > 1024 || /[?？]/u.test(delimiter) || uncertainPeriod(raw, content.slice(last.end, last.end + 128))) continue;
        const statement = raw.trim().replace(/[.!?。！？]+$/u, '').trimEnd();
        if (negative.some(pattern => pattern.test(statement)) || unnamed.test(statement) || positive.some(pattern => pattern.test(statement))) return true;
    }
    return false;
}

export function analyzeDisclosure(source: unknown): Disclosure {
    const digest = typeof source === 'string' ? createHash('sha256').update(source, 'utf8').digest('hex') : null;
    const result = (outcome: Disclosure['sponsor_analysis']['outcome'], reason: string, names: string[] | null = null): Disclosure => ({
        is_ads: outcome === 'detected' ? true : outcome === 'confirmed_none' ? false : null,
        what_ads: names,
        sponsor_analysis: { status: outcome === 'unknown' ? 'unknown' : 'completed', outcome, reason,
            source: 'description_rules', version: DISCLOSURE_VERSION, source_sha256: digest },
    });
    if (typeof source !== 'string') return result('unknown', 'description_unavailable');
    const normalized = normalizedSource(source);
    const text = withoutFencedCode(normalized.text);
    const spans = normalized.spans;
    const names: string[] = [];
    const seen = new Set<string>();
    let hasNegative = false;
    let ambiguous = false;
    const negativeMention = /(?:광고|협찬)(?:가|이)?\s*(?:아닙|아니|없)|협찬\s*없이|\b(?:not|never)\s+sponsored\b/iu.test(text);
    for (const paragraph of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/gu)) {
        const content = paragraph[0];
        if (/소문|따르면|보도|주장|말했|말합|전했|전합|\b(?:said|says|wrote|claims?|reported|alleged|rumou?r|according\s+to|for\s+example)\b/iu.test(content)) continue;
        if (['```', '"', '“', '”'].some((marker) => content.includes(marker))) continue;
        if (content.split('\n').some((line) => /^[>'‘]/u.test(line.trimStart()) ||
            (Array.from(line).length <= 1024 && /(?:예시|인용|문구|example|quote|prompt|instruction).*:/iu.test(line)))) continue;
        const chunks: { index: number; end: number }[] = [];
        let cursor = 0;
        const separators = [...content.matchAll(/\n+|[.!?。！？]+/gu)];
        for (const sep of [...separators, null]) {
            if (sep) {
                const boundaryEnd = sep.index! + sep[0].length;
                const following = content.slice(boundaryEnd, boundaryEnd + 128);
                if (sep[0][0] !== '\n' && following && !/\s/u.test(following[0]) &&
                    !/^(?:(?:본|이|이번)\s*(?:영상|콘텐츠)|this\s+(?:video|content)|(?:i|we)\s+(?:received|accepted))/iu.test(following)) continue;
                if (uncertainPeriod(content.slice(Math.max(0, boundaryEnd - 128), boundaryEnd), following)) continue;
            }
            const end = sep ? sep.index! : content.length;
            if (end > cursor) chunks.push({ index: cursor, end });
            cursor = sep ? sep.index! + sep[0].length : content.length;
        }
        for (let i = 0; i < chunks.length;) {
            let matched = false;
            for (let count = 1; count <= Math.min(3, chunks.length - i); count++) {
                const start = chunks[i].index!;
                const last = chunks[i + count - 1];
                const end = last.end;
                if (count > 1) {
                    const prior = chunks[i + count - 2];
                    if (/[.!?。！？]/u.test(content.slice(prior.end, last.index))) break;
                }
                // A physical newline may continue a denial or company name.
                // Commit only at a sentence/paragraph end, never its prefix.
                const next = chunks[i + count];
                if (next && !/[.!?。！？]/u.test(content.slice(end, next.index)) &&
                    !independentDisclosure(content, chunks, i + count)) continue;
                const raw = content.slice(start, end);
                if (/[?？]$/u.test(raw.trim())) continue;
                const statement = raw.trim().replace(/[.!?。！？]+$/u, '').trimEnd();
                const delimiter = content.slice(end).match(/^[.!?。！？]+/u)?.[0] ?? '';
                if (!statement || Array.from(statement).length > 1024 || /[?？]/u.test(delimiter)) continue;
                if (uncertainPeriod(raw, content.slice(end, end + 128))) continue;
                if (negative.some((pattern) => pattern.test(statement))) {
                    hasNegative = true;
                    matched = true;
                }
                if (unnamed.test(statement)) {
                    ambiguous = true;
                    matched = true;
                }
                for (const pattern of positive) {
                    const match = pattern.exec(statement);
                    if (!match?.groups?.sponsor) continue;
                    matched = true;
                    const value = match.groups.sponsor;
                    const parts: { name: string; position: number }[] = [];
                    let cursor = 0;
                    for (const sep of [...value.matchAll(/\s*(?:,|;|\s+(?:및|그리고)\s+)\s*/giu), null]) {
                        const stop = sep ? sep.index! : value.length;
                        const piece = value.slice(cursor, stop);
                        parts.push({ name: piece.trim(), position: cursor + piece.length - piece.trimStart().length });
                        cursor = sep ? sep.index! + sep[0].length : value.length;
                    }
                    if (parts.some((part) => !validName(part.name))) { ambiguous = true; continue; }
                    // The named capture's first occurrence starts after the explicit prefix.
                    // Use RegExp indices rather than substring search (a name may repeat in the prefix).
                    const indices = new RegExp(pattern.source, 'diu').exec(statement)!.indices!.groups!.sponsor;
                    const offset = paragraph.index! + start + raw.length - raw.trimStart().length + indices[0];
                    for (const part of parts) {
                        const key = part.name.replace(/\s+/gu, ' ').toLowerCase();
                        if (!seen.has(key)) {
                            seen.add(key);
                            const originalName = source.slice(spans[offset + part.position].start,
                                spans[offset + part.position + part.name.length - 1].end);
                            if (Array.from(originalName).length > 160) ambiguous = true;
                            else names.push(originalName);
                        }
                    }
                }
                if (matched) { i += count; break; }
            }
            if (!matched) i++;
        }
    }
    if (ambiguous || names.length > 5 || ((hasNegative || negativeMention) && names.length)) return result('unknown', 'ambiguous_disclosure');
    if (names.length) return result('detected', 'positive_first_party_evidence_found', names);
    if (hasNegative) return result('confirmed_none', 'explicit_first_party_no_ad');
    return result('unknown', 'no_positive_first_party_evidence');
}
