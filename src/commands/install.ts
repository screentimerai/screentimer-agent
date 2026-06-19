import fs from 'fs';
import os from 'os';
import path from 'path';

// Locate the bundled SKILL.md. At runtime this file is dist/index.js, so the
// package root (which ships SKILL.md via package.json "files") is one level up.
function findSkillSource(): string {
  const candidates = [
    path.join(__dirname, '..', 'SKILL.md'), // dist/index.js -> ../SKILL.md
    path.join(__dirname, '..', '..', 'SKILL.md'), // fallback if nested deeper
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Could not locate bundled SKILL.md (looked in: ${candidates.join(', ')})`
  );
}

/**
 * Install the screentimer-agent skill as a Claude Code personal skill by
 * copying the bundled SKILL.md into ~/.claude/skills/screentimer-agent/.
 * Designed to be run via `npx -y screentimer-agent install`.
 */
export function installCommand(args: any) {
  const skillName = 'screentimer-agent';
  const src = findSkillSource();

  const baseDir = args.dir
    ? path.resolve(args.dir)
    : path.join(os.homedir(), '.claude', 'skills');
  const destDir = path.join(baseDir, skillName);
  const destFile = path.join(destDir, 'SKILL.md');

  const exists = fs.existsSync(destFile);
  if (exists && !args.force) {
    console.error(
      `⚠️  Skill already installed at ${destFile}\n` +
        `   Re-run with --force to overwrite.`
    );
    console.log(
      JSON.stringify(
        { installed: false, reason: 'already_exists', path: destFile },
        null,
        2
      )
    );
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, destFile);

  console.error(`✅ Installed "${skillName}" skill`);
  console.error(`   from: ${src}`);
  console.error(`   to:   ${destFile}`);
  console.error(
    `\nThe skill will trigger by description in new Claude Code sessions.\n` +
      `Commands run via: npx -y screentimer-agent <command>`
  );

  console.log(
    JSON.stringify(
      { installed: true, overwritten: exists, path: destFile },
      null,
      2
    )
  );
}
