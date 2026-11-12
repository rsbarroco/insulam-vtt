import { allRules, findRule, type RuleSection } from '../rulesText';

const text = (section: RuleSection | undefined) =>
  (section?.blocks ?? []).map((block) => (block.type === 'paragraph' ? block.text : '')).join(' ');

describe('the rules of play', () => {
  it('holds both chapters, every heading once', () => {
    const sections = allRules();
    expect(new Set(sections.map((section) => section.chapter))).toEqual(
      new Set(['Playing the Game', 'Rules Glossary'])
    );
    expect(
      sections.filter((section) => section.chapter === 'Rules Glossary' && section.level === 4)
    ).toHaveLength(155);
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
  });

  it('says where a heading sits', () => {
    expect(findRule('playing-the-game-cover')?.path).toEqual([
      'Playing the Game',
      'Combat',
      'Cover',
    ]);
    expect(findRule('rules-glossary-dodge-action')?.path).toEqual([
      'Rules Glossary',
      'Rules Definitions',
      'Dodge [Action]',
    ]);
  });

  it('keeps the document’s words', () => {
    expect(text(findRule('rules-glossary-opportunity-attacks'))).toMatch(
      /^You can make an Opportunity Attack when a creature that you can see leaves your reach/
    );
    expect(text(findRule('rules-glossary-falling-hazard'))).toContain(
      '1d6 Bludgeoning damage at the end of the fall for every 10 feet it fell, to a maximum of 20d6'
    );
    expect(text(findRule('rules-glossary-high-jump'))).toContain('plus 1½ times your height');
  });

  it('puts a word broken across two lines back together', () => {
    expect(text(findRule('playing-the-game-rhythm-of-play'))).toContain(
      '3: The GM Narrates the Results of the Adventurers’ Actions.'
    );
    for (const section of allRules())
      expect(text(section)).not.toMatch(/[a-z]{3}- (?!and |or )[a-z]/);
  });

  it('reads the tables under their columns', () => {
    const actions = findRule('playing-the-game-actions')?.blocks.find(
      (block) => block.type === 'table'
    );
    expect(actions).toMatchObject({ title: 'Actions', head: [['Action', 'Summary']] });
    expect(actions?.type === 'table' && actions.rows.map((row) => row[0])).toEqual([
      'Attack',
      'Dash',
      'Disengage',
      'Dodge',
      'Help',
      'Hide',
      'Influence',
      'Magic',
      'Ready',
      'Search',
      'Study',
      'Utilize',
    ]);
    const cover = findRule('playing-the-game-cover')?.blocks.find(
      (block) => block.type === 'table'
    );
    expect(cover?.type === 'table' && cover.rows[0]).toEqual([
      'Half',
      '+2 bonus to AC and Dexterity saving throws',
      'Another creature or an object that covers at least half of the target',
    ]);
  });

  it('keeps a sidebar apart from the text it interrupts', () => {
    const blocks = findRule('playing-the-game-advantage-disadvantage')?.blocks ?? [];
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      text: expect.stringMatching(/special abilities and actions\. The GM can also decide/),
    });
    expect(blocks[2]).toMatchObject({ type: 'sidebar', title: 'Heroic Inspiration' });
  });
});
