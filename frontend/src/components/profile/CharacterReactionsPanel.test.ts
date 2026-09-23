// Read-only (someone else's profile) vs own-profile rendering of the
// character reactions view: same track and cards, no edit controls.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import type { CharacterReactionGroups } from '../../lib/character/character-reactions';
import { CharacterReactionsPanel, ReactionCharacterCard } from './CharacterReactionsPanel';

const reactions: CharacterReactionGroups = {
  like: [
    { external_id: 'character:a:1', name: 'Luffy', image_url: 'https://img/luffy.jpg' },
    { external_id: 'character:a:2', name: null, image_url: null },
  ],
  interest: [],
  dislike: [{ external_id: 'character:a:3', name: 'Kaido', image_url: null }],
};

const classes = (html: string) => Array.from(html.matchAll(/\bclass="([^"]*)"/g)).flatMap(m => m[1].split(/\s+/));

describe('CharacterReactionsPanel', () => {
  it('shows the three reactions joined by lines, with their counts', () => {
    const html = renderToStaticMarkup(createElement(CharacterReactionsPanel, { reactions, readOnly: true }));
    expect(classes(html).filter(c => c === 'char-reactions-node')).toHaveLength(3);
    expect(classes(html).filter(c => c === 'char-reactions-line')).toHaveLength(2);
    const counts = Array.from(html.matchAll(/class="char-reactions-count">(\d+)</g)).map(m => m[1]);
    expect(counts).toEqual(['2', '0', '1']);
    expect(html).toContain(en.character.action_interested);
  });

  it('renders the same track on the owner profile', () => {
    const own = renderToStaticMarkup(createElement(CharacterReactionsPanel, { reactions }));
    const theirs = renderToStaticMarkup(createElement(CharacterReactionsPanel, { reactions, readOnly: true }));
    expect(own).toBe(theirs);
  });
});

describe('ReactionCharacterCard', () => {
  const [luffy, unnamed] = reactions.like;

  it('read-only: portrait, name and link, no remove/move buttons', () => {
    const html = renderToStaticMarkup(createElement(ReactionCharacterCard, { item: luffy, reaction: 'like', readOnly: true, onSet: () => {} }));
    expect(html).toContain('href="/character?id=a%3A1"');
    expect(html).toContain('https://img/luffy.jpg');
    expect(html).toContain('Luffy');
    expect(html).not.toContain('<button');
  });

  it('own profile: remove plus a move to each other reaction', () => {
    const html = renderToStaticMarkup(createElement(ReactionCharacterCard, { item: luffy, reaction: 'like', readOnly: false, onSet: () => {} }));
    expect(classes(html).filter(c => c === 'fav-remove-btn')).toHaveLength(1);
    expect(classes(html).filter(c => c === 'char-reaction-move-btn')).toHaveLength(2);
    expect(html).toContain(en.profile.reactions_move_to.replace('{reaction}', en.character.action_interested));
    expect(html).toContain(en.profile.reactions_move_to.replace('{reaction}', en.character.action_dislike));
  });

  it('falls back to the id and initials without a synced name or portrait', () => {
    const html = renderToStaticMarkup(createElement(ReactionCharacterCard, { item: unnamed, reaction: 'like', readOnly: true }));
    expect(html).toContain('fav-no-cover');
    expect(html).toContain('character:a:2');
  });
});
