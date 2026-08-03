# Save to GitHub

Automatically save all current changes to GitHub with a descriptive commit message.

## When to invoke
Invoke this skill whenever the user says "save" or asks to save their work to GitHub.

## What it does
1. Stages all changed files (git add -A)
2. Creates a commit with a descriptive message based on the changes
3. Pushes the commit to the current branch on GitHub

## Implementation notes
- Run `git status` and `git diff` to understand what changed
- Create a commit message that describes the changes in a concise way
- Use the standard commit format with Devin co-authorship
- Push to the current branch (do not force push)
- If there are no changes, inform the user that nothing needs to be saved