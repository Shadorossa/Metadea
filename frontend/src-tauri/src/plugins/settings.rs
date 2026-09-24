//! Per-plugin settings: values the user enters in Settings › Plugins, typed
//! by the manifest's `settings` schema. Stored as one JSON object in
//! `plugins.settings`; `secret` values are wrapped as `{"$secret": "<dpapi>"}`
//! through `utils::encrypt_secret` (Windows DPAPI, user scope — base64 only
//! on other platforms), so the database never holds them in clear text.
use serde_json::{Map, Value};

use super::manifest::{SettingField, SettingType};

const MAX_STRING_LEN: usize = 4096;
const SECRET_TAG: &str = "$secret";

/// Whether `value` fits `field`'s type. Errors are plain English details.
pub fn check_value(field: &SettingField, value: &Value) -> Result<(), String> {
    match field.kind {
        SettingType::String | SettingType::Secret => {
            let text = value.as_str().ok_or("expected a string")?;
            if text.len() > MAX_STRING_LEN {
                return Err(format!("longer than {MAX_STRING_LEN} bytes"));
            }
            Ok(())
        }
        SettingType::Url => {
            let text = value.as_str().ok_or("expected a string")?;
            if text.is_empty() {
                return Ok(());
            }
            let url = reqwest::Url::parse(text).map_err(|_| "not a valid URL")?;
            if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
                return Err("expected an http(s) URL".into());
            }
            if !url.username().is_empty() || url.password().is_some() {
                return Err("credentials in the URL are not allowed; use a secret setting".into());
            }
            Ok(())
        }
        SettingType::Number => {
            let number = value.as_f64().ok_or("expected a number")?;
            if field.min.is_some_and(|min| number < min) || field.max.is_some_and(|max| number > max) {
                return Err("out of range".into());
            }
            Ok(())
        }
        SettingType::Boolean => value.as_bool().map(|_| ()).ok_or_else(|| "expected true or false".into()),
        SettingType::Select => {
            let text = value.as_str().ok_or("expected a string")?;
            if field.options.iter().any(|o| o.value == text) {
                Ok(())
            } else {
                Err(format!("\"{text}\" is not one of the options"))
            }
        }
    }
}

/// Validates user input against the schema and returns the object to
/// store (secrets encrypted). A `null` value or a missing key clears that
/// setting (defaults then apply); a secret sent as `null` is kept when the
/// UI leaves it untouched, which it signals by omitting the key — see
/// [`merge_for_storage`].
pub fn validate_input(schema: &[SettingField], input: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    for key in input.keys() {
        if !schema.iter().any(|f| &f.key == key) {
            return Err(format!("unknown setting \"{key}\""));
        }
    }
    let mut out = Map::new();
    for field in schema {
        match input.get(&field.key) {
            None | Some(Value::Null) => {
                if field.required && field.default.is_none() {
                    return Err(format!("\"{}\" is required", field.key));
                }
            }
            Some(value) => {
                check_value(field, value).map_err(|reason| format!("\"{}\": {reason}", field.key))?;
                if field.required && value.as_str().is_some_and(str::is_empty) {
                    return Err(format!("\"{}\" is required", field.key));
                }
                out.insert(field.key.clone(), value.clone());
            }
        }
    }
    Ok(out)
}

/// Stored form of validated input: secrets wrapped and encrypted. Secrets
/// absent from `input` keep their previous stored (encrypted) value, so the
/// form never has to send a secret back just to save another field.
pub fn merge_for_storage(
    schema: &[SettingField],
    input: &Map<String, Value>,
    validated: Map<String, Value>,
    previous: &Map<String, Value>,
    encrypt: impl Fn(&str) -> Result<String, String>,
) -> Result<Map<String, Value>, String> {
    let mut out = Map::new();
    for field in schema {
        let key = &field.key;
        if field.kind == SettingType::Secret {
            match validated.get(key).and_then(Value::as_str) {
                Some("") => {}
                Some(secret) => {
                    let mut wrapped = Map::new();
                    wrapped.insert(SECRET_TAG.into(), Value::String(encrypt(secret)?));
                    out.insert(key.clone(), Value::Object(wrapped));
                }
                None if !input.contains_key(key) => {
                    if let Some(old) = previous.get(key) {
                        out.insert(key.clone(), old.clone());
                    }
                }
                None => {}
            }
        } else if let Some(value) = validated.get(key) {
            out.insert(key.clone(), value.clone());
        }
    }
    Ok(out)
}

