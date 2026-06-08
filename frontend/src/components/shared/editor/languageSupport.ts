import { LanguageDescription, type LanguageSupport } from '@codemirror/language';

// Multi-language syntax highlighting for fenced code blocks. Each language is
// lazy-loaded (its own chunk) the first time a block of that language appears,
// so the base bundle stays light. Plugins can register more via `registerLanguage`.

type Loader = () => LanguageSupport | Promise<LanguageSupport>;

function desc(name: string, alias: string[], load: Loader): LanguageDescription {
  return LanguageDescription.of({ name, alias, load: async () => load() });
}

const builtins: LanguageDescription[] = [
  desc('javascript', ['js', 'jsx', 'mjs', 'cjs'], () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true }))),
  desc('typescript', ['ts'],   () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true }))),
  desc('tsx',        ['tsx'],  () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true, jsx: true }))),
  desc('python',     ['py'],   () => import('@codemirror/lang-python').then(m => m.python())),
  desc('rust',       ['rs'],   () => import('@codemirror/lang-rust').then(m => m.rust())),
  desc('go',         ['golang'], () => import('@codemirror/lang-go').then(m => m.go())),
  desc('java',       [],       () => import('@codemirror/lang-java').then(m => m.java())),
  desc('cpp',        ['c', 'c++', 'cc', 'h', 'hpp'], () => import('@codemirror/lang-cpp').then(m => m.cpp())),
  desc('html',       ['htm'],  () => import('@codemirror/lang-html').then(m => m.html())),
  desc('css',        [],       () => import('@codemirror/lang-css').then(m => m.css())),
  desc('sql',        [],       () => import('@codemirror/lang-sql').then(m => m.sql())),
  desc('json',       [],       () => import('@codemirror/lang-json').then(m => m.json())),
  desc('yaml',       ['yml'],  () => import('@codemirror/lang-yaml').then(m => m.yaml())),
  desc('php',        [],       () => import('@codemirror/lang-php').then(m => m.php())),
];

// Plugin-registered languages take precedence over built-ins.
const custom: LanguageDescription[] = [];

/** Register a language for fenced-code highlighting (e.g. from a plugin). */
export function registerLanguage(name: string, factory: Loader, alias: string[] = []) {
  custom.push(desc(name, alias, factory));
}

/** Resolver passed to `markdown({ codeLanguages })`: maps a fence info string
 *  (```lang) to a (lazily-loaded) language. Unknown languages return null and
 *  render as plain code without breaking the editor. */
export function codeLanguages(info: string): LanguageDescription | null {
  if (!info) return null;
  const name = info.trim().split(/\s+/)[0].toLowerCase();
  return LanguageDescription.matchLanguageName([...custom, ...builtins], name, true);
}
