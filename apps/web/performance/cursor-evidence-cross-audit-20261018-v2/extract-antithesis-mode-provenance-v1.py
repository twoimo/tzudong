"""Extract only allowlisted UI label evidence from this conversation's transcript."""
import argparse
import hashlib
import json
from pathlib import Path


TITLES = {
    'Argon 최고가 선택',
    'Tzudong Deep Research 활성화 확인',
    'Argon 최고가와 Deep Research 동시 활성 확인',
    '반대 감사 질문 입력 및 전송 전 확인',
    'Tzudong 반대 감사 한 번 전송',
    '생성된 반대 감사 연구 계획 확인',
}
LABELS = (
    '현재 Argon 최고가 모드 사용 중',
    'button Deep Research 선택 해제',
    'button MASTER-PLAN-v3.md',
    'button source_bundle_v2.txt',
    'text MASTER-PLAN-v3',
    'text TXT source_bundle_v2',
    '말씀하신 내용 연구 시작',
    '착수할게요.',
    '조사 시작 중...',
)


def text_blocks(value):
    if isinstance(value, list):
        for item in value:
            yield from text_blocks(item)
    elif isinstance(value, dict):
        if isinstance(value.get('text'), str):
            yield value['text']
        elif 'content' in value:
            yield from text_blocks(value['content'])
    elif isinstance(value, str):
        yield value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('transcript', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--expected-thread', default='01a14e99-77bf-7531-b29e-a612bd99b540')
    args = parser.parse_args()
    calls, events, identity = {}, [], None
    digest, prefix_bytes = hashlib.sha256(), 0
    last_prefix = None
    with args.transcript.open('rb') as stream:
        for raw in stream:
            digest.update(raw)
            prefix_bytes += len(raw)
            record = json.loads(raw)
            payload = record.get('payload', {})
            if record.get('type') == 'session_meta':
                identity = payload.get('id')
                if identity != args.expected_thread:
                    raise SystemExit('Transcript identity mismatch; no evidence written')
            if identity is None:
                continue
            if (payload.get('type') == 'function_call'
                    and payload.get('namespace') == 'mcp__cua_repl'
                    and payload.get('name') == 'js'):
                command = json.loads(payload.get('arguments', '{}'))
                if command.get('title') in TITLES:
                    calls[payload['call_id']] = {
                        'title': command['title'],
                        'call_id': payload['call_id'],
                        'call_timestamp': record.get('timestamp'),
                        'call_raw_line_sha256': hashlib.sha256(raw).hexdigest(),
                    }
            if payload.get('type') != 'function_call_output' or payload.get('call_id') not in calls:
                continue
            lines = []
            for block in text_blocks(payload.get('output')):
                for line in block.splitlines():
                    if any(label in line for label in LABELS) and line not in lines:
                        lines.append(line)
            if not lines:
                raise SystemExit('Expected UI labels absent; no evidence written')
            events.append({
                **calls[payload['call_id']],
                'output_timestamp': record.get('timestamp'),
                'output_raw_line_sha256': hashlib.sha256(raw).hexdigest(),
                'exact_allowlisted_ui_lines': lines,
                'max_label_observed': any(LABELS[0] in line for line in lines),
                'research_chip_observed': any(LABELS[1] in line for line in lines),
            })
            last_prefix = {'bytes': prefix_bytes, 'sha256': digest.hexdigest()}
    if identity != args.expected_thread or len(events) != len(TITLES):
        raise SystemExit('Incomplete identity or expected six events; no evidence written')
    by_title = {event['title']: event for event in events}
    contract = all(
        by_title[title]['max_label_observed'] and by_title[title]['research_chip_observed']
        for title in ('반대 감사 질문 입력 및 전송 전 확인', 'Tzudong 반대 감사 한 번 전송', '생성된 반대 감사 연구 계획 확인')
    )
    if not contract:
        raise SystemExit('Combined mode contract not observed; no evidence written')
    result = {
        'thread_id': identity,
        'transcript_filename': args.transcript.name,
        'transcript_prefix_through_last_selected_output': last_prefix,
        'selection': 'Exactly six allowlisted CUA call/output pairs; UI label lines only',
        'events': events,
        'dispatch_and_start_max_plus_research_ui_observed': contract,
        'backend_identity': 'UNVERIFIED',
        'limits': 'UI labels and tool history are observed configuration evidence, not provider backend attestation. A different tab current composer is not the dispatch-time configuration.',
    }
    with args.output.open('x') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'events': len(events), 'ui_contract_observed': contract, 'output': str(args.output)}))


if __name__ == '__main__':
    main()
