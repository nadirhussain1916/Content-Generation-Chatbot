import { describe, it, expect } from 'vitest';
import { brandBlock } from '../../backend/src/services/prompts';

describe('brandBlock', () => {
  it('returns empty string when no workspace fields are set', () => {
    expect(brandBlock({})).toBe('');
  });

  it('includes brand name when provided', () => {
    const result = brandBlock({ brand_name: 'Acme Co' });
    expect(result).toContain('Brand name: Acme Co');
  });

  it('includes brand description', () => {
    const result = brandBlock({ brand_description: 'A cool brand' });
    expect(result).toContain('Brand description: A cool brand');
  });

  it('includes target audience', () => {
    const result = brandBlock({ target_audience: 'Gen Z creators' });
    expect(result).toContain('Target audience: Gen Z creators');
  });

  it('includes custom agent instructions', () => {
    const result = brandBlock({ agent_instructions: 'Always use emojis.' });
    expect(result).toContain('Always use emojis.');
  });

  it('wraps output in WORKSPACE CONTEXT delimiters', () => {
    const result = brandBlock({ brand_name: 'Test' });
    expect(result).toContain('--- WORKSPACE CONTEXT ---');
  });

  it('includes default image size with label and instruction', () => {
    const result = brandBlock({ default_image_size: '1024x1024' });
    expect(result).toContain('Default image size:');
    expect(result).toContain('ALWAYS set imageSize to this value');
  });

  it('includes default video dimensions', () => {
    const result = brandBlock({ default_video_dimensions: '1280x720' });
    expect(result).toContain('Default video dimensions:');
    expect(result).toContain('1280x720');
  });

  it('calculates word count range from target_video_length', () => {
    // 30s × 2.4 = 72 words, ±10% → 65–79
    const result = brandBlock({ target_video_length: 30 });
    expect(result).toContain('Target video length: 30s');
    expect(result).toContain('65');
    expect(result).toContain('79');
  });

  it('injects LOCKED CHARACTER block when character fields are present', () => {
    const result = brandBlock({
      character_name: 'Maya',
      character_appearance: 'Tall, red hair, blue jacket',
    });
    expect(result).toContain('LOCKED CHARACTER');
    expect(result).toContain('Name: Maya');
    expect(result).toContain('Appearance: Tall, red hair, blue jacket');
    expect(result).toContain('verbatim');
  });

  it('omits character block when neither name nor appearance is set', () => {
    const result = brandBlock({ brand_name: 'Acme' });
    expect(result).not.toContain('LOCKED CHARACTER');
  });

  it('handles null values gracefully (same as omitted)', () => {
    const result = brandBlock({
      brand_name: null,
      brand_description: null,
      character_name: null,
    });
    expect(result).toBe('');
  });

  it('full workspace populates all sections', () => {
    const result = brandBlock({
      brand_name: 'Acme',
      brand_description: 'We make things',
      brand_voice: 'Friendly',
      target_audience: 'Millennials',
      default_image_size: '1792x1024',
      default_video_dimensions: '1280x720',
      default_video_duration: 10,
      target_video_length: 60,
      character_name: 'Bob',
      character_appearance: 'Short, brown hair',
      agent_instructions: 'Be concise.',
    });
    expect(result).toContain('Acme');
    expect(result).toContain('We make things');
    expect(result).toContain('Friendly');
    expect(result).toContain('Millennials');
    expect(result).toContain('LOCKED CHARACTER');
    expect(result).toContain('Be concise.');
  });
});