/// Effective values for the worker: stored values (secrets decrypted) over
/// schema defaults. Stored keys no longer in the schema are dropped.
pub fn effective_values(
    schema: &[SettingField],
    stored: &Map<String, Value>,
    decrypt: impl Fn(&str) -> Result<String, String>,
) -> Map<String, Value> {
    let mut out = Map::new();
    for field in schema {
        let value = match stored.get(&field.key) {
            Some(Value::Object(wrapped)) if field.kind == SettingType::Secret => wrapped
                .get(SECRET_TAG)
                .and_then(Value::as_str)
                .and_then(|enc| decrypt(enc).ok())
                .map(Value::String),
            Some(value) if field.kind != SettingType::Secret && check_value(field, value).is_ok() => Some(value.clone()),
            _ => None,
        };
        if let Some(value) = value.or_else(|| field.default.clone()) {
            out.insert(field.key.clone(), value);
        }
    }
    out
}

/// Keys of secret settings that hold a value — the settings form shows
/// "saved" for them instead of echoing the secret.
pub fn stored_secret_keys(schema: &[SettingField], stored: &Map<String, Value>) -> Vec<String> {
    schema
        .iter()
        .filter(|f| f.kind == SettingType::Secret && stored.get(&f.key).is_some_and(Value::is_object))
        .map(|f| f.key.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest::SettingOption;
    use serde_json::json;

    fn field(key: &str, kind: SettingType) -> SettingField {
        SettingField {
            key: key.into(),
            kind,
            label: key.into(),
            description: None,
            default: None,
            required: false,
            options: vec![],
            min: None,
            max: None,
            placeholder: None,
        }
    }

    fn schema() -> Vec<SettingField> {
        let mut server = field("server", SettingType::Url);
        server.required = true;
        let mut count = field("count", SettingType::Number);
        count.min = Some(1.0);
        count.max = Some(10.0);
        count.default = Some(json!(5));
        let mut mode = field("mode", SettingType::Select);
        mode.options = vec![SettingOption { value: "a".into(), label: "A".into() }, SettingOption { value: "b".into(), label: "B".into() }];
        vec![server, field("password", SettingType::Secret), count, field("nsfw", SettingType::Boolean), mode]
    }

    fn obj(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn validates_types_and_required() {
        let schema = schema();
        assert!(validate_input(&schema, &obj(json!({ "server": "http://192.168.1.2:4567" }))).is_ok());
        assert!(validate_input(&schema, &obj(json!({}))).is_err(), "required url");
        assert!(validate_input(&schema, &obj(json!({ "server": "" }))).is_err(), "required url, empty");
        assert!(validate_input(&schema, &obj(json!({ "server": "ftp://x" }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://u:p@x.org" }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://x.org", "count": 11 }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://x.org", "count": "3" }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://x.org", "mode": "c" }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://x.org", "nsfw": 1 }))).is_err());
        assert!(validate_input(&schema, &obj(json!({ "server": "https://x.org", "other": 1 }))).is_err());
    }

    #[test]
    fn secrets_are_encrypted_kept_and_decrypted() {
        let schema = schema();
        let encrypt = |s: &str| Ok(format!("enc({s})"));
        let decrypt = |s: &str| Ok(s.trim_start_matches("enc(").trim_end_matches(')').to_string());

        let input = obj(json!({ "server": "https://x.org", "password": "hunter2" }));
        let validated = validate_input(&schema, &input).unwrap();
        let stored = merge_for_storage(&schema, &input, validated, &Map::new(), encrypt).unwrap();
        assert_eq!(stored["password"], json!({ "$secret": "enc(hunter2)" }));
        assert_eq!(stored_secret_keys(&schema, &stored), vec!["password".to_string()]);

        // Saving without the secret key keeps the stored secret.
        let input2 = obj(json!({ "server": "https://y.org" }));
        let validated2 = validate_input(&schema, &input2).unwrap();
        let stored2 = merge_for_storage(&schema, &input2, validated2, &stored, encrypt).unwrap();
        assert_eq!(stored2["password"], stored["password"]);

        // An explicit empty string clears it.
        let input3 = obj(json!({ "server": "https://y.org", "password": "" }));
        let validated3 = validate_input(&schema, &input3).unwrap();
        let stored3 = merge_for_storage(&schema, &input3, validated3, &stored2, encrypt).unwrap();
        assert!(!stored3.contains_key("password"));

        let effective = effective_values(&schema, &stored2, decrypt);
        assert_eq!(effective["password"], json!("hunter2"));
        assert_eq!(effective["server"], json!("https://y.org"));
        assert_eq!(effective["count"], json!(5), "default applies");
        assert!(!effective.contains_key("nsfw"));
    }
}
