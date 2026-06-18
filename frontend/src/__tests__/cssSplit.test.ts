import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

it('moves body styling to standalone.css and keeps :root vars in styles.css', () => {
  const styles = read('../styles.css');
  const standalone = read('../standalone.css');
  expect(styles).not.toMatch(/^\s*body\s*\{/m);   // body rule no longer in the scoped sheet
  expect(styles).toMatch(/:root\s*\{/);            // CSS vars stay
  expect(standalone).toMatch(/body\s*\{/);         // full-viewport lives standalone-only
});
