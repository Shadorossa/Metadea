//! `manifest.json` of a plugin package (see `docs/PLUGINS.md`, "Manifest").
//! Parsing is strict: unknown fields are rejected so a typo never silently
//! drops a permission or a contribution, and every string that later becomes
//! a path, a host pattern or an id is checked here, once. The TypeScript
//! mirror is `frontend/src/lib/plugins/manifest.ts`; both run the shared
//! table `src/fixtures/plugins/manifest-cases.json` in their tests.
use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::host_rules::HostPattern;
use crate::error_codes::{self, with_detail};

pub const MANIFEST_FILE: &str = "manifest.json";
/// Plugin API versions this build can run.
pub const SUPPORTED_API_VERSIONS: &[u32] = &[1];

pub const MAX_ID_LEN: usize = 100;
const MAX_NAME_LEN: usize = 64;
const MAX_AUTHOR_LEN: usize = 64;
const MAX_DESCRIPTION_LEN: usize = 500;
const MAX_VERSION_LEN: usize = 32;
const MAX_HOSTS: usize = 32;
const MAX_SETTINGS: usize = 32;
const MAX_SELECT_OPTIONS: usize = 64;
const MAX_CONTRIBUTIONS_PER_KIND: usize = 16;
const MAX_LABEL_LEN: usize = 80;
const MAX_HELP_LEN: usize = 300;

/// Capabilities a plugin may ask for besides network hosts.
pub const CAPABILITIES: &[&str] = &["notifications", "openUrl"];
/// Read-only events a plugin may subscribe to.
pub const EVENTS: &[&str] = &["library.changed", "progress.changed", "session.ended"];
/// Work types a source may serve.
pub const SOURCE_TYPES: &[&str] = &["manga", "comic", "lnovel", "book"];
/// Work types a media-page action or panel may target.
pub const WORK_TYPES: &[&str] = &[
    "anime", "manga", "lnovel", "book", "comic", "movie", "series", "game", "vn", "event",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: u32,
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub main: String,
    #[serde(default)]
    pub permissions: PluginPermissions,
    #[serde(default)]
    pub settings: Vec<SettingField>,
    #[serde(default)]
    pub contributes: Contributions,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginPermissions {
    /// `host`, `host:port`, `host:*`, `*.domain` or `*.domain:port`.
    #[serde(default)]
    pub hosts: Vec<String>,
    /// Keys of `url` settings whose host (as the user typed it) is allowed.
    #[serde(default)]
    pub settings_hosts: Vec<String>,
    /// Subset of [`CAPABILITIES`].
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SettingType {
    String,
    Secret,
    Number,
    Boolean,
    Select,
    Url,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingField {
    pub key: String,
    #[serde(rename = "type")]
    pub kind: SettingType,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SettingOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contributions {
    #[serde(default)]
    pub sources: Vec<SourceContribution>,
    #[serde(default)]
    pub work_actions: Vec<WorkContribution>,
    #[serde(default)]
    pub work_panels: Vec<WorkContribution>,
    #[serde(default)]
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceContribution {
    pub id: String,
    pub name: String,
    /// Subset of [`SOURCE_TYPES`], at least one.
    pub types: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

/// A media-page action button or panel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkContribution {
    pub id: String,
    /// Button label / panel title.
    pub label: String,
    /// Subset of [`WORK_TYPES`]; empty = every type.
    #[serde(default)]
    pub types: Vec<String>,
}

// ── Field rules ───────────────────────────────────────────────────────────────

/// Reverse-DNS: at least two dot-separated labels of `[a-z0-9-]`, the first
/// starting with a letter, no label starting or ending with `-`. Safe as a
/// folder name and a SQL key on every platform.
pub fn is_valid_plugin_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return false;
    }
    let labels: Vec<&str> = id.split('.').collect();
    if labels.len() < 2 {
        return false;
    }
    if !labels[0].bytes().next().is_some_and(|b| b.is_ascii_lowercase()) {
        return false;
    }
    labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    })
}

/// `MAJOR.MINOR.PATCH` with an optional `-prerelease` of `[0-9A-Za-z.-]`.
pub fn is_valid_version(version: &str) -> bool {
    if version.is_empty() || version.len() > MAX_VERSION_LEN {
        return false;
    }
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let core_ok = parts.len() == 3
        && parts.iter().all(|p| {
            !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) && (p.len() == 1 || !p.starts_with('0'))
        });
    let pre_ok = pre.map_or(true, |pre| {
        !pre.is_empty() && pre.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    });
    core_ok && pre_ok
}

