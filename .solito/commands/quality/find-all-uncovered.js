const d = require('../../../coverage/coverage-summary.json');
const entries = Object.entries(d)
  .filter(([k]) => k !== 'total' && k.includes('src'))
  .map(([k, v]) => {
    const uncov = v.lines.total - v.lines.covered;
    const file = k.replace(/.*[/\\]src[/\\]/, 'src/');
    return { file, pct: v.lines.pct, uncov, total: v.lines.total };
  })
  .filter(e => e.uncov > 5)
  .sort((a, b) => b.uncov - a.uncov);

entries.slice(0, 25).forEach(e =>
  console.log(`${e.pct.toFixed(1)}%  ${e.uncov} uncov  ${e.total} total  ${e.file}`)
);
