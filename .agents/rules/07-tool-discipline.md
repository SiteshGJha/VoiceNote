# Tool Discipline: Dedicated Tools Over Shell

## The Rule
Always use dedicated file manipulation tools instead of invoking shell commands.

| Operation | Dedicated Tool | Prohibited Shell Commands |
|---|---|---|
| Read file | `view_file` | `cat`, `head`, `tail`, `less`, `more` |
| Write / Create file | `write_to_file` | `echo "..." > file`, `cat <<EOF > file`, `tee` |
| Edit file content | `replace_file_content` | `sed`, `awk`, `perl -pe` |
| Search file tree | `find_by_name`, `list_dir` | `ls`, `find`, `dir`, `tree` |
| Search text across files | `grep_search` | `grep`, `rg`, `ag`, `ack` |

## When to Use Shell Commands (`run_command`)
Only invoke shell commands for actual terminal processes that have no dedicated tool:
- Running automated test suites (`npm test`, `jest`)
- Compiling code and typechecking (`npm run typecheck`, `tsc`)
- Package management (`npm install`, `pod install`)
- Building native projects (`xcodebuild`, `./gradlew`)
- Git operations (`git status`, `git diff`)