pub(crate) fn is_valid_contribution_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.as_bytes()[0].is_ascii_alphanumeric()
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub(crate) fn is_valid_setting_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && key.as_bytes()[0].is_ascii_alphabetic()
        && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn is_relative_file(path: &str, extensions: &[&str]) -> bool {
    if crate::utils::safe_archive_path(Path::new(path)).is_none() {
        return false;
    }
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| extensions.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}

fn bounded_text(field: &str, value: &str, max: usize, required: bool) -> Result<(), String> {
    if required && value.trim().is_empty() {
        return Err(format!("{field} is empty"));
    }
    if value.chars().count() > max {
        return Err(format!("{field} is longer than {max} characters"));
    }
    if value.chars().any(|c| c.is_control() && c != '\n') {
        return Err(format!("{field} contains control characters"));
    }
    Ok(())
}

fn check_unique<'a>(what: &str, ids: impl Iterator<Item = &'a str>) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(format!("duplicate {what} \"{id}\""));
        }
    }
    Ok(())
}

fn check_setting(field: &SettingField) -> Result<(), String> {
    if !is_valid_setting_key(&field.key) {
        return Err(format!("setting key \"{}\" must match [A-Za-z][A-Za-z0-9_]* (64 max)", field.key));
    }
    bounded_text("setting label", &field.label, MAX_LABEL_LEN, true)?;
    if let Some(description) = &field.description {
        bounded_text("setting description", description, MAX_HELP_LEN, false)?;
    }
    if let Some(placeholder) = &field.placeholder {
        bounded_text("setting placeholder", placeholder, MAX_LABEL_LEN, false)?;
    }
    let key = &field.key;
    if field.kind == SettingType::Select {
        if field.options.is_empty() || field.options.len() > MAX_SELECT_OPTIONS {
            return Err(format!("select setting \"{key}\" needs 1 to {MAX_SELECT_OPTIONS} options"));
        }
        check_unique("option", field.options.iter().map(|o| o.value.as_str()))?;
        for option in &field.options {
            bounded_text("option value", &option.value, MAX_LABEL_LEN, true)?;
            bounded_text("option label", &option.label, MAX_LABEL_LEN, true)?;
        }
    } else if !field.options.is_empty() {
        return Err(format!("setting \"{key}\" has options but is not a select"));
    }
    if field.kind != SettingType::Number && (field.min.is_some() || field.max.is_some()) {
        return Err(format!("setting \"{key}\" has min/max but is not a number"));
    }
    if let (Some(min), Some(max)) = (field.min, field.max) {
        if min > max {
            return Err(format!("setting \"{key}\" has min > max"));
        }
    }
    if field.kind == SettingType::Secret && field.default.is_some() {
        return Err(format!("secret setting \"{key}\" cannot have a default"));
    }
    if let Some(default) = &field.default {
        super::settings::check_value(field, default)
            .map_err(|reason| format!("default of \"{key}\": {reason}"))?;
    }
    Ok(())
}

fn check_types(what: &str, types: &[String], allowed: &[&str], required: bool) -> Result<(), String> {
    if required && types.is_empty() {
        return Err(format!("{what} needs at least one type"));
    }
    for kind in types {
        if !allowed.contains(&kind.as_str()) {
            return Err(format!("{what} has unknown type \"{kind}\""));
        }
    }
    check_unique("type", types.iter().map(String::as_str))
}

