import { Fragment } from 'react';
import type { Translations } from '../../../i18n/index';
import type { MediaPageData } from '../../../lib/media/types';
import { formatRatingHtml, formatAverageScore, averageScoreSuffix, type RatingSystem } from '../../../lib/media/rating-utils';
import { parseStatSectionLabel, StatSectionTracker } from '../../../lib/media/stat-sections';
import { mergePlatformVersions } from '../../../lib/media/mappers/mapper-utils';
import { openLink } from '../MediaStoreLinks';
import { MediaSourceLink } from '../MediaSourceLink';

interface Props {
  data: MediaPageData;
  t: Translations['media'];
  ratingSystem: RatingSystem;
}

// Datos — always rendered, even with no stats/authors, since the
// link to the source page (MediaSourceLink) can always be built
// from data.source/sourceUrl regardless of whether anything else
// here has data.
export function MediaStatsColumn({ data, t: tm, ratingSystem }: Props) {
  return (
          <div className="media-col-stats">
                <div className="media-section-header-row">
                  <p className="section-label">{tm.section_data}</p>
                  <div className="media-section-header-line" />
                  <MediaSourceLink source={data.source} sourceUrl={data.sourceUrl} />
                </div>

                {data.authors && data.authors.length > 0 && (
                  <div className="media-authors-box">
                    <div className="media-authors-list">
                      {data.authors.map((auth, idx) => (
                        <div key={idx} className="media-author-pill">
                          {auth.image ? (
                            <img src={auth.image} alt={auth.name} className="media-author-avatar" />
                          ) : (
                            <div className="media-author-avatar media-author-avatar--placeholder">
                              {auth.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="media-author-info">
                            {auth.url ? (
                              <span
                                className="media-author-name media-author-name--link"
                                onClick={() => (auth.url!.startsWith('http') ? openLink(auth.url!) : (window.location.href = auth.url!))}
                              >
                                {auth.name}
                              </span>
                            ) : (
                              <span className="media-author-name">{auth.name}</span>
                            )}
                            {auth.role && <span className="media-author-role">{auth.role}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="media-stats-list">
                  {(() => {
                    const sectionTracker = new StatSectionTracker();
                    const filtered = data.stats.filter(s => {
                      if (!data.authors || data.authors.length === 0) return true;
                      const labelLower = s.label.toLowerCase();
                      const isAuthorStat = labelLower.includes('autor') ||
                        labelLower.includes('author') ||
                        labelLower.includes('creator') ||
                        labelLower.includes('story') ||
                        labelLower.includes('director');
                      return !isAuthorStat;
                    });

                    return filtered.map((s, i) => {
                      const { section, cleanLabel } = parseStatSectionLabel(s.label);
                      const sectionHeader = sectionTracker.next(section);

                      return (
                        <Fragment key={i}>
                          {sectionHeader && (
                            <div className="media-stat-section-header">{sectionHeader}</div>
                          )}
                          {s.isScore ? (
                            <div className="media-stat-item media-stat-item--score">
                              <span
                                title={`${formatAverageScore(Number(s.value), ratingSystem)}${averageScoreSuffix(ratingSystem)}`}
                                dangerouslySetInnerHTML={{ __html: formatRatingHtml(Number(s.value), ratingSystem, 'media-stat-score-value') }}
                              />
                            </div>
                          ) : s.label2 ? (
                            <div className="media-stat-item media-stat-item--split">
                              <span className="media-stat-col">
                                <span className="media-stat-label">{cleanLabel}</span>
                                <span className="media-stat-value">{s.value}</span>
                              </span>
                              <span className="media-stat-divider" />
                              <span className="media-stat-col">
                                <span className="media-stat-label">{s.label2}</span>
                                <span className="media-stat-value">{s.value2}</span>
                              </span>
                            </div>
                          ) : (
                            <div className="media-stat-item">
                              <span className="media-stat-label">{cleanLabel}</span>
                              <span className="media-stat-value">{s.value}</span>
                            </div>
                          )}
                        </Fragment>
                      );
                    });
                  })()}

                  {data.type === 'game' && data.platforms && data.platforms.length > 0 && (
                    <div className="media-stat-item media-stat-item--platforms">
                      <span className="media-stat-label">{tm.stat_platforms}</span>
                      <span className="media-stat-divider" />
                      <span className="media-stat-value media-stat-platforms-value">
                        {mergePlatformVersions(data.platforms).map((p, i) => (
                          <span key={i}>{p}</span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
          </div>
  );
}
