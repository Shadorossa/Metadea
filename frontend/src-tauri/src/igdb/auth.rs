// Twitch client-credentials token cache (IGDB authenticates through Twitch).

use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

// -- Twitch token cache --------------------------------------------------------

struct TwitchToken {
    access_token: String,
    expires: Instant,
}

static TWITCH_TOKEN: Mutex<Option<TwitchToken>> = Mutex::new(None);

pub(crate) async fn get_twitch_token(client_id: &str, client_secret: &str) -> Result<String, String> {
    {
        // Recovers the guard even if the mutex was poisoned by a panic
        // elsewhere while holding it — there's no broken invariant here
        // (just an Option<TwitchToken> plain value), so it's safe to keep
        // using it rather than propagate the poisoning as a hard crash.
        let cache = TWITCH_TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(ref t) = *cache {
            if t.expires > Instant::now() + Duration::from_secs(60) {
                return Ok(t.access_token.clone());
            }
        }
    }

    #[derive(Deserialize)]
    struct TwitchResp {
        access_token: String,
        expires_in: u64,
    }

    let client = crate::http::http_client();
    let http = client
        .post("https://id.twitch.tv/oauth2/token")
        .query(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("grant_type", "client_credentials"),
        ])
        .send()
        .await
        .map_err(|e| format!("Twitch request failed: {}", e))?;
    if !http.status().is_success() {
        let status = http.status();
        let body = http.text().await.unwrap_or_default();
        return Err(format!("Twitch auth failed (HTTP {}): {}", status, body));
    }
    let resp = http
        .json::<TwitchResp>()
        .await
        .map_err(|e| format!("Twitch parse failed: {}", e))?;

    let token = resp.access_token.clone();
    let expires = Instant::now() + Duration::from_secs(resp.expires_in);
    *TWITCH_TOKEN.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(TwitchToken {
        access_token: resp.access_token,
        expires,
    });
    Ok(token)
}
