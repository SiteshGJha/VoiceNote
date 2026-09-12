---
trigger: glob
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript Strict Mode

## Compiler settings (non-negotiable)
```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "noImplicitOverride": true,
  "exactOptionalPropertyTypes": true,
  "noFallthroughCasesInSwitch": true
}
```

## Type rules
- No `any`. Use `unknown` + narrowing, or define a proper type.
- No non-null assertion (`!`) except immediately after a validated guard.
- Discriminated unions for state machines (e.g. `RecordingState`).
- All ML model I/O has explicit types in `src/ml/types.ts`.

## Example: pipeline result type
```ts
type PipelineResult =
  | { status: 'ok'; raw: string; final: string; tone: Tone; lang: Lang }
  | { status: 'error'; code: MlErrorCode; message: string; raw?: string };
```

## Naming
- Types/interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Files: `kebab-case.ts` for utils, `PascalCase.tsx` for components
