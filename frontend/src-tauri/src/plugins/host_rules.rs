//! Which URLs a plugin may reach through `plugin_http_fetch`. Two rules:
//!
//! 1. The host must match one of the patterns the user granted (manifest
//!    `permissions.hosts`, plus the host of every `settingsHosts` URL the
//!    user typed into the plugin's settings).
//! 2. The scheme must be `https`, except for loopback and private-network
//!    hosts (a media server on the user's LAN), which may also use `http`.
//!
//! Pattern syntax (`docs/PLUGINS.md`, "Hosts"): `example.com`,
//! `example.com:8443`, `example.com:*`, `*.example.com`, `*.example.com:8443`,
//! IPv4 literals and bracketed IPv6 literals. A pattern without a port only
//! matches the scheme's default port. `*.` matches any depth of subdomain but
//! not the bare domain, and needs at least two labels after it (`*.com` is
//! rejected), and never applies to IP literals or `localhost`.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone, PartialEq, Eq)]
enum PortRule {
    Default,
    Any,
    Exact(u16),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostPattern {
    wildcard: bool,
    /// Lower-cased host (no brackets for IPv6); for a wildcard, the suffix
    /// after `*.`.
    host: String,
    port: PortRule,
}

fn is_hostname_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 63
        && !label.starts_with('-')
        && !label.ends_with('-')
        && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn is_hostname(host: &str) -> bool {
    host.len() <= 253 && host.split('.').all(is_hostname_label)
}

/// Splits `host[:port]` / `[v6][:port]` into a lower-cased host and an
/// optional port string.
fn split_host_port(input: &str) -> Result<(String, Option<&str>), String> {
    if let Some(rest) = input.strip_prefix('[') {
        let end = rest.find(']').ok_or("unclosed [ in IPv6 host")?;
        let host = rest[..end]
            .parse::<Ipv6Addr>()
            .map_err(|_| "invalid IPv6 address".to_string())?
            .to_string();
        let after = &rest[end + 1..];
        let port = match after {
            "" => None,
            _ => Some(after.strip_prefix(':').ok_or("unexpected text after ]")?),
        };
        return Ok((host, port));
    }
    match input.rsplit_once(':') {
        Some((host, port)) => {
            if host.contains(':') {
                return Err("IPv6 hosts must be written in brackets".into());
            }
            Ok((host.to_ascii_lowercase(), Some(port)))
        }
        None => Ok((input.to_ascii_lowercase(), None)),
    }
}

fn parse_port(port: &str) -> Result<u16, String> {
    match port.parse::<u16>() {
        Ok(p) if p > 0 && !port.starts_with('0') => Ok(p),
        _ => Err(format!("invalid port \"{port}\"")),
    }
}

impl HostPattern {
    pub fn parse(input: &str) -> Result<Self, String> {
        let input = input.trim();
        if input.is_empty() {
            return Err("empty host".into());
        }
        if input.contains("://") || input.contains('/') || input.contains('@') || input.contains('?') {
            return Err("write the host only, without a scheme, path or credentials".into());
        }
        let (wildcard, rest) = match input.strip_prefix("*.") {
            Some(rest) => (true, rest),
            None => (false, input),
        };
        let (host, port) = split_host_port(rest)?;
        if host.contains('*') {
            return Err("\"*\" is only allowed as a leading \"*.\" or as the port".into());
        }
        let port = match port {
            None => PortRule::Default,
            Some("*") => PortRule::Any,
            Some(p) => PortRule::Exact(parse_port(p)?),
        };
        let is_ip = host.parse::<IpAddr>().is_ok();
        if !is_ip && !is_hostname(&host) {
            return Err("invalid host name".into());
        }
        if wildcard {
            if is_ip || host == "localhost" {
                return Err("wildcards cannot apply to IP addresses or localhost".into());
            }
            if host.split('.').count() < 2 {
                return Err("a wildcard needs at least two labels after \"*.\"".into());
            }
        }
        Ok(Self { wildcard, host, port })
    }

    /// Exact pattern for a URL the user typed (a `settingsHosts` value):
    /// its host and effective port.
    pub fn exact_for_url(url: &reqwest::Url) -> Option<Self> {
        let host = url_host(url)?;
        let port = url.port_or_known_default()?;
        Some(Self { wildcard: false, host, port: PortRule::Exact(port) })
    }

