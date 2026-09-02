//! Port of the declarative graph in `backend/pipeline_control/graph.py`.
//!
//! The step table, capability tags, step-class composition, and the
//! non-filesystem validation checks are pure and ported here. Filesystem checks
//! (`_reject_escape`, `is_file`), env reads (`resolve_python`, `build_argv`),
//! and `REPO_ROOT` stay in Python.

pub const MUTATING_CAPABILITY: &str = "mutating_db";
pub const HEAVY_CAPABILITY: &str = "heavy_compute";
pub const MAP_URL_CAPABILITY: &str = "map_url";
pub const FRAME_CAPTION_CAPABILITY: &str = "frame_caption";
pub const CHUNK_CAPABILITY: &str = "chunk";

pub const ALLOWED_INTERPRETERS: [&str; 3] = ["python3", "node", "bash"];
pub const ALLOWED_PYTHON_NAMES: [&str; 2] = ["python3", "python3.exe"];
pub const ALLOWED_TEMPLATES: [&str; 3] = ["target", "python", "max_videos"];

pub const DOWNSTREAM_OF_08: &str = "08-chunk";

// Composed step classes (R8.1): every step id belongs to exactly one.
pub const CRAWLING_CLASS: &str = "crawling";
pub const EVALUATION_CLASS: &str = "evaluation";
pub const MEDIA_CLASS: &str = "media";
pub const INSERTION_CLASS: &str = "insertion";
pub const STEP_CLASSES: [&str; 4] = [CRAWLING_CLASS, EVALUATION_CLASS, MEDIA_CLASS, INSERTION_CLASS];

/// Mirror of `graph.StepSpec`. Tuple fields use `'static` slices because the
/// table is a compile-time constant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepSpec {
    pub id: &'static str,
    pub canonical_name: &'static str,
    pub interpreter: &'static str,
    pub script: &'static str,
    pub extra_args: &'static [&'static str],
    pub capabilities: &'static [&'static str],
    pub channel_capabilities: &'static [&'static str],
    pub skip_when_lite: bool,
    pub skip_after: Option<&'static str>,
}

const NONE_CAP: &[&str] = &[];

