import { describe, it, expect } from 'vitest';
import { HELP_TOPICS, HELP_TOPIC_IDS, buildCapabilityMap, lookupHelp } from '../../backend/src/services/systemKnowledge';

describe('systemKnowledge — capability map', () => {
  it('derives one line per topic straight from HELP_TOPICS (never drifts)', () => {
    const map = buildCapabilityMap();
    const lines = map.split('\n');
    expect(lines).toHaveLength(HELP_TOPICS.length);
    for (const t of HELP_TOPICS) {
      expect(map).toContain(`• ${t.title}: ${t.summary}`);
    }
  });

  it('keeps the HELP_TOPIC_IDS enum (used by the tool schema) in sync with HELP_TOPICS', () => {
    // Same set AND same order — the tool enum must offer exactly the real topics.
    expect([...HELP_TOPIC_IDS]).toEqual(HELP_TOPICS.map((t) => t.id));
  });

  it('every enum id resolves to a real topic via lookupHelp', () => {
    for (const id of HELP_TOPIC_IDS) {
      const topic = HELP_TOPICS.find((t) => t.id === id)!;
      expect(lookupHelp(id)).toContain(`## ${topic.title}`);
    }
  });

  it('has unique topic ids and non-empty content', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.summary.length).toBeGreaterThan(0);
      expect(t.detail.length).toBeGreaterThan(40);
      expect(t.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe('systemKnowledge — lookupHelp', () => {
  it('returns a topic by exact id', () => {
    const out = lookupHelp('long-video');
    expect(out).toContain('## Long videos');
    expect(out).toContain('concat');
    expect(out).toContain('chain');
  });

  it('ranks by free-text query when no id is given', () => {
    const out = lookupHelp(undefined, 'how do I make a longer 2 minute video');
    expect(out).toContain('Long videos');
  });

  it('finds continue/extend intent', () => {
    const out = lookupHelp(undefined, 'extend my existing clip with a next part');
    expect(out).toContain('Continue');
  });

  it('returns the topic index on empty input', () => {
    const out = lookupHelp();
    for (const t of HELP_TOPICS) expect(out).toContain(t.id);
  });

  it('falls back to the index (not a fabricated answer) on a no-match query', () => {
    const out = lookupHelp(undefined, 'zzxqworblenope');
    expect(out).toContain('No help topic matched');
    for (const t of HELP_TOPICS) expect(out).toContain(t.id);
  });
});

describe('systemKnowledge — guardrail: no internal / super-admin surfaces', () => {
  it('never documents internal-only capabilities', () => {
    const corpus = (
      buildCapabilityMap() +
      '\n' +
      HELP_TOPICS.map((t) => `${t.title} ${t.summary} ${t.detail} ${t.keywords.join(' ')}`).join('\n')
    ).toLowerCase();

    // These strings would only appear if internal/admin surfaces leaked into the KB.
    const forbidden = [
      'super admin',
      'super-admin',
      'superadmin',
      'impersonat',
      'migration',
      'migrate',
      'mock replicate',
      'stitch test',
      'wrangler',
      'clerk',
      'durable object',
      'r2 mount',
    ];
    for (const term of forbidden) {
      expect(corpus, `KB must not mention "${term}"`).not.toContain(term);
    }
  });
});
