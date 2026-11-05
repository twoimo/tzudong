"""Current numbered-stage cache inputs, shared by producers and local probes.

Settings are already resolved by each producer. This module never loads an env
file, locates credentials, invokes a provider, or manufactures a receipt.
"""
from pathlib import Path
import re


def stage_inputs(stage, backend, crawling, evaluation, video, settings, *, channel_config='channels.yaml'):
    # The shared shell scan expands this one literal placeholder itself. Other
    # recipe IDs must remain one filename component, never a caller-supplied path.
    if not isinstance(video, str) or (video != '{id}' and not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', video)):
        raise ValueError('stage_video_id_invalid')
    backend, crawling, evaluation = map(Path, (backend, crawling, evaluation))
    crawl = backend / 'restaurant-crawling'
    evaluate = backend / 'restaurant-evaluation'
    base = evaluation / 'evaluation'
    common = [backend / 'utils' / name for name in
              ('pipeline_cache_contracts.py', 'stage_cache.py', 'jsonl_utils.py')]
    if stage == 'crawl':
        config_root = backend / 'config'
        if (not isinstance(channel_config, str) or not channel_config
                or Path(channel_config).is_absolute() or '..' in Path(channel_config).parts):
            raise ValueError('stage_channel_config_invalid')
        config = config_root / channel_config
        if not config.resolve().is_relative_to(config_root.resolve()):
            raise ValueError('stage_channel_config_invalid')
        inputs = [crawling / 'transcript' / (video + '.jsonl')]
        assets = [config] + [crawl / path for path in (
            'prompts/chunk_crawling_prompt.txt', 'scripts/chunk_planner.py',
            'scripts/merge_chunk_results.py', 'scripts/parse_result.py',
            'scripts/gemini_chunk_video_request.mjs', 'scripts/08-chunk-multimodal-crawling.sh',
            'scripts/split_video_chunks.mjs', 'prompts/final_merge_prompt.txt',
            'scripts/final_merge_chunk.mjs')]
        assets += [backend / 'utils' / name for name in (
            'gemini-client.mjs', 'gemini-model.mjs', 'gemini-model.sh',
            'provider-budget.mjs', 'provider_budget.py')]
        visual = crawling / 'visual-location' / (video + '.jsonl')
        settings = list(settings)
        settings.append('channel-config:' + channel_config)
        if visual.is_file():
            assets.append(visual)
            settings.append('visual-location:present')
        else:
            settings.append('visual-location:absent')
        metadata = [crawling / 'meta' / (video + '.jsonl')]
    elif stage == 'selection':
        inputs = [path for path in (crawling / 'crawling' / (video + '.jsonl'),
                                   crawling / 'visual-location' / (video + '.jsonl')) if path.is_file()]
        assets = [evaluate / 'scripts/09-target-selection.py']
        metadata = []
    elif stage == 'rule':
        inputs = [base / 'selection' / (video + '.jsonl')]
        assets = [evaluate / 'scripts' / name for name in
                  ('10-rule-evaluation.py', 'evidence_identity.py', 'naver_query_plan.py')]
        assets += [backend / 'utils' / name for name in
                   ('gemini_model.py', 'request_budget.py', 'runtime_paths.py')]
        metadata = []
    elif stage == 'laaj':
        inputs = [base / 'rule_results' / (video + '.jsonl'),
                  crawling / 'transcript' / (video + '.jsonl'),
                  base / 'rule_results/.receipts' / (video + '.json')]
        assets = [evaluate / path for path in (
            'prompts/evaluation_prompt.txt', 'scripts/parse_laaj_evaluation.py',
            'scripts/11-laaj-evaluation.sh', 'scripts/gemini_api_request.mjs')]
        assets += [backend / 'utils' / name for name in (
            'gemini-client.mjs', 'gemini-model.mjs', 'gemini-model.sh',
            'provider-budget.mjs', 'provider_budget.py')]
        assets.append(backend / 'bin/run_agy_prompt.py')
        metadata = [crawling / 'meta' / (video + '.jsonl')]
    else:
        raise ValueError('stage_unknown')
    return dict(inputs=inputs, assets=assets + common, metadata=metadata, settings=settings)


def transform_groups(crawling, evaluation):
    base = evaluation / 'evaluation'
    result = []
    for path in sorted((base / 'rule_results').glob('*.jsonl')):
        laaj = base / 'laaj_results' / path.name
        result.append(('results', path.stem, [path, laaj] if laaj.is_file() else [path]))
    for kind, directory in [('notSelection', base / 'notSelection'),
                            ('map_url_crawling', crawling / 'map_url_crawling')]:
        result.extend((kind, path.stem, [path]) for path in sorted(directory.glob('*.jsonl')))
    return result


def transform_source_hash(backend, file_hash):
    from .stage_cache import canonical_digest
    return canonical_digest([file_hash(backend / path) for path in (
        'restaurant-evaluation/scripts/12-transform.py',
        'restaurant-evaluation/scripts/evaluation_results_boundary.py',
        'utils/pipeline_cache_contracts.py', 'utils/stage_cache.py', 'utils/jsonl_utils.py')])


def transform_key(channel, kind, source_hash, meta, inputs, file_hash):
    from .stage_cache import canonical_digest
    return canonical_digest([channel, kind, source_hash, file_hash(meta),
                             *[file_hash(path) for path in inputs]])
