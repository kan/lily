# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions up to 0.5.2 are listed on the
[GitHub Releases](https://github.com/kan/lily/releases) page.

## [Unreleased]

### Security

- lily now requires hono 4.13.16 or later. That release fixes
  [GHSA-46wx-v44x-9hh2](https://github.com/advisories/GHSA-46wx-v44x-9hh2): a
  POST with the content type `text/ping` (sent by Chromium's `<a ping>`) was
  not checked by `csrf()`, which lily puts in front of the admin API. Before
  this release, a blog could keep an older hono from its own lockfile even
  after upgrading lily. The template's lockfile is moved to the fixed version
  too.

## [0.5.3] - 2026-11-04

### Internal

- Releases are prepared by [tagpr](https://github.com/Songmu/tagpr): a release
  pull request carries the version bump and this file's section, and merging it
  tags the release and publishes it to npm. The GitHub release notes are now
  this file's section for the version instead of a list of commits.

[0.5.3]: https://github.com/kan/lily/releases/tag/v0.5.3
