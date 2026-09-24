// Sakugabooru posts: the `post.xml` listing (the XML form carries the total
// match count, which `post.json` lacks — that is what tells the UI how many
// clips an animator has and when paging has reached the end), the query we
// send, and the content-rating filter.
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use serde::Serialize;

pub(crate) const MAX_LIMIT: u32 = 100;
pub(crate) const MAX_PAGE: u32 = 1000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SakugaPost {
    pub id: i64,
    /// Space-separated tag names.
    pub tags: String,
    /// Community upvotes.
    pub score: i64,
    /// Content rating: s (safe), q (questionable), e (explicit).
    pub rating: String,
    /// Free text, e.g. "#06 (BD) (Action AD: Toru Iwazawa)".
    pub source: String,
    pub file_url: String,
    pub file_ext: String,
    pub preview_url: String,
    pub width: i64,
    pub height: i64,
    pub file_size: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SakugaPostPage {
    pub posts: Vec<SakugaPost>,
    /// Every post matching the query (all pages), as Sakugabooru counts it.
    pub total: i64,
    pub page: u32,
    pub limit: u32,
    /// Posts the page held before the rating filter: fewer than `limit`
    /// means this was the last page.
    pub raw_count: u32,
}

/// The `tags` query value: the caller's tags, the rating restriction unless
/// adult content is on, and vote order last.
pub(crate) fn build_query_tags(tags: &[String], include_adult: bool) -> String {
    let mut parts: Vec<&str> = tags.iter().map(String::as_str).collect();
    if !include_adult {
        parts.push("rating:s");
    }
    parts.push("order:score");
    parts.join(" ")
}

/// Keeps only safe-rated posts unless adult content is on. The query already
/// asks for `rating:s`; this is the belt to that pair of braces.
pub(crate) fn filter_rating(posts: Vec<SakugaPost>, include_adult: bool) -> Vec<SakugaPost> {
    if include_adult {
        return posts;
    }
    posts.into_iter().filter(|post| post.rating == "s").collect()
}

fn attrs(start: &BytesStart<'_>) -> Vec<(String, String)> {
    start
        .attributes()
        .flatten()
        .map(|attr| {
            let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
            let value = attr
                .unescape_value()
                .map(|v| v.into_owned())
                .unwrap_or_else(|_| String::from_utf8_lossy(&attr.value).into_owned());
            (key, value)
        })
        .collect()
}

fn get<'a>(attrs: &'a [(String, String)], key: &str) -> &'a str {
    attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()).unwrap_or("")
}

fn get_i64(attrs: &[(String, String)], key: &str) -> i64 {
    get(attrs, key).trim().parse().unwrap_or(0)
}

fn is_https_url(url: &str) -> bool {
    url.starts_with("https://")
}

fn post_from(attrs: &[(String, String)]) -> Option<SakugaPost> {
    let id = get_i64(attrs, "id");
    let file_url = get(attrs, "file_url");
    if id <= 0 || !is_https_url(file_url) {
        return None;
    }
    let preview_url = get(attrs, "preview_url");
    Some(SakugaPost {
        id,
        tags: get(attrs, "tags").trim().to_string(),
        score: get_i64(attrs, "score"),
        rating: get(attrs, "rating").to_string(),
        source: get(attrs, "source").trim().to_string(),
        file_url: file_url.to_string(),
        file_ext: get(attrs, "file_ext").to_ascii_lowercase(),
        preview_url: if is_https_url(preview_url) { preview_url.to_string() } else { String::new() },
        width: get_i64(attrs, "width"),
        height: get_i64(attrs, "height"),
        file_size: get_i64(attrs, "file_size"),
        created_at: get_i64(attrs, "created_at"),
    })
}

/// `(total, posts)` from a `post.xml` body; `None` when the body isn't that
/// document at all (an error page, a changed API).
pub(crate) fn parse_post_xml(xml: &str) -> Option<(i64, Vec<SakugaPost>)> {
    let mut reader = Reader::from_str(xml);
    let mut total: Option<i64> = None;
    let mut posts = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start)) => match start.name().as_ref() {
                b"posts" => total = Some(get_i64(&attrs(&start), "count")),
                b"post" => {
                    if let Some(post) = post_from(&attrs(&start)) {
                        posts.push(post);
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
    }
    total.map(|total| (total, posts))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r##"<?xml version="1.0" encoding="UTF-8"?>
<posts count="368" offset="0">
  <post id="165486" tags="animated effects kekkai_sensen yutaka_nakamura" created_at="1632050154" source="#01 (BD)" score="5891" file_size="30230691" file_ext="mp4" file_url="https://www.sakugabooru.com/data/eacf.mp4" preview_url="https://www.sakugabooru.com/data/preview/eacf.jpg" rating="s" width="852" height="480"/>
  <post id="281209" tags="animated my_hero_academia yutaka_nakamura" created_at="1745587884" source="#023 (S2 #10) (BD) &amp; more" score="4840" file_size="22419156" file_ext="MP4" file_url="https://www.sakugabooru.com/data/e82.mp4" preview_url="https://www.sakugabooru.com/data/preview/e82.jpg" rating="q" width="854" height="480"/>
  <post id="3" tags="x" file_url="javascript:alert(1)" rating="s"/>
</posts>"##;

    #[test]
    fn parses_the_total_and_each_post() {
        let (total, posts) = parse_post_xml(SAMPLE).unwrap();
        assert_eq!(total, 368);
        assert_eq!(posts.len(), 2, "a post without an https file is dropped");
        assert_eq!(posts[0].id, 165486);
        assert_eq!(posts[0].score, 5891);
        assert_eq!(posts[0].source, "#01 (BD)");
        assert_eq!(posts[0].preview_url, "https://www.sakugabooru.com/data/preview/eacf.jpg");
        assert_eq!(posts[1].source, "#023 (S2 #10) (BD) & more");
        assert_eq!(posts[1].file_ext, "mp4");
    }

    #[test]
    fn an_empty_listing_is_zero_not_a_failure() {
        let (total, posts) = parse_post_xml(r#"<?xml version="1.0"?><posts count="0" offset="0"></posts>"#).unwrap();
        assert_eq!((total, posts.len()), (0, 0));
        assert!(parse_post_xml("<html><body>Rate limited</body></html>").is_none());
    }

    #[test]
    fn rating_filter_keeps_safe_posts_unless_adult_is_on() {
        let (_, posts) = parse_post_xml(SAMPLE).unwrap();
        let safe = filter_rating(posts.clone(), false);
        assert_eq!(safe.iter().map(|p| p.id).collect::<Vec<_>>(), vec![165486]);
        assert_eq!(filter_rating(posts, true).len(), 2);
    }

    #[test]
    fn query_asks_for_safe_posts_by_votes() {
        let tags = vec!["yutaka_nakamura".to_string(), "sousou_no_frieren_series".into()];
        assert_eq!(build_query_tags(&tags, false), "yutaka_nakamura sousou_no_frieren_series rating:s order:score");
        assert_eq!(build_query_tags(&tags, true), "yutaka_nakamura sousou_no_frieren_series order:score");
    }
}