    fn matches(&self, host: &str, port: u16, default_port: u16) -> bool {
        let host_ok = if self.wildcard {
            host.len() > self.host.len() + 1
                && host.ends_with(&self.host)
                && host.as_bytes()[host.len() - self.host.len() - 1] == b'.'
        } else {
            host == self.host
        };
        let port_ok = match self.port {
            PortRule::Default => port == default_port,
            PortRule::Any => true,
            PortRule::Exact(p) => port == p,
        };
        host_ok && port_ok
    }
}

/// Lower-cased host of a URL, IPv6 without brackets, trailing dot removed.
fn url_host(url: &reqwest::Url) -> Option<String> {
    let raw = url.host_str()?;
    let host = match raw.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        Some(v6) => v6.to_ascii_lowercase(),
        None => raw.trim_end_matches('.').to_ascii_lowercase(),
    };
    (!host.is_empty()).then_some(host)
}

fn is_private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        // 100.64.0.0/10: carrier-grade NAT, also where Tailscale puts devices.
        || (a == 100 && (64..=127).contains(&b))
}

fn is_private_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_loopback()
        || (first & 0xfe00) == 0xfc00 // fc00::/7 unique local
        || (first & 0xffc0) == 0xfe80 // fe80::/10 link local
        || ip.to_ipv4_mapped().is_some_and(is_private_v4)
}

/// Loopback or private-network host, where plain `http` is accepted:
/// `localhost` (and `*.localhost`), private/link-local/CGNAT IP literals,
/// single-label names (`nas`) and the `.local`, `.lan`, `.home.arpa` and
/// `.internal` suffixes.
pub fn is_local_host(host: &str) -> bool {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => is_private_v4(v4),
            IpAddr::V6(v6) => is_private_v6(v6),
        };
    }
    let host = host.trim_end_matches('.');
    host == "localhost"
        || !host.contains('.')
        || [".localhost", ".local", ".lan", ".home.arpa", ".internal"].iter().any(|suffix| host.ends_with(suffix))
}

#[derive(Debug, PartialEq, Eq)]
pub enum UrlRejection {
    /// Not an absolute http(s) URL, or it carries credentials.
    Invalid,
    /// `http` to a public host.
    InsecureScheme,
    /// No granted pattern matches.
    HostNotAllowed,
}