/// The 18-step declarative graph, in the same order as `graph.STEP_SPECS`.
pub const STEP_SPECS: &[StepSpec] = &[
    StepSpec {
        id: "01-collect-urls",
        canonical_name: "Step 1 (URL Collection)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/01-collect-urls.py",
        extra_args: &["--channel", "{target}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "02-collect-meta",
        canonical_name: "Step 2 (Metadata)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/02-collect-meta.py",
        extra_args: &["--channel", "{target}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "02-1-migrate",
        canonical_name: "Step 2.1+2.5 (Migration+Cleanup)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/02-1-migrate-meta-to-supabase.py",
        extra_args: &["--channel", "{target}"],
        capabilities: &[MUTATING_CAPABILITY],
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "02-5-cleanup",
        canonical_name: "Step 2.1+2.5 (Migration+Cleanup)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/02-5-cleanup-orphans.py",
        extra_args: &["--channel", "{target}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "03-transcript",
        canonical_name: "Step 3 (Transcript)",
        interpreter: "node",
        script: "backend/restaurant-crawling/scripts/03-collect-transcript.js",
        extra_args: &["--channel", "{target}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "03-1-context",
        canonical_name: "Step 3.1 (Context Generation)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py",
        extra_args: &["--max-videos", "{max_videos}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "03-2-visual",
        canonical_name: "Step 3.2 (Visual Location)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/03-2-visual-location.py",
        extra_args: &["--channel", "{target}"],
        capabilities: &[HEAVY_CAPABILITY],
        channel_capabilities: NONE_CAP,
        skip_when_lite: true,
        skip_after: None,
    },
    StepSpec {
        id: "04-frames",
        canonical_name: "Step 4 (Heatmap & Frames)",
        interpreter: "node",
        script: "backend/restaurant-crawling/scripts/04-extract-frames-with-heatmap.js",
        extra_args: &["--channel", "{target}", "--delete-cache"],
        capabilities: &[HEAVY_CAPABILITY],
        channel_capabilities: NONE_CAP,
        skip_when_lite: true,
        skip_after: None,
    },
    StepSpec {
        id: "05-map-url",
        canonical_name: "Step 5 (Map URL Crawling)",
        interpreter: "node",
        script: "backend/restaurant-crawling/scripts/05-map-url-crawling.js",
        extra_args: &["--channel", "{target}"],
        capabilities: &[HEAVY_CAPABILITY],
        channel_capabilities: &[MAP_URL_CAPABILITY],
        skip_when_lite: true,
        skip_after: None,
    },
    StepSpec {
        id: "06-frame-caption",
        canonical_name: "Step 6 (Frame Caption)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/06-frame-caption.py",
        extra_args: &["--youtuber", "{target}"],
        capabilities: &[HEAVY_CAPABILITY],
        channel_capabilities: &[FRAME_CAPTION_CAPABILITY],
        skip_when_lite: true,
        skip_after: Some("04-frames"),
    },
    StepSpec {
        id: "06-1-enrich",
        canonical_name: "Step 6.1 (Enrich)",
        interpreter: "python3",
        script: "backend/restaurant-crawling/scripts/06-1-transcript-document-with-meta.py",
        extra_args: &["--channel", "{target}"],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: None,
    },
    StepSpec {
        id: "08-chunk",
        canonical_name: "Step 08 (Chunk Multimodal)",
        interpreter: "bash",
        script: "backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh",
        extra_args: &["--channel", "{target}"],
        capabilities: &[HEAVY_CAPABILITY],
        channel_capabilities: &[CHUNK_CAPABILITY],
        skip_when_lite: true,
        skip_after: None,
    },
    StepSpec {
        id: "09-target",
        canonical_name: "Step 09 (Target)",
        interpreter: "python3",
        script: "backend/restaurant-evaluation/scripts/09-target-selection.py",
        extra_args: &[
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some(DOWNSTREAM_OF_08),
    },
    StepSpec {
        id: "10-rule",
        canonical_name: "Step 10 (Rule Eval)",
        interpreter: "python3",
        script: "backend/restaurant-evaluation/scripts/10-rule-evaluation.py",
        extra_args: &[
            "--channel",
            "{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some("09-target"),
    },
    StepSpec {
        id: "11-laaj",
        canonical_name: "Step 11 (LAAJ Evaluation)",
        interpreter: "bash",
        script: "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh",
        extra_args: &[
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some("10-rule"),
    },
    StepSpec {
        id: "12-transform",
        canonical_name: "Step 12 (Transform)",
        interpreter: "python3",
        script: "backend/restaurant-evaluation/scripts/12-transform.py",
        extra_args: &[
            "--channel",
            "{target}",
            "--crawling-path",
            "backend/restaurant-crawling/data/{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ],
        capabilities: NONE_CAP,
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some("11-laaj"),
    },
    StepSpec {
        id: "13-supabase-insert",
        canonical_name: "Step 13 (Supabase)",
        interpreter: "python3",
        script: "backend/restaurant-evaluation/scripts/13-supabase-insert.py",
        extra_args: &[
            "--channel",
            "{target}",
            "--evaluation-path",
            "backend/restaurant-evaluation/data/{target}",
        ],
        capabilities: &[MUTATING_CAPABILITY],
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some("12-transform"),
    },
    StepSpec {
        id: "13-quality-gate",
        canonical_name: "Step 13.1 (Admin Data Quality Gate)",
        interpreter: "node",
        script: "backend/restaurant-evaluation/scripts/admin-data-quality-audit.mjs",
        extra_args: &["--fail-on-exact"],
        capabilities: &[MUTATING_CAPABILITY],
        channel_capabilities: NONE_CAP,
        skip_when_lite: false,
        skip_after: Some("13-supabase-insert"),
    },
];

/// `graph.ADAPTER_STEPS` — the ordered step ids.
pub fn adapter_steps() -> Vec<&'static str> {
    STEP_SPECS.iter().map(|s| s.id).collect()
}

/// Look up a [`StepSpec`] by id.
pub fn step_by_id(id: &str) -> Option<&'static StepSpec> {
    STEP_SPECS.iter().find(|s| s.id == id)
}

/// Port of `graph.STEP_CLASS_BY_ID` as a total function over the 18 ids.
///
/// Returns `Err("step_class_unknown")` for an id absent from the mapping, so an
/// unmapped step is never composed silently (mirrors `graph.step_class`).
pub fn step_class(step_id: &str) -> Result<&'static str, &'static str> {
    let class = match step_id {
        "01-collect-urls" | "02-collect-meta" | "02-1-migrate" | "02-5-cleanup"
        | "03-transcript" | "03-1-context" => CRAWLING_CLASS,
        "03-2-visual" | "09-target" | "10-rule" | "11-laaj" | "12-transform" => EVALUATION_CLASS,
        "04-frames" | "05-map-url" | "06-frame-caption" | "06-1-enrich" | "08-chunk" => MEDIA_CLASS,
        "13-supabase-insert" | "13-quality-gate" => INSERTION_CLASS,
        _ => return Err("step_class_unknown"),
    };
    Ok(class)
}

/// Port of `graph.validate_step_classes`: fail closed unless every step maps to
/// exactly one of the four classes and every class is non-empty.
pub fn validate_step_classes() -> Result<(), &'static str> {
    // Every STEP_SPECS id must have a class.
    let mut seen_classes = [false; 4];
    for spec in STEP_SPECS {
        let class = step_class(spec.id)?; // step_class_unknown propagates
        if let Some(idx) = STEP_CLASSES.iter().position(|c| *c == class) {
            seen_classes[idx] = true;
        }
    }
    // Every class must be represented (four non-empty classes).
    if seen_classes.iter().all(|&s| s) {
        Ok(())
    } else {
        Err("step_class_incomplete")
    }
}

/// Extract `{field}` template names from an argument string, mirroring what
/// `string.Formatter().parse(part)` yields for the simple `{name}` fields used
/// in `extra_args` (no nested/format-spec forms appear in the graph).
fn template_fields(arg: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let bytes = arg.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            // `{{` is a literal brace in str.format, not a field.
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                i += 2;
                continue;
            }
            if let Some(rel_end) = arg[i + 1..].find('}') {
                let raw = &arg[i + 1..i + 1 + rel_end];
                // Strip any format spec / conversion (`name:spec`, `name!r`).
                let name = raw
                    .split([':', '!'])
                    .next()
                    .unwrap_or(raw)
                    .to_string();
                if !name.is_empty() {
                    fields.push(name);
                }
                i = i + 1 + rel_end + 1;
                continue;
            }
        }
        i += 1;
    }
    fields
}

fn script_suffix_allowed(script: &str) -> bool {
    [".py", ".js", ".mjs", ".sh"]
        .iter()
        .any(|ext| script.ends_with(ext))
}

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Pure subset of `graph.validate_graph` (the non-filesystem checks).
///
/// Reproduces every check in `validate_graph` except `_reject_escape` and the
/// `is_file()` existence probe, which require the repository tree and stay in
/// Python. Returns the same fixed error codes on failure.
pub fn validate_graph_pure() -> Result<(), &'static str> {
    let context = step_by_id("03-1-context").ok_or("command_args_invalid")?;
    if context.extra_args.contains(&"--channel") {
        return Err("command_args_invalid");
    }
    let frames = step_by_id("04-frames").ok_or("command_path_invalid")?;
    if basename(frames.script) != "04-extract-frames-with-heatmap.js" {
        return Err("command_path_invalid");
    }
    if step_by_id("13-quality-gate").is_none() {
        return Err("quality_gate_missing");
    }
    validate_step_classes()?;
    for spec in STEP_SPECS {
        if !ALLOWED_INTERPRETERS.contains(&spec.interpreter) {
            return Err("interpreter_not_admitted");
        }
        if spec.script.starts_with('/') || !script_suffix_allowed(spec.script) {
            return Err("command_path_invalid");
        }
        for part in spec.extra_args {
            for field in template_fields(part) {
                if !ALLOWED_TEMPLATES.contains(&field.as_str()) {
                    return Err("command_args_invalid");
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_steps_has_eighteen_unique_ids() {
        let ids = adapter_steps();
        assert_eq!(ids.len(), 18);
        let unique: std::collections::BTreeSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 18);
    }

    #[test]
    fn every_step_maps_to_one_class() {
        assert_eq!(validate_step_classes(), Ok(()));
        for spec in STEP_SPECS {
            assert!(step_class(spec.id).is_ok(), "unmapped {}", spec.id);
        }
        assert_eq!(step_class("nonexistent"), Err("step_class_unknown"));
    }

    #[test]
    fn class_assignment_matches_python() {
        assert_eq!(step_class("01-collect-urls"), Ok(CRAWLING_CLASS));
        assert_eq!(step_class("03-2-visual"), Ok(EVALUATION_CLASS));
        assert_eq!(step_class("04-frames"), Ok(MEDIA_CLASS));
        assert_eq!(step_class("06-1-enrich"), Ok(MEDIA_CLASS));
        assert_eq!(step_class("13-quality-gate"), Ok(INSERTION_CLASS));
    }

    #[test]
    fn validate_graph_pure_passes_on_canonical_table() {
        assert_eq!(validate_graph_pure(), Ok(()));
    }

    #[test]
    fn template_field_extraction() {
        assert_eq!(template_fields("{target}"), vec!["target".to_string()]);
        assert_eq!(
            template_fields("backend/restaurant-crawling/data/{target}"),
            vec!["target".to_string()]
        );
        assert!(template_fields("--delete-cache").is_empty());
        assert_eq!(template_fields("{max_videos}"), vec!["max_videos".to_string()]);
    }
}
