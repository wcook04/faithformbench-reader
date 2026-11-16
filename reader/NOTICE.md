# Sources of the reader's files

Every style and component of the reader is copied or adapted from one of Will Cook's other websites. The table gives the source of each file.

| File | Source | Changes |
|---|---|---|
| `tokens.css`, `base.css` | [Proof Reader](https://github.com/wcook04/proof-reader), `web/src/styles/`, commit `e2df888`, Apache-2.0 | None |
| `family.css`, `plectis.svg` | [wcook04.github.io](https://github.com/wcook04/wcook04.github.io), `assets/family/`, commit `2989238` | None |
| `fonts/plectis-serif.woff2`, `fonts/plectis-serif-italic.woff2`, `fonts/plectis-sans.woff2` | The same repository, `assets/fonts/`. Subsets of STIX Two Text and Source Sans 3, renamed as the SIL Open Font License requires. The licence texts are in the same folder. | None |
| `lean-tokens.js` | Proof Reader, `web/src/lean/leanTokens.ts` and the comment handling in `web/src/lean/code.tsx` | TypeScript types removed; the two combined into one module |
| `reader.css` | Proof Reader, `web/src/app/app.css` and `web/src/paper/reading.css`: the desk, sheet and highlight variables, the top bar, the two-column spread, the version switch, the Lean colours and the note list | Arranged for a reasoning chain and four formal statements; each adapted rule names the Proof Reader class it comes from |
| `katex/katex.min.js`, `katex/katex.min.css`, `katex/fonts/*.woff2`, `katex/LICENSE` | [KaTeX](https://katex.org/) 0.19.1, the version Proof Reader uses, from the npm package `katex@0.19.1` (`dist/`), MIT. SHA-256 of `katex.min.js`: `fa140498b8cfc8302cbe5e7cb1bdbc1f952bc38b3fa258ede09e73edbf9a74bc` | None. The stylesheet also names `.woff` and `.ttf` font files, which are not copied; browsers that read `.woff2` do not request them |
| `step-math.js`, `step-math-compare.mjs`, `step-math.check.mjs` | Written for this site: the conversion of released step text to TeX, and the program that compares KaTeX's output with the released characters. The KaTeX options are those of Proof Reader's `web/tools/render-paper.mjs` | New |
| `reader.js`, `index.html`, `theme-init.js` | Written for this site, following the structure of Proof Reader's page and theme script. The list of chains on the front page, with its column headings and its bar for each chain, has no counterpart in the other sites | New |

The reasoning steps, formal statements and verdicts that the reader displays are from the FaithformBench release and belong to its authors. Their licence is in `LICENSE-FaithformBench.txt`.
