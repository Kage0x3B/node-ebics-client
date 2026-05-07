#!/usr/bin/env node
// Compare prettier-normalized JS in .verify/baseline/ to dist/cjs/.
// Writes per-file diffs to .verify/diffs/ for manual or agent-assisted review.
//
// Usage:  node scripts/verify-diff.mjs
//
// This is a "did the migration accidentally change logic?" check. The goal is
// not byte-equivalence — TS-emitted CJS will never match hand-written CJS
// exactly — but to surface unexpected differences for review.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const baseline = join(root, '.verify/baseline');
const built = join(root, 'dist/cjs');
const baselineNormalized = join(root, '.verify/baseline-normalized');
const builtNormalized = join(root, '.verify/built-normalized');
const diffsDir = join(root, '.verify/diffs');

if (!existsSync(baseline)) {
	console.error(`No baseline found at ${baseline}. Run snapshot first (see plan Phase 1).`);
	process.exit(1);
}
if (!existsSync(built)) {
	console.error(`No build output at ${built}. Run \`pnpm build\` first.`);
	process.exit(1);
}

// 1. Wipe + recreate output dirs.
for (const d of [baselineNormalized, builtNormalized, diffsDir]) {
	rmSync(d, { recursive: true, force: true });
	mkdirSync(d, { recursive: true });
}

// 2. Copy baseline + built into normalized dirs, then prettier-normalize each.
const copyTree = (src, dst, ext) => {
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const s = join(src, entry.name);
		const d = join(dst, entry.name);
		if (entry.isDirectory()) {
			mkdirSync(d, { recursive: true });
			copyTree(s, d, ext);
		} else if (entry.name.endsWith(ext)) {
			writeFileSync(d, readFileSync(s));
		}
	}
};

copyTree(baseline, baselineNormalized, '.js');
copyTree(built, builtNormalized, '.cjs');

// 3. Apply a single prettier config to both trees.
const prettierConfig = {
	useTabs: false,
	tabWidth: 2,
	singleQuote: true,
	semi: true,
	trailingComma: 'all',
	printWidth: 100,
	arrowParens: 'always',
};
const prettierConfigPath = join(root, '.verify/prettierrc.verify.json');
writeFileSync(prettierConfigPath, JSON.stringify(prettierConfig, null, 2));

const prettier = (dir) => {
	execSync(
		`pnpm exec prettier --no-editorconfig --config ${JSON.stringify(prettierConfigPath)} --write '${dir}/**/*.{js,cjs}' --log-level warn`,
		{ stdio: 'inherit' },
	);
};
prettier(baselineNormalized);
prettier(builtNormalized);

// 4. Walk both trees, build a path-set, diff each pair.
const collect = (dir) => {
	const out = [];
	const walk = (d) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (/\.(js|cjs)$/.test(entry.name)) out.push(relative(dir, p));
		}
	};
	walk(dir);
	return out;
};

// Map baseline .js paths to expected built .cjs paths.
// baseline: lib/Client.js -> built: lib/Client.cjs (under dist/cjs/)
const baselineFiles = collect(baselineNormalized);
const summary = [];

for (const rel of baselineFiles) {
	const built = rel.replace(/\.js$/, '.cjs');
	const oldPath = join(baselineNormalized, rel);
	const newPath = join(builtNormalized, built);
	if (!existsSync(newPath)) {
		summary.push({ rel, status: 'missing-in-build', lines: 0 });
		continue;
	}
	const diff = spawnSync(
		'git',
		['diff', '--no-index', '--no-color', '--', oldPath, newPath],
		{ encoding: 'utf8' },
	);
	const out = diff.stdout || '';
	if (out.length === 0) {
		summary.push({ rel, status: 'identical', lines: 0 });
		continue;
	}
	const linesChanged = out.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-]{3} /.test(l)).length;
	const diffPath = join(diffsDir, `${rel}.diff`);
	mkdirSync(dirname(diffPath), { recursive: true });
	writeFileSync(diffPath, out);
	summary.push({ rel, status: 'differs', lines: linesChanged });
}

// 5. Print summary.
const trivialLineThreshold = 3;
const report = summary
	.sort((a, b) => b.lines - a.lines)
	.map((s) => {
		const flag = s.status === 'identical'
			? 'OK     '
			: s.status === 'missing-in-build'
				? 'MISSING'
				: s.lines <= trivialLineThreshold
					? 'TRIVIAL'
					: 'DIFFERS';
		return `${flag}  ${String(s.lines).padStart(5)}  ${s.rel}`;
	})
	.join('\n');

console.log('\nVerify-diff report:\n');
console.log(report);
console.log(`\nFull diffs in: ${diffsDir}/`);

const nonTrivial = summary.filter((s) => s.status === 'differs' && s.lines > trivialLineThreshold);
console.log(`\n${nonTrivial.length} files have non-trivial differences. Review these:`);
for (const s of nonTrivial) console.log(`  ${s.rel}  (${s.lines} lines changed)`);
