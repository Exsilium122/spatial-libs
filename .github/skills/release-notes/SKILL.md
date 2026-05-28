---
name: release-notes
description: Use this skill whenever the user asks to prepare, format, compile, or draft GitHub release notes or changelogs for upcoming library versions.
disable-model-invocation: false
user-invocable: true
---

# Release Notes & Changelog Preparer Skill

## Core Instruction
You are an expert technical writer and release manager. When executing this skill:
1. Examine the git logs between the last tag and HEAD (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`).
2. Categorize commits into:
   - 🚀 Features
   - 🐛 Bug Fixes
   - 🧹 Chores & Refactoring
   - 📦 Dependency Updates
3. Format output in clean GitHub-Flavored Markdown.
4. Keep the tone professional, objective, and developer-friendly.

---

## 🛠️ Executable Steps

### Step 1: Identify Last Tag and Fetch Git Logs
Retrieve the current release tag and fetch all commits made since then.
1. Run:
   ```bash
   git describe --tags --abbrev=0
   ```
   *(If no tags exist, default to the initial commit).*
2. Fetch the commit list since that tag:
   ```bash
   git log <last-tag>..HEAD --oneline
   ```

### Step 2: Analyze and Categorize Commits
Review the commit list and group changes into conventional categories:
* **🚀 Features (`feat`):** New functional additions, endpoints, options, or settings.
* **🔧 Refactoring & Optimization (`refactor`):** API streamlining, performance, codebase styling, or internal structural changes.
* **🛡️ Security & Bug Fixes (`fix`, `security`):** CVE resolutions, error handling improvements, input sanitization, or logic corrections.
* **📦 Chore & Maintenance (`chore`, `build`, `ci`):** Dependency updates, build configurations, lockfile pruning, or publish list adjustments.
* **📖 Documentation (`docs`):** README updates, cookbooks, inline code documentation, or API references.

### Step 3: Extract Key Technical Metrics
Detail any technical footprint improvements:
* **Dependency Footprint:** Note any added, updated, or uninstalled production/transitive packages and bundle size reductions.
* **Vulnerability Auditing:** Note specific CVE codes resolved, their severity levels, and how they were patched.
* **Public API Shifts:** Note any additions, deprecations, or removals in exported entrypoint methods.

### Step 4: Generate the Release Notes Template
Draft the release text using the following standard template:

````markdown
### 1. Release Title
```text
v[New-Version]: [Short, high-impact summary of main upgrades]
```

---

### 2. Release Notes
```markdown
We are excited to announce the release of **v[New-Version]**! This release introduces [brief summary of major themes, e.g. security hardening, dependency pruning, performance].

---

### 🚀 Key Improvements & Highlights

#### [Theme 1, e.g. 🛡️ Security Hardening]
* **[Brief bolded highlight]:** [Description of what was done and why, including CVE numbers if applicable].
* **[Brief bolded highlight]:** [Details].

#### [Theme 2, e.g. 📦 Dependency Footprint Pruning]
* **[Brief bolded highlight]:** [Details of package changes, size reduction, etc.].

#### [Theme 3, e.g. 🎛️ API Streamlining]
* **[Brief bolded highlight]:** [Details on public module export updates].

---

### 📦 Published Packages
* **`[package-name]@New-Version`**

*Thank you to everyone who contributed to testing and auditing this release!*
```
````
