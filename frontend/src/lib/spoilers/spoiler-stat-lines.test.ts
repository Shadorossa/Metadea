import { describe, it, expect } from 'vitest';
import { classifySpoilerStatLine } from './spoiler-stat-lines';

describe('classifySpoilerStatLine', () => {
  it('finds the Status line in the languages AniList bios use', () => {
    for (const label of ['Status', 'status', 'Estado', 'Estat', 'Statut', 'Stato', 'Situación', 'Статус', '状態', 'ステータス']) {
      expect(classifySpoilerStatLine(label), label).toBe('status');
    }
  });

  it('flags fate, death, alignment, affiliation, relationships and "formerly" labels', () => {
    const labels = [
      'Fate', 'Destino', 'Death', 'Cause of Death', 'Muerte', 'Todesursache', 'Alignment', 'Alineamiento', 'Gesinnung',
      'Affiliation', 'Affiliations', 'Afiliación', 'Affiliazione', 'Zugehörigkeit', 'Relationships', 'Relatives',
      'Relaciones', 'Beziehungen', 'Formerly', 'Former Occupation', 'Previous Affiliation', 'Anteriormente',
      'Принадлежность', '所属', '死亡',
    ];
    for (const label of labels) expect(classifySpoilerStatLine(label), label).toBe('sensitive');
  });

  it('flags the labels the app itself shows in its 8 locales', () => {
    const labels = [
      'Afiliación', 'Afiliació', 'Zugehörigkeit', 'Affiliation', 'Affiliazione', '所属', 'Принадлежность',
      'Affiliates', 'Afiliados', 'Afiliats', 'Verbündete', 'Affiliés', 'Affiliati', '関係者', 'Союзники',
      'Died', 'Fallecimiento', 'Defunció', 'Gestorben', 'Décès', 'Morte', '死亡', 'Смерть',
    ];
    for (const label of labels) expect(classifySpoilerStatLine(label), label).not.toBeNull();
    for (const label of ['Status', 'Estado', 'Estat', 'Statut', 'Stato', 'ステータス', 'Статус']) {
      expect(classifySpoilerStatLine(label), label).toBe('status');
    }
  });

  it('flags values that read "deceased" or "formerly" under any label', () => {
    expect(classifySpoilerStatLine('Occupation', ['Jujutsu Sorcerer (formerly)'])).toBe('sensitive');
    expect(classifySpoilerStatLine('Occupation', ['Student', '<b>Deceased</b>'])).toBe('sensitive');
    expect(classifySpoilerStatLine('Ocupación', ['Hechicero (fallecido)'])).toBe('sensitive');
    expect(classifySpoilerStatLine('Beruf', ['Verstorben'])).toBe('sensitive');
    expect(classifySpoilerStatLine('職業', ['元呪術師'])).toBe('sensitive');
  });

  it('leaves harmless lines alone', () => {
    for (const [label, values] of [
      ['Height', ['186 cm']],
      ['Hair Color', ['Pink']],
      ['Occupation', ['Student']],
      ['Antecedentes', ['Nació en Sendai']],
      ['Cursed Technique', ['Shrine']],
      ['Estatura', ['1,73 m']],
      ['Total', ['12']],
    ] as const) {
      expect(classifySpoilerStatLine(label, values), label).toBeNull();
    }
  });
});