fn check_contributions(contributes: &Contributions) -> Result<(), String> {
    let too_many = |kind: &str| format!("more than {MAX_CONTRIBUTIONS_PER_KIND} {kind}");
    if contributes.sources.len() > MAX_CONTRIBUTIONS_PER_KIND {
        return Err(too_many("sources"));
    }
    if contributes.work_actions.len() > MAX_CONTRIBUTIONS_PER_KIND {
        return Err(too_many("workActions"));
    }
    if contributes.work_panels.len() > MAX_CONTRIBUTIONS_PER_KIND {
        return Err(too_many("workPanels"));
    }
    check_unique("source id", contributes.sources.iter().map(|s| s.id.as_str()))?;
    check_unique("workAction id", contributes.work_actions.iter().map(|s| s.id.as_str()))?;
    check_unique("workPanel id", contributes.work_panels.iter().map(|s| s.id.as_str()))?;
    for source in &contributes.sources {
        if !is_valid_contribution_id(&source.id) {
            return Err(format!("source id \"{}\" must match [a-z0-9-]+", source.id));
        }
        bounded_text("source name", &source.name, MAX_LABEL_LEN, true)?;
        check_types(&format!("source \"{}\"", source.id), &source.types, SOURCE_TYPES, true)?;
        if let Some(language) = &source.language {
            let ok = (2..=8).contains(&language.len())
                && language.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-');
            if !ok {
                return Err(format!("source \"{}\" has an invalid language tag", source.id));
            }
        }
    }
    for (kind, list) in [("workAction", &contributes.work_actions), ("workPanel", &contributes.work_panels)] {
        for item in list.iter() {
            if !is_valid_contribution_id(&item.id) {
                return Err(format!("{kind} id \"{}\" must match [a-z0-9-]+", item.id));
            }
            bounded_text(&format!("{kind} label"), &item.label, MAX_LABEL_LEN, true)?;
            check_types(&format!("{kind} \"{}\"", item.id), &item.types, WORK_TYPES, false)?;
        }
    }
    for event in &contributes.events {
        if !EVENTS.contains(&event.as_str()) {
            return Err(format!("unknown event \"{event}\""));
        }
    }
    check_unique("event", contributes.events.iter().map(String::as_str))
}

fn check_permissions(manifest: &PluginManifest) -> Result<(), String> {
    let permissions = &manifest.permissions;
    if permissions.hosts.len() > MAX_HOSTS {
        return Err(format!("more than {MAX_HOSTS} hosts"));
    }
    for host in &permissions.hosts {
        HostPattern::parse(host).map_err(|reason| format!("host \"{host}\": {reason}"))?;
    }
    check_unique("host", permissions.hosts.iter().map(String::as_str))?;
    for key in &permissions.settings_hosts {
        let is_url_setting = manifest.settings.iter().any(|f| &f.key == key && f.kind == SettingType::Url);
        if !is_url_setting {
            return Err(format!("settingsHosts entry \"{key}\" is not a url setting"));
        }
    }
    check_unique("settingsHosts entry", permissions.settings_hosts.iter().map(String::as_str))?;
    for capability in &permissions.capabilities {
        if !CAPABILITIES.contains(&capability.as_str()) {
            return Err(format!("unknown capability \"{capability}\""));
        }
    }
    check_unique("capability", permissions.capabilities.iter().map(String::as_str))
}

/// Every rule besides JSON shape. Errors are plain English details; the
/// caller wraps them in an `E_PLUGIN_*` code.
fn check(manifest: &PluginManifest) -> Result<(), String> {
    if !is_valid_plugin_id(&manifest.id) {
        return Err(format!("id \"{}\" must be reverse-DNS (e.g. com.example.my-plugin)", manifest.id));
    }
    if !is_valid_version(&manifest.version) {
        return Err(format!("version \"{}\" must be MAJOR.MINOR.PATCH", manifest.version));
    }
    bounded_text("name", &manifest.name, MAX_NAME_LEN, true)?;
    bounded_text("author", &manifest.author, MAX_AUTHOR_LEN, true)?;
    bounded_text("description", &manifest.description, MAX_DESCRIPTION_LEN, false)?;
    if !is_relative_file(&manifest.main, &["js"]) {
        return Err(format!("main \"{}\" must be a relative .js path inside the package", manifest.main));
    }
    if let Some(icon) = &manifest.icon {
        if !is_relative_file(icon, &["png", "svg", "webp", "jpg", "jpeg"]) {
            return Err(format!("icon \"{icon}\" must be a relative png/svg/webp/jpg path inside the package"));
        }
    }
    if manifest.settings.len() > MAX_SETTINGS {
        return Err(format!("more than {MAX_SETTINGS} settings"));
    }
    check_unique("setting key", manifest.settings.iter().map(|f| f.key.as_str()))?;
    for field in &manifest.settings {
        check_setting(field)?;
    }
    check_permissions(manifest)?;
    check_contributions(&manifest.contributes)
}

/// Parses and validates `manifest.json`.
pub fn parse_manifest(json: &str) -> Result<PluginManifest, String> {
    let invalid = |detail: String| with_detail(error_codes::PLUGIN_MANIFEST_INVALID, detail);
    // apiVersion first: a manifest for a newer API may legitimately carry
    // fields this build does not know, which deny_unknown_fields would
    // otherwise report as a confusing "unknown field".
    let raw: serde_json::Value = serde_json::from_str(json).map_err(|e| invalid(e.to_string()))?;
    if !raw.is_object() {
        return Err(invalid("manifest must be a JSON object".into()));
    }
    if let Some(api) = raw.get("apiVersion") {
        let supported = api.as_u64().is_some_and(|v| SUPPORTED_API_VERSIONS.iter().any(|s| u64::from(*s) == v));
        if !supported {
            return Err(with_detail(error_codes::PLUGIN_API_UNSUPPORTED, api));
        }
    }
    let manifest: PluginManifest = serde_json::from_value(raw).map_err(|e| invalid(e.to_string()))?;
    check(&manifest).map_err(invalid)?;
    Ok(manifest)
}

