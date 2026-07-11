use base64::{engine::general_purpose::STANDARD, Engine};

pub fn base64_encode(input: &[u8]) -> String {
    STANDARD.encode(input)
}

pub fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    STANDARD.decode(input).map_err(|e| e.to_string())
}
