// The media page's "Sakuga" tab: a "Top of the series" row, then one row
// per animator credited in a key animation role, each a strip of every clip
// they have in this series, most voted first. Rows resolve and load only as
// they scroll into view, two at a time; loaded rows sort by their best clip.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SakugaTag } from '../../lib/tauri/sakuga';
import { resolveSakugaArtist } from '../../lib/tauri/sakuga';
import { isSakugaStaffRole, orderSakugaRows, sakugaTagUrl, type SakugaRowOrderInput } from '../../lib/sakuga/sakuga-paging';
import { createTaskGate, type TaskGate } from '../../lib/sakuga/sakuga-gate';
import { interpolate } from '../../lib/shared/text/interpolate';
import { openLink } from '../media/MediaStoreLinks';
import type { SakugaStrings } from './SakugaClipCard';
import { SakugaClipList, SakugaClipSkeleton } from './SakugaClipList';
import { useSakugaPager } from './hooks/useSakugaPager';
import { useInView } from './hooks/useInView';

export interface SakugaStaffMember {
  id?: string | null;
  name: string;
  role?: string | null;
}

interface Props {
  seriesTag: SakugaTag;
  staff: readonly SakugaStaffMember[];
  t: SakugaStrings;
}

type RowStatus = Pick<SakugaRowOrderInput, 'status' | 'bestScore'>;

function clipCount(t: SakugaStrings, n: number): string {
  return interpolate(n === 1 ? t.clip_count_one : t.clip_count_other, { n });
}

function SakugaAttribution({ t, tag }: { t: SakugaStrings; tag: string }) {
  const url = sakugaTagUrl(tag);
  return (
    <p className="sakuga-attribution">
      <a href={url} onClick={event => { event.preventDefault(); openLink(url); }}>{t.attribution}</a>
    </p>
  );
}

function SeriesTopRow({ seriesTag, t }: { seriesTag: SakugaTag; t: SakugaStrings }) {
  const tags = useMemo(() => [seriesTag.name], [seriesTag.name]);
  const pager = useSakugaPager(tags);
  const total = pager.state.total;
  if (pager.state.done && pager.state.posts.length === 0) return null;
  return (
    <section className="sakuga-row">
      <header className="sakuga-row__header">
        <span className="sakuga-row__name">{t.top_of_series}</span>
        {total !== null && <span className="sakuga-row__count">{clipCount(t, total)}</span>}
      </header>
      <SakugaClipList pager={pager} t={t} layout="strip" />
    </section>
  );
}

interface ArtistRowProps {
  member: SakugaStaffMember & { id: string };
  seriesTag: string;
  gate: TaskGate;
  t: SakugaStrings;
  onStatus: (id: string, status: RowStatus) => void;
}

function ArtistRow({ member, seriesTag, gate, t, onStatus }: ArtistRowProps) {
  const ref = useRef<HTMLElement | null>(null);
  const visible = useInView(ref, { rootMargin: '150px' });
  const [artistTag, setArtistTag] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!visible || resolved) return;
    let cancelled = false;
    void gate.run(() => resolveSakugaArtist(member.id, [member.name])).then(tag => {
      if (cancelled) return;
      setArtistTag(tag?.name ?? null);
      setResolved(true);
    });
    return () => { cancelled = true; };
  }, [visible, resolved, gate, member.id, member.name]);

  const tags = useMemo(() => (artistTag ? [artistTag, seriesTag] : null), [artistTag, seriesTag]);
  const pager = useSakugaPager(tags);
  const { posts, total, done } = pager.state;

  useEffect(() => {
    if (resolved && !artistTag) onStatus(member.id, { status: 'empty', bestScore: null });
    else if (total !== null) {
      onStatus(member.id, posts.length > 0
        ? { status: 'ready', bestScore: posts[0].score }
        : { status: done ? 'empty' : 'pending', bestScore: null });
    }
  }, [resolved, artistTag, total, posts, done, member.id, onStatus]);

  const role = member.role?.replace(/\s*\(.*\)\s*$/, '');
  return (
    <section ref={ref} className={`sakuga-row${posts.length === 0 ? ' sakuga-row--pending' : ''}`}>
      <header className="sakuga-row__header">
        <a className="sakuga-row__name" href={`/author?id=${encodeURIComponent(member.id)}`}>{member.name}</a>
        {role && <span className="sakuga-row__role">{role}</span>}
        {total !== null && total > 0 && <span className="sakuga-row__count">{clipCount(t, total)}</span>}
      </header>
      {posts.length > 0
        ? <SakugaClipList pager={pager} t={t} layout="strip" />
        : (
          <div className="sakuga-list sakuga-list--strip" aria-hidden="true">
            {Array.from({ length: 4 }, (_, i) => <SakugaClipSkeleton key={i} />)}
          </div>
        )}
    </section>
  );
}

export function SakugaMediaTab({ seriesTag, staff, t }: Props) {
  const gate = useMemo(() => createTaskGate(2), []);
  const members = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<SakugaStaffMember & { id: string }> = [];
    for (const member of staff) {
      if (!member.id || !isSakugaStaffRole(member.role) || seen.has(member.id)) continue;
      seen.add(member.id);
      out.push({ ...member, id: member.id });
    }
    return out;
  }, [staff]);
  const [statuses, setStatuses] = useState<Record<string, RowStatus>>({});
  const onStatus = useCallback((id: string, status: RowStatus) => {
    setStatuses(previous => {
      const current = previous[id];
      if (current && current.status === status.status && current.bestScore === status.bestScore) return previous;
      return { ...previous, [id]: status };
    });
  }, []);

  const ordered = orderSakugaRows(members.map((member, order) => ({
    member,
    order,
    status: statuses[member.id]?.status ?? 'pending',
    bestScore: statuses[member.id]?.bestScore ?? null,
  })));

  return (
    <div className="sakuga-tab">
      <SeriesTopRow seriesTag={seriesTag} t={t} />
      {ordered.map(({ member }) => (
        <ArtistRow key={member.id} member={member} seriesTag={seriesTag.name} gate={gate} t={t} onStatus={onStatus} />
      ))}
      <SakugaAttribution t={t} tag={seriesTag.name} />
    </div>
  );
}