// ── Permission sets (grants and escalation) ───────────────────────────────────

/// A manifest's permissions as flat, comparable tokens: `host:<pattern>`,
/// `settingsHost:<key>`, `cap:<capability>`. The `plugins` row stores the
/// granted set in this form; an update whose set is not a subset of the
/// grant needs the user's consent again.
pub fn permission_tokens(permissions: &PluginPermissions) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for host in &permissions.hosts {
        out.insert(format!("host:{}", host.to_ascii_lowercase()));
    }
    for key in &permissions.settings_hosts {
        out.insert(format!("settingsHost:{key}"));
    }
    for capability in &permissions.capabilities {
        out.insert(format!("cap:{capability}"));
    }
    out
}

/// Tokens `requested` has that `granted` does not.
pub fn permission_escalation(granted: &BTreeSet<String>, requested: &BTreeSet<String>) -> Vec<String> {
    requested.difference(granted).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../fixtures/plugins/manifest-cases.json");
    const HELLO_SOURCE: &str = include_str!("../../../../plugins/examples/hello-source/manifest.json");

    #[derive(Deserialize)]
    struct Case {
        name: String,
        manifest: serde_json::Value,
        valid: bool,
        #[serde(default)]
        code: Option<String>,
    }

    #[test]
    fn shared_manifest_cases() {
        let cases: Vec<Case> = serde_json::from_str(CASES).expect("manifest-cases.json");
        assert!(cases.len() > 20);
        for case in cases {
            let result = parse_manifest(&case.manifest.to_string());
            assert_eq!(result.is_ok(), case.valid, "case \"{}\": {result:?}", case.name);
            if let (Some(code), Err(error)) = (&case.code, &result) {
                assert!(error.starts_with(code.as_str()), "case \"{}\": {error}", case.name);
            }
        }
    }

    #[test]
    fn example_plugin_manifest_is_valid() {
        let manifest = parse_manifest(HELLO_SOURCE).expect("hello-source manifest");
        assert_eq!(manifest.id, "org.metadea.examples.hello-source");
        assert!(manifest.permissions.hosts.is_empty());
        assert_eq!(manifest.contributes.sources.len(), 1);
    }

    #[test]
    fn plugin_ids() {
        for ok in ["com.example.x", "org.metadea.examples.hello-source", "a.b", "io.x-y.z9"] {
            assert!(is_valid_plugin_id(ok), "{ok}");
        }
        for bad in ["", "single", "Com.example", "com..x", "com.-x", "com.x-", "9com.x", "com.ex ample", "com/x.y", "../x.y"] {
            assert!(!is_valid_plugin_id(bad), "{bad}");
        }
        assert!(!is_valid_plugin_id(&format!("a.{}", "b".repeat(120))));
    }

    #[test]
    fn versions() {
        for ok in ["0.1.0", "1.2.3", "10.0.0-beta.1", "1.0.0-rc-2"] {
            assert!(is_valid_version(ok), "{ok}");
        }
        for bad in ["1", "1.2", "1.2.3.4", "01.2.3", "1.2.x", "1.2.3-", "v1.2.3", "1.2.3+build"] {
            assert!(!is_valid_version(bad), "{bad}");
        }    }

    #[test]
    fn escalation_is_the_new_tokens_only() {
        let old = PluginPermissions { hosts: vec!["a.example.com".into()], settings_hosts: vec![], capabilities: vec!["notifications".into()] };
        let new = PluginPermissions {
            hosts: vec!["A.example.com".into(), "b.example.com".into()],
            settings_hosts: vec!["server".into()],
            capabilities: vec!["notifications".into()],
        };
        let escalation = permission_escalation(&permission_tokens(&old), &permission_tokens(&new));
        assert_eq!(escalation, vec!["host:b.example.com".to_string(), "settingsHost:server".to_string()]);
        assert!(permission_escalation(&permission_tokens(&new), &permission_tokens(&old)).is_empty());
    }
}