/// Checks `url` against the granted patterns and the scheme rule.
pub fn check_url(url: &reqwest::Url, allowlist: &[HostPattern]) -> Result<(), UrlRejection> {
    let scheme = url.scheme();
    if scheme != "https" && scheme != "http" {
        return Err(UrlRejection::Invalid);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlRejection::Invalid);
    }
    let host = url_host(url).ok_or(UrlRejection::Invalid)?;
    let port = url.port_or_known_default().ok_or(UrlRejection::Invalid)?;
    let default_port = if scheme == "https" { 443 } else { 80 };
    if scheme == "http" && !is_local_host(&host) {
        return Err(UrlRejection::InsecureScheme);
    }
    if allowlist.iter().any(|pattern| pattern.matches(&host, port, default_port)) {
        Ok(())
    } else {
        Err(UrlRejection::HostNotAllowed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allow(patterns: &[&str]) -> Vec<HostPattern> {
        patterns.iter().map(|p| HostPattern::parse(p).unwrap()).collect()
    }

    fn check(url: &str, patterns: &[&str]) -> Result<(), UrlRejection> {
        check_url(&reqwest::Url::parse(url).unwrap(), &allow(patterns))
    }

    #[test]
    fn pattern_syntax() {
        for ok in [
            "example.com", "api.example.com:8443", "example.com:*", "*.example.com", "*.example.com:8443",
            "localhost", "localhost:4567", "192.168.1.10:4567", "[::1]:8080", "[fd00::1]", "nas", "EXAMPLE.com",
        ] {
            assert!(HostPattern::parse(ok).is_ok(), "{ok}");
        }
        for bad in [
            "", "*", "*.com", "https://example.com", "example.com/path", "user@example.com", "ex*ample.com",
            "*.*.example.com", "example.com:0", "example.com:99999", "example.com:08", "*.localhost",
            "*.192.168.1.1", "::1", "[::1", "exa_mple.com", "-bad.com", "a..b",
        ] {
            assert!(HostPattern::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn exact_hosts_and_default_ports() {
        assert_eq!(check("https://api.example.com/x", &["api.example.com"]), Ok(()));
        assert_eq!(check("https://API.Example.com./x", &["api.example.com"]), Ok(()));
        assert_eq!(check("https://api.example.com:443/x", &["api.example.com"]), Ok(()));
        assert_eq!(check("https://api.example.com:8443/x", &["api.example.com"]), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://other.example.com/x", &["api.example.com"]), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://api.example.com.evil.net/", &["api.example.com"]), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://x.org/", &[]), Err(UrlRejection::HostNotAllowed));
    }

    #[test]
    fn explicit_and_any_ports() {
        assert_eq!(check("https://api.example.com:8443/", &["api.example.com:8443"]), Ok(()));
        assert_eq!(check("https://api.example.com/", &["api.example.com:8443"]), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://api.example.com:9000/", &["api.example.com:*"]), Ok(()));
        assert_eq!(check("https://api.example.com/", &["api.example.com:*"]), Ok(()));
    }

    #[test]
    fn wildcards() {
        let patterns = ["*.example.com"];
        assert_eq!(check("https://cdn.example.com/", &patterns), Ok(()));
        assert_eq!(check("https://a.b.example.com/", &patterns), Ok(()));
        assert_eq!(check("https://example.com/", &patterns), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://badexample.com/", &patterns), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://example.com.evil.net/", &patterns), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://cdn.example.com:8443/", &patterns), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("https://cdn.example.com:8443/", &["*.example.com:8443"]), Ok(()));
    }

    #[test]
    fn schemes() {
        assert_eq!(check("http://api.example.com/", &["api.example.com"]), Err(UrlRejection::InsecureScheme));
        assert_eq!(check("ftp://api.example.com/", &["api.example.com"]), Err(UrlRejection::Invalid));
        assert_eq!(check("file:///etc/passwd", &["api.example.com"]), Err(UrlRejection::Invalid));
        assert_eq!(check("https://user:pw@api.example.com/", &["api.example.com"]), Err(UrlRejection::Invalid));
    }

    #[test]
    fn localhost_and_lan_accept_http_only_when_declared() {
        assert_eq!(check("http://localhost:4567/api", &["localhost:4567"]), Ok(()));
        assert_eq!(check("http://127.0.0.1:4567/api", &["127.0.0.1:4567"]), Ok(()));
        assert_eq!(check("http://127.0.0.1:4567/api", &["localhost:4567"]), Err(UrlRejection::HostNotAllowed));
        assert_eq!(check("http://192.168.1.10:4567/", &["192.168.1.10:4567"]), Ok(()));
        assert_eq!(check("http://10.0.0.5/", &["10.0.0.5"]), Ok(()));
        assert_eq!(check("http://100.101.1.2:4567/", &["100.101.1.2:*"]), Ok(()));
        assert_eq!(check("http://nas.local:8080/", &["nas.local:8080"]), Ok(()));
        assert_eq!(check("http://nas:8080/", &["nas:8080"]), Ok(()));
        assert_eq!(check("http://[::1]:8080/", &["[::1]:8080"]), Ok(()));
        assert_eq!(check("http://[fd12::1]:8080/", &["[fd12::1]:8080"]), Ok(()));
        // Undeclared LAN host: still refused.
        assert_eq!(check("http://192.168.1.11:4567/", &["192.168.1.10:4567"]), Err(UrlRejection::HostNotAllowed));
        // Public IPs are not LAN.
        assert_eq!(check("http://8.8.8.8/", &["8.8.8.8"]), Err(UrlRejection::InsecureScheme));
        assert_eq!(check("http://172.32.0.1/", &["172.32.0.1"]), Err(UrlRejection::InsecureScheme));
        assert_eq!(check("http://172.31.0.1/", &["172.31.0.1"]), Ok(()));
    }

    #[test]
    fn local_host_classification() {
        for local in ["localhost", "app.localhost", "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "nas", "box.lan", "tv.home.arpa", "srv.internal", "pi.local"] {
            assert!(is_local_host(local), "{local}");
        }
        for public in ["example.com", "8.8.8.8", "100.128.0.1", "2001:db8::1", "localhost.example.com"] {
            assert!(!is_local_host(public), "{public}");
        }
    }

    #[test]
    fn exact_pattern_from_a_user_url() {
        let url = reqwest::Url::parse("http://192.168.1.10:4567/").unwrap();
        let pattern = HostPattern::exact_for_url(&url).unwrap();
        assert_eq!(check_url(&reqwest::Url::parse("http://192.168.1.10:4567/api/graphql").unwrap(), std::slice::from_ref(&pattern)), Ok(()));
        assert_eq!(check_url(&reqwest::Url::parse("http://192.168.1.10:4568/").unwrap(), &[pattern]), Err(UrlRejection::HostNotAllowed));
        let https = HostPattern::exact_for_url(&reqwest::Url::parse("https://manga.example.net").unwrap()).unwrap();
        assert_eq!(check_url(&reqwest::Url::parse("https://manga.example.net:443/x").unwrap(), &[https]), Ok(()));
    }
}
