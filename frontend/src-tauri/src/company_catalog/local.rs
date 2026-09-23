// Offline / no-provider fallback: every local catalog row linked to the
// company through media_by_company (what the media pages saved), for
// ComicVine publishers and for any provider without keys or connection.
use rusqlite::Connection;

use super::model::{collect_roles, merge_works, CompanyPage, CompanyProvider, CompanyWork};

pub(super) fn local_company_page(conn: &Connection, provider_id: &str, provider: &CompanyProvider) -> rusqlite::Result<Option<CompanyPage>> {
    let company_id = provider.local_company_id();
    let header: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT name, logo_url FROM companies WHERE external_id = ?1",
            [&company_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let Some((name, logo_url)) = header else { return Ok(None) };

    let mut stmt = conn.prepare(
        "SELECT mc.media_external_id, mc.role, m.type, m.title_main, m.cover_url, m.release_year, m.status,
                m.score_global, m.format
         FROM media_by_company mc
         LEFT JOIN media_catalog m ON m.external_id = mc.media_external_id
         WHERE mc.company_external_id = ?1",
    )?;
    let rows = stmt.query_map([&company_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<i32>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<f64>>(7)?,
            row.get::<_, Option<String>>(8)?,
        ))
    })?;

    let mut works = Vec::new();
    for row in rows {
        let (external_id, stored_role, media_type, title, cover_url, year, status, score, format) = row?;
        let Some(role) = provider.local_role(&stored_role) else { continue };
        let media_type = media_type
            .filter(|t| !t.is_empty())
            .unwrap_or_else(|| external_id.split(':').next().unwrap_or_default().to_string());
        merge_works(&mut works, vec![CompanyWork {
            title: title.filter(|t| !t.is_empty()).unwrap_or_else(|| external_id.clone()),
            external_id,
            cover_url,
            year,
            media_type,
            roles: vec![role.to_string()],
            is_extra: false,
            unreleased: status.as_deref() == Some("NOT_YET_RELEASED"),
            score: score.filter(|s| *s > 0.0).map(|s| s as f32),
            is_adult: false,
            format: format.filter(|f| !f.is_empty()),
        }]);
    }

    Ok(Some(CompanyPage {
        provider_id: provider_id.to_string(),
        source: "local".into(),
        name,
        logo_url,
        roles: collect_roles(&works),
        total_hint: Some(works.len() as u32),
        works,
        ..Default::default()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_the_page_from_media_by_company() {
        let db = crate::db::MetadeaDb::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute_batch(
            "INSERT INTO companies (external_id, name, logo_url) VALUES ('company:tmdb:7', 'HBO', NULL);
             INSERT INTO media_by_company (company_external_id, media_external_id, role) VALUES
               ('company:tmdb:7', 'series:1399', 'publisher'),
               ('company:tmdb:7', 'movie:5', 'developer');
             INSERT INTO media_catalog (id, external_id, type, title_main, release_year, status)
               VALUES ('x1', 'series:1399', 'series', 'Game of Thrones', 2011, 'FINISHED');",
        )
        .unwrap();
        let network = CompanyProvider::TmdbNetwork(7);
        let page = local_company_page(&conn, "tmdb-network:7", &network).unwrap().unwrap();
        assert_eq!(page.name, "HBO");
        assert_eq!(page.source, "local");
        assert_eq!(page.works.len(), 1, "the production-company row belongs to tmdb-company:7");
        assert_eq!(page.works[0].title, "Game of Thrones");
        assert_eq!(page.works[0].roles, vec!["network"]);

        let company = CompanyProvider::TmdbCompany(7);
        let page = local_company_page(&conn, "tmdb-company:7", &company).unwrap().unwrap();
        assert_eq!(page.works[0].title, "movie:5", "no catalog row: the id stands in for the title");
        assert_eq!(page.works[0].media_type, "movie");

        assert!(local_company_page(&conn, "igdb:1", &CompanyProvider::Igdb(1)).unwrap().is_none());
    }
}
